/* =========================================================================
 * assess.js —— 表现评估引擎
 * =========================================================================
 * 存在的理由：原来的阶段是"你点一下就+1"，系统完全不看训练表现。
 * 认真练 4 周和一次没练，得到的强度完全一样；痛到走不动路也不会自动降级。
 *
 * 这一层的作用是把训练日志变成一个能读懂的判断：
 *   你现在做得怎么样 -> 建议推进 / 维持 / 退回
 *
 * 重要边界：这里只做「建议」，不做强制。是否推进由用户决定。
 * 原因：评估基于用户自报（点勾、报有无代偿），数据本身不可靠，
 * 强制自动降级会在误报时伤害积极性，强制自动升级更危险。
 * ======================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
   * 一、评估窗口
   * 只看最近 N 次记录。理由：3 周前的表现不代表现在。
   * 但至少要 3 条记录才敢给建议——样本太少就直说"数据不够"。
   * ------------------------------------------------------------------- */
  const WINDOW = 6;          // 最近 6 次动作记录
  const MIN_SAMPLE = 3;      // 少于 3 条不给建议
  const STALE_DAYS = 10;     // 超过 10 天没练 = 状态未知

  function recentEntries(state, n) {
    const all = Object.values(state.entries || {})
      .flat()
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return n ? all.slice(-n) : all;
  }

  function daysSinceLast(state) {
    const all = Object.values(state.entries || {}).flat();
    if (!all.length) return null;
    const last = all.map(e => new Date(e.date).getTime()).sort((a, b) => b - a)[0];
    return Math.floor((Date.now() - last) / 864e5);
  }

  /* ---------------------------------------------------------------------
   * 二、当前阶段是否达标
   * 规则来自各阶段的 exitCondition，改成可计算的形式。
   * ------------------------------------------------------------------- */
  function phaseRequirement(phaseId) {
    switch (phaseId) {
      case 'adapt':
        // 「连续 2 次训练，全程没有耸肩/歪斜/不适」
        return {
          text: '连续 2 次训练全程无代偿、无不适',
          need: { cleanStreak: 2 }
        };
      case 'build':
        // 「能稳定完成 3 组 × 12 次，且第 3 组末尾动作仍然标准」
        // 自报里没有"第3组末尾是否标准"这个字段，用"最近记录无代偿"近似
        return {
          text: '能稳定完成 3 组 × 12 次，且全程动作不变形',
          need: { cleanStreak: 3 }
        };
      case 'strengthen':
        // 「愿意在动作不干净的时候主动降重量」——这个只能自问，不能自动判断
        return {
          text: '在动作不干净时主动降重量，而不是硬扛',
          need: { cleanStreak: 2 },
          selfReport: true
        };
      default:
        return { text: '重新做一次目标评估', need: {}, selfReport: true };
    }
  }

  /* ---------------------------------------------------------------------
   * 三、核心：算一次评估
   * ------------------------------------------------------------------- */
  function evaluate(state) {
    const st = state || Log.load();
    const phaseIdx = st.phaseIndex || 0;
    const phase = Goal.PHASES[phaseIdx];
    const req = phaseRequirement(phase.id);

    const recent = recentEntries(st, WINDOW);
    const sample = recent.length;
    const days = daysSinceLast(st);

    const base = {
      phase, phaseIdx,
      sample,
      daysSinceLast: days,
      requirement: req,
      verdict: 'unknown',
      headline: '',
      reasons: [],
      metrics: {},
      // 建议强度修正：默认不变
      intensityAdjust: 0,
      warnings: []
    };

    // ── 情况 1：一条记录都没有 ──
    if (sample === 0) {
      base.verdict = 'no_data';
      base.headline = '还没有训练记录';
      base.reasons.push('去「计划」页做完至少 1 个任务，在任务卡上点「记一次执行」，这里才会有判断依据。');
      return base;
    }

    // ── 情况 2：记录太少 ──
    if (sample < MIN_SAMPLE) {
      const clean = recent.filter(e => !e.pain && !e.cramp && !e.compensation).length;
      base.verdict = 'insufficient';
      base.headline = `已有 ${sample} 条记录，还差一点（需要 ${MIN_SAMPLE} 条）`;
      base.reasons.push(clean === sample
        ? `目前 ${sample}/${sample} 条都干净，再记 ${MIN_SAMPLE - sample} 条就能给出建议。`
        : `其中 ${sample - clean} 条报告了不适。建议先解决这个，再谈进阶。`);
      base.metrics = { clean, sample };
      return base;
    }

    // ── 情况 3：太久没练 ──
    if (days != null && days >= STALE_DAYS) {
      base.verdict = 'stale';
      base.headline = `已经 ${days} 天没训练`;
      base.reasons.push('这个间隔下，你之前的强度起点已经不能直接用了。');
      base.reasons.push(`建议：回到上一个阶段的重量重新适应，或直接按当前阶段的低档位开始。`);
      base.intensityAdjust = -1;   // 强度降一档
      base.weightCut = true;
      return base;
    }

    // ── 正常情况：算指标 ──
    const pain = recent.filter(e => e.pain).length;
    const cramp = recent.filter(e => e.cramp).length;
    const comp = recent.filter(e => e.compensation).length;
    const clean = sample - pain - cramp - comp;

    // 连续干净次数（从最近一次往前数）
    let cleanStreak = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const e = recent[i];
      if (!e.pain && !e.cramp && !e.compensation) cleanStreak++;
      else break;
    }

    // 本周出勤
    const weekAgo = Date.now() - 7 * 864e5;
    const sessionsThisWeek = (st.sessions || []).filter(s => new Date(s.date).getTime() > weekAgo).length;
    const expected = st.goal ? st.goal.freq.days : 3;

    base.metrics = {
      clean, sample, pain, cramp, comp, cleanStreak,
      sessionsThisWeek, expected,
      attendance: expected ? Math.round(sessionsThisWeek / expected * 100) : 0
    };

    // ── 判定：痛和抽筋优先级最高 ──
    if (pain > 0) {
      base.verdict = 'stop';
      base.headline = `最近 ${sample} 次里有 ${pain} 次报告了疼痛`;
      base.reasons.push('疼痛（不是酸）是停止信号，不是"练得不够"。');
      base.reasons.push('在疼痛消失之前，不要加任何重量。如果持续超过 3 天，或伴随肿胀、关节响、动作受限，去看骨科或康复科。');
      base.intensityAdjust = -2;
      base.weightCut = true;
      base.warnings.push('身体警报');
      return base;
    }

    if (cramp > 0) {
      base.verdict = 'retreat';
      base.headline = `最近 ${sample} 次里有 ${cramp} 次抽筋`;
      base.reasons.push('抽筋是明确的停止信号。当天不补练，24 小时内不安排该部位。');
      base.reasons.push('反复抽筋不是训练量问题。注意：多喝水不是解法（见 docs/参数依据核查报告.md），要找个体风险因素。');
      base.intensityAdjust = -1;
      base.weightCut = true;
      return base;
    }

    // ── 判定：代偿 ──
    if (comp >= 2) {
      base.verdict = 'retreat';
      base.headline = `最近 ${sample} 次里有 ${comp} 次代偿（耸肩/歪斜/单侧酸）`;
      base.reasons.push('代偿是这三类信号里最需要重视的——它意味着目标肌肉没在工作，负荷被代偿肌接管了。');
      base.reasons.push('建议退回上一个阶段。触发代偿的那个动作先停掉，下次从空载或最轻一档重新开始，不是降重量接着做。');
      base.intensityAdjust = -1;
      return base;
    }

    if (comp === 1) {
      base.verdict = 'hold';
      base.headline = `最近 ${sample} 次里有 1 次代偿`;
      base.reasons.push('单次代偿不严重，但说明动作还没完全稳定。');
      base.reasons.push('维持当前阶段，不推进。');
      base.reasons.push('但这一课的重量会自动降一档 —— 代偿说明那个重量你还没控制住。');
      // 注意：这里降的是「重量」不是「阶段」。
      // 单次代偿退阶段太重（会打击刚起步的积极性），但重量必须降，
      // 否则等于什么都没变，之前的文案就成了空话。
      base.weightCut = true;
      base.intensityAdjust = 0;
      return base;
    }

    // ── 全部干净：看是否达标 ──
    const need = req.need || {};
    const metStreak = cleanStreak >= (need.cleanStreak || 2);

    if (metStreak) {
      if (phaseIdx >= Goal.PHASES.length - 1) {
        base.verdict = 'complete';
        base.headline = '8 周全部完成';
        base.reasons.push('最后一个阶段的目标是"愿意在动作不干净时主动降重量"——你自己判断。');
        base.reasons.push('建议重新做一次目标评估，选下个周期的主攻方向。');
        base.intensityAdjust = 0;
      } else {
        base.verdict = 'advance';
        base.headline = `连续 ${cleanStreak} 次训练无代偿无不适，达到进入下一阶段的条件`;
        base.reasons.push(`当前阶段要求：${req.text} —— 已满足。`);
        if (req.selfReport) {
          base.reasons.push('这一条系统无法自动判断，需要你自己确认是否真的做到了。');
        }
        if (sessionsThisWeek < expected) {
          base.reasons.push(`但本周只出勤 ${sessionsThisWeek}/${expected} 次。也可以选择再练一周，把出勤补上。`);
        }
        base.intensityAdjust = 0;
      }
    } else {
      base.verdict = 'hold';
      base.headline = `记录都是干净的，但连续干净次数还不够（${cleanStreak}/${need.cleanStreak || 2}）`;
      base.reasons.push(`当前阶段要求：${req.text}。`);
      base.reasons.push('不需要加大重量，保持现在的状态继续做就行。');
      base.intensityAdjust = 0;
    }

    return base;
  }

  /* ---------------------------------------------------------------------
   * 四、强度修正：把评估结果变成具体动作
   * ------------------------------------------------------------------- */
  function applyIntensity(base, currentPhaseId) {
    const map = { adapt: 'adapt', build: 'build', strengthen: 'strengthen', consolidate: 'consolidate' };
    const order = ['adapt', 'build', 'strengthen', 'consolidate'];
    let idx = order.indexOf(currentPhaseId);
    if (idx < 0) idx = 0;

    // -2 直接掉到适应期，-1 掉一档，0 不变，+1 升一档
    let target = idx + (base.intensityAdjust || 0);
    if (target < 0) target = 0;
    if (target > order.length - 1) target = order.length - 1;

    return {
      phaseId: order[target],
      phase: Goal.PHASES[target],
      changed: target !== idx,
      from: Goal.PHASES[idx].name,
      to: Goal.PHASES[target].name,
      level: Goal.PHASES[target].level
    };
  }

  /* ---------------------------------------------------------------------
   * 五、一句话摘要（给顶部用）
   * ------------------------------------------------------------------- */
  function summary(state) {
    const e = evaluate(state);
    const s = Log.stats(state);
    let txt;
    switch (e.verdict) {
      case 'no_data': txt = '暂无数据 · 先练一次'; break;
      case 'insufficient': txt = `数据不足 ${e.sample}/${MIN_SAMPLE}`; break;
      case 'stale': txt = `已 ${e.daysSinceLast} 天未训练`; break;
      case 'stop': txt = '⚠ 有疼痛记录 · 已降强度'; break;
      case 'retreat': txt = '⚠ 建议退回上一阶段'; break;
      case 'hold': txt = '维持当前强度'; break;
      case 'advance': txt = '✓ 建议进入下一阶段'; break;
      case 'complete': txt = '8 周已完成'; break;
      default: txt = '—';
    }
    return {
      text: txt,
      verdict: e.verdict,
      sample: e.sample,
      clean: e.metrics.clean,
      sessions: s.totalSessions,
      attendance: e.metrics.attendance
    };
  }

  global.Assess = {
    evaluate, applyIntensity, summary,
    phaseRequirement, recentEntries, daysSinceLast,
    WINDOW, MIN_SAMPLE, STALE_DAYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Assess;

})(typeof window !== 'undefined' ? window : globalThis);
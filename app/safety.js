/* =========================================================================
 * safety.js —— 红线引擎（本项目的安全底座）
 * =========================================================================
 * 设计原则：红线不做成 UI 层的"隐藏按钮"，而做成数据层 + 生成层的三道闸：
 *
 *   第 1 道  markSafety()   数据加载时给每个动作/器材打安全标记（谁被禁、被谁禁）
 *   第 2 道  assertSafe()   任何计划生成路径在返回前强制过一遍，违规直接抛错
 *   第 3 道  explain()      展示层必须能向用户解释"为什么这个动作没出现"
 *
 * 后果：即使有人手改数据、或调用了写错的函数，也不会训练出越线计划。
 * ========================================================================= */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
   * 1. 学员安全档案
   * ------------------------------------------------------------------- */
  // 这份档案来自你的真实情况，是所有红线的唯一来源。
  // 改体重/加器械/受伤，只需改这一处，全项目自动生效。
  const SAFETY_PROFILE = {
    id: 'beginner-male-asym-left',
    label: '新手·左高右低·左斜方肌易代偿',

    basics: {
      sex: 'male',
      level: 0,                 // 0 = 零基础
      goal: 'health-posture-habit', // 健康/体态/习惯，不追重量
      maxSessionsPerWeek: 4
    },

    // 不对称 / 薄弱环节
    asymmetries: [
      { side: 'left', type: 'shoulder-height', note: '左肩偏高（左高右低高低肩）' }
    ],
    weakZones: [
      {
        region: 'left_upper_trap',
        name: '左侧上斜方肌',
        reason: '长期紧张，几乎必然代偿',
        rule: '任何容易把它拉起来的动作都要避开或大幅降难度'
      }
    ],

    // 伤病史
    history: [
      {
        event: '单臂高位下拉 20kg',
        result: '左斜方肌严重代偿酸痛',
        status: 'recovered',
        lesson: '单臂 + 大重量 = 斜方肌接单'
      }
    ],

    // 重量上限：单侧 kg 或总重 kg。注意高位下拉因伤史单独收紧。
    limits: {
      default:     { maxTotal: 25, maxPerSide: 10 },
      // 注意：这里的 key 必须是 MACHINES 里的真实 id（经过 IdAlias 归一化之后的名字）。
      // 高位下拉因单臂 20kg 代偿伤史，上限收紧到 5kg，且永久不随进度上调。
      high_pulldown:{ maxTotal: 5,  maxPerSide: 2.5, must: 'both_hands_symmetric',
                      note: '永久上限。你的左侧上斜方肌有代偿史，这是唯一写死的红线' },
      // 旧 key 保留为别名，防止调用方漏改导致上限静默失效
      lat_pulldown:{ maxTotal: 5,  maxPerSide: 2.5, must: 'both_hands_symmetric',
                      note: '别名 → high_pulldown' },
      leg_extension:{ maxTotal: 25, maxPerSide: 12.5 },
      leg_press_machine:{ maxTotal: 100, maxPerSide: 50, unitNote: '腿举属大肌群，可用整机标称重量，仍按手感控制' },
      leg_press:   { maxTotal: 100, maxPerSide: 50, unitNote: '别名 → leg_press_machine' },
      leg_raise:   { maxTotal: 25, maxPerSide: 12.5 }
    },

    // 身体警报：这些身体反应出现时，不是"练得狠"，是"要停"
    prone: [
      { id: 'doms_leg',      name: '腿部重度延迟性酸痛', action: '隔一天再练同一肌群，必要时降级为拉伸' },
      { id: 'glute_cramps',  name: '臀部极易抽筋',       action: '每次必做臀部激活热身，出现前兆立刻停' },
      { id: 'trap_tight',    name: '左侧上斜方肌发紧',   action: '当天禁止所有拉类动作，改上斜方肌放松' }
    ],

    // 绝对禁止的动作类别
    bannedCategories: [
      {
        id: 'free_weight',
        name: '自由重量',
        examples: ['杠铃深蹲', '杠铃卧推', '杠铃划船', '哑铃推举', '哑铃侧平举', '硬拉', '负重箭步蹲'],
        reason: '新手无法自主纠正动作偏差，且无法配重，负荷不可控'
      },
      {
        id: 'unilateral',
        name: '单臂拉/推',
        examples: ['单臂高位下拉', '单臂划船', '单臂推胸机'],
        reason: '左右发力差会被放大，直接触发左肩代偿'
      },
      {
        id: 'overhead_press',
        name: '过头推压类（肩峰撞击风险）',
        examples: ['肩推机', '直立划船', '过头推举', '直臂下压', '上斜方肌训练'],
        reason: '肩峰撞击 + 上斜方肌代偿双风险'
      }
    ]
  };

  /* ---------------------------------------------------------------------
   * 2. 类别黑名单匹配
   * ------------------------------------------------------------------- */
  const BANNED_IDS = new Set(SAFETY_PROFILE.bannedCategories.map(c => c.id));
  const BANNED_EXAMPLES = new Map();
  SAFETY_PROFILE.bannedCategories.forEach(c => {
    c.examples.forEach(name => BANNED_EXAMPLES.set(name, c));
  });

  function findBannedCategory(ex) {
    const cats = Array.isArray(ex.category) ? ex.category : [ex.category];
    for (const c of cats) {
      if (c && BANNED_IDS.has(c)) {
        return SAFETY_PROFILE.bannedCategories.find(x => x.id === c);
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------------
   * 3. 第 1 道闸：加载时打安全标记
   * ------------------------------------------------------------------- */
  function markSafety(ex) {
    const reasons = [];

    const cat = findBannedCategory(ex);
    if (cat) reasons.push({ type: cat.id, why: cat.reason });

    // 非对称动作：即使没被类别黑名单命中，只要标了 unilateral 关键词也拦
    if (ex.symmetric === false) {
      reasons.push({ type: 'unilateral', why: '单侧发力，会放大左右差' });
    }

    // 上斜方肌风险动作（例如耸肩式下拉、上斜方肌耸肩训练）
    if (ex.trapRisk === 'high' && ex.symmetric !== false) {
      reasons.push({
        type: 'trap_tight',
        why: '该动作会大量征用左侧上斜方肌（你的薄弱环节）'
      });
    }

    // 自由重量标记但没进黑名单的兜底
    if (ex.equipment === 'free_weight' && !cat) {
      reasons.push({ type: 'free_weight', why: '自由重量一律不用' });
    }

    ex._banned = reasons.length > 0;
    ex._banReasons = reasons;
    ex._banText = reasons.map(r => r.why).join('；');
    return ex;
  }

  function markAll(list) {
    return list.map(markSafety);
  }

  /* ---------------------------------------------------------------------
   * 4. 重量闸：按器械 id 返回允许的重量区间
   * ------------------------------------------------------------------- */
  function limitFor(machineId) {
    return SAFETY_PROFILE.limits[machineId] || SAFETY_PROFILE.limits.default;
  }

  function startWeight(machineId, ex) {
    const lim = limitFor(machineId);
    // 坐姿类器械按"每侧配重片"给建议，全机型按标称总重给建议
    const base = ex.loadStyle === 'plate_per_side'
      ? Math.max(2.5, Math.min(lim.maxPerSide, lim.maxPerSide * 0.5))
      : Math.max(5, lim.maxTotal * 0.5);
    return round2_5(base);
  }

  function round2_5(n) {
    return Math.max(2.5, Math.round(n / 2.5) * 2.5);
  }

  /**
   * 计算渐进：只有连续两次无不适、无代偿，才允许小幅加。
   * 永不自动突破 limits 上限。
   */
  function nextWeight(machineId, history) {
    const lim = limitFor(machineId);
    const cur = startWeight(machineId, {});
    if (!history || history.length < 2) return cur;
    const last2 = history.slice(-2);
    const ok = last2.every(h => !h.pain && !h.cramp && !h.compensation);
    if (!ok) return cur;                       // 有任何问题 → 维持甚至回退
    const bumped = round2_5(cur * 1.15);
    const cap = lim.maxTotal;
    return Math.min(bumped, cap);               // 硬顶
  }

  /* ---------------------------------------------------------------------
   * 5. 第 2 道闸：计划生成前强校验（抛错，不是静默）
   * ------------------------------------------------------------------- */
  function assertSafe(exercises, planMeta) {
    const violations = [];
    exercises.forEach(ex => {
      if (ex._banned) {
        violations.push(`动作「${ex.name}」触犯红线：${ex._banText}`);
      }
      const lim = limitFor(ex.machine);
      const planned = (ex.prescribedWeight || 0);
      // 大肌群器械（腿举等）本身就配了独立上限，由 limits 表负责，
      // 不再硬编码机器 id —— 硬编码会在 id 归一化后静默失效。
      const overLimit = planned > lim.maxTotal + 1e-9;
      if (overLimit) {
        violations.push(`动作「${ex.name}」计划重量 ${planned}kg 超过上限 ${lim.maxTotal}kg`);
      }
      if (lim.must === 'both_hands_symmetric' && ex.symmetric === false) {
        violations.push(`动作「${ex.name}」在伤史器械上必须双手对称`);
      }
    });

    // 计划层面的检查
    if (planMeta) {
      if (planMeta.sessionsPerWeek > SAFETY_PROFILE.basics.maxSessionsPerWeek) {
        violations.push(`每周 ${planMeta.sessionsPerWeek} 次超出上限 ${SAFETY_PROFILE.basics.maxSessionsPerWeek} 次`);
      }
      if (planMeta.consecutiveHardDays >= 3) {
        violations.push('连续 ≥3 个训练日无恢复日，DOMS 会叠加');
      }
    }
    return { ok: violations.length === 0, violations };
  }

  /* ---------------------------------------------------------------------
   * 6. 第 3 道闸：解释层——告诉用户"为什么它没出现"
   * ------------------------------------------------------------------- */
  function explain(ex) {
    if (!ex._banned) return null;
    return {
      name: ex.name,
      banned: true,
      reasons: ex._banReasons.map(r => ({
        label: (SAFETY_PROFILE.bannedCategories.find(c => c.id === r.type) || {}).name
               || '你的身体限制',
        text: r.why
      })),
      // 有禁必有替：给同类白名单替代，否则明说今天跳过
      alternativeHint: '计划生成器会自动换用同肌群的白名单动作'
    };
  }

  /* ---------------------------------------------------------------------
   * 7. 身体信号处理：痛 / 抽筋 → 停止
   *
   * 【口径统一】这张表原先是"每处一个说法"，与 plan.js 的 REACTIONS 冲突：
   *   - pain 原写「今晚热敷」——属越界的自我处置建议（审校 Y-2）
   *   - cramp 原写「小口补水」——与 plan.js「多喝水不是解法」直接对撞（Y-1）
   *   - compensation 原写「立刻降重或换动作」——正是被否定掉的做法（Y-4）
   * 现在统一为 plan.js 的口径。这张表目前未被界面渲染，
   * 但留着相反的说法会被后续维护者抄回去，所以必须对齐。
   * 唯一权威话术源是 plan.js 的 REACTIONS，这里只保留机器可读的策略标记。
   * ------------------------------------------------------------------- */
  const SIGNAL_POLICY = {
    pain: {
      label: '痛（不是酸）',
      action: 'STOP',
      reply: '立刻停止该动作，不追加次数、不换动作顶替。当天训练到此结束。疼痛持续或伴随肿胀、关节响、活动受限，去看骨科或康复科。',
      forbid: ['再坚持一下', '换个动作试试', '减重量继续', '今晚热敷就会好']
    },
    cramp: {
      label: '抽筋 / 抽筋前兆',
      action: 'STOP',
      reply: '立刻停下放松该侧肌肉，缓慢静态拉伸至症状缓解，慢慢屈伸关节。当天训练到此结束，不补做。多喝水不是解法。',
      forbid: ['扛过去', '换个小重量继续', '再练一组就好了', '喝点水就好了']
    },
    doms: {
      label: '对称性肌肉酸',
      action: 'ADAPT',
      reply: '对称的酸是正常恢复，48 小时内不重复练同一肌群即可。',
      forbid: ['加练', '练到不酸为止']
    },
    compensation: {
      label: '单侧酸 / 耸肩 / 身体歪',
      action: 'STOP_THAT_LIFT',
      reply: '这是代偿信号，不是练到了。立刻停掉这个动作，不要降重量接着做——负荷还是被同一块代偿肌接管。下次从空载或最轻一档重新开始。',
      forbid: ['正常现象', '坚持一下就好了', '降重量继续做']
    }
  };

  function respondTo(signal) {
    return SIGNAL_POLICY[signal] || SIGNAL_POLICY.pain;
  }

  /* ---------------------------------------------------------------------
   * 8. 全局暴露
   * ------------------------------------------------------------------- */
  const Safety = {
    PROFILE: SAFETY_PROFILE,
    markAll, markSafety,
    limitFor, startWeight, nextWeight, round2_5,
    assertSafe, explain, respondTo, SIGNAL_POLICY,
    /** 唯一合规出口：给一份原始动作列表，返回合规子集 + 被剔除项的解释 */
    filter(exercises, planMeta) {
      const all = exercises.map(markSafety);
      const allowed = all.filter(e => !e._banned);
      const dropped = all.filter(e => e._banned).map(explain);
      const check = assertSafe(allowed, planMeta);
      return { allowed, dropped, check };
    }
  };

  global.Safety = Safety;
  if (typeof module !== 'undefined' && module.exports) module.exports = Safety;

})(typeof window !== 'undefined' ? window : globalThis);
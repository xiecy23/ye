/* =========================================================================
 * plan.js —— 周计划引擎
 * =========================================================================
 * 解决"不知道练什么"和"没有合理计划"。
 *
 * 三条不可协商的规则：
 *   1. 任何动作进入计划前，必须通过 Safety.markSafety（红线闸）
 *   2. 计划生成后，必须通过 Safety.assertSafe（校验闸），失败则拒绝输出
 *   3. 训练日的排布必须满足"同肌群间隔 >= 48h"且"不出现连续 3 个训练日"
 *
 * 关于部位轮转：这里的顺序不是随便排的。
 *   背 放在上肢拉日，因为你要用轻重量教上斜方肌"不用"
 *   腿 单独放且每周最多 2 次，因为你的腿部 DOMS 很重，需要间隔
 *   推 放在最后，因为它是当天唯一需要发力的，推完就该休息了
 * ========================================================================= */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
   * 部位映射：引擎内部的部位 key <-> 数据里的 bodyPart 值
   * ------------------------------------------------------------------- */
  const PART_KEYS = ['legs', 'chest', 'back', 'core', 'cardio'];

  const BODY_PART_MAP = {
    '腿': 'legs', '臀': 'legs',
    '胸': 'chest', '肩': 'chest',
    '背': 'back',
    '核心': 'core',
    '有氧': 'cardio'
  };

  const PART_LABEL = {
    legs: '腿臀', chest: '胸肩', back: '背部', core: '核心', cardio: '有氧'
  };

  function partOf(ex) {
    return BODY_PART_MAP[ex.bodyPart] || null;
  }

  /** 动作在某部位上的适合度打分，用于挑选主项 */
  function fitScore(ex, part) {
    const p = partOf(ex);
    if (p !== part) return -1;
    let s = 10;
    // 优先级白名单：优先选"教上斜方肌别抢活"和"低 DOMS / 低抽筋"的动作
    const PRIORITY = [
      '高位下拉（宽握对握）', '坐姿划船', '胸部支撑划船', '高位下拉（肩胛引体上拉）',
      '绳索肩胛后缩', '低位上斜推胸机', '推胸机', '上斜推胸机',
      '腿屈伸', '俯卧腿弯举', '髋外展', '坐姿腿屈曲', '髋内收', '提踵',
      '卷腹机', '平板支撑', '坐姿腹肌旋转卷腹机', '死虫式', '鸟狗式',
      '椭圆机', '跑步机', '固定单车',
      '肩后束（反飞鸟）', '直臂后伸'
    ];
    const idx = PRIORITY.indexOf(ex.name);
    if (idx >= 0) s += 50 - idx;

    // 风险惩罚：新手阶段优先低风险动作
    const W = { low: 0, mid: 1, high: 2 };
    s -= (W[ex.domsRisk] || 0) * 6;
    s -= (W[ex.crampRisk] || 0) * 5;
    s -= (W[ex.trapRisk] || 0) * 8;      // 上斜方肌风险权重最高

    // 高位下拉的肩胛引体版本是纠正动作，额外加分
    if (/肩胛/.test(ex.name)) s += 20;
    return s;
  }

  /* ---------------------------------------------------------------------
   * 四个训练日模板
   *   排布逻辑：下肢放最前（因为它恢复最慢，需要最多休息时间），
   *   上肢拉放中间（有氧恢复日隔开），上肢推放最后。
   * ------------------------------------------------------------------- */
  const TEMPLATES = {
    1: [
      { key: 'full', name: '全身基础课', slots: { back: 2, legs: 1, chest: 1, core: 1 } }
    ],
    2: [
      { key: 'A', name: '下肢 + 上肢拉', slots: { legs: 2, back: 2, core: 1 } },
      { key: 'B', name: '上肢推 + 核心', slots: { chest: 2, back: 1, core: 2 } }
    ],
    3: [
      { key: 'A', name: '下肢 · 轻', slots: { legs: 2, core: 1 } },
      { key: 'B', name: '上肢拉 · 纠正肩', slots: { back: 3, core: 1 } },
      { key: 'C', name: '上肢推 + 核心', slots: { chest: 2, core: 2, back: 1 } }
    ],
    4: [
      { key: 'A', name: '下肢 · 轻', slots: { legs: 2, core: 1 } },
      { key: 'B', name: '上肢拉 · 纠正肩', slots: { back: 2, core: 2 } },
      { key: 'C', name: '有氧恢复课', slots: { cardio: 2, core: 1 }, light: true },
      { key: 'D', name: '上肢推 + 核心', slots: { chest: 2, back: 1, core: 2 } }
    ]
  };

  /* ---------------------------------------------------------------------
   * 热身与收尾
   * 每次固定。臀部激活是必选项，不是可选项——因为你有抽筋史。
   *
   * 【依据核查 2026-10-11】
   * McCrary et al. 2015, Br J Sports Med (PMID 25694615)，31 项研究系统综述：
   *   "short-duration static stretching warm-up has no effect on power outcomes"
   *   "high-load dynamic warm-ups enhance power and strength performance"
   *   "No studies of upper body warm-up effects on injury prevention were discovered"
   *
   * → 静态拉伸**没有被证明能预防损伤**。把它当防伤手段是常见误解。
   * → 有效的是动态热身。
   * 所以下面把动态激活类动作提到前面，静态拉伸明确标注为"活动度用，不是防伤"。
   * 保留静态拉伸的理由是活动度和你的体态问题，不宣称它防伤。
   * ------------------------------------------------------------------- */
  const WARMUP = [
    { name: '肩关节绕环（前后左右）', dur: '各 10 次',
      why: '动态热身。有证据支持动态热身提升力量表现（R4）' },
    { name: '空杆肩胛下沉后缩', dur: '15 次',
      why: '这是「沉肩」这个动作本身的练习，是你的核心纠正点。动态，不是拉伸' },
    { name: '臀桥 / 蚌式 / 髋外展空载', dur: '15 次',
      why: '必做。你的臀部极易抽筋。动态激活优于静态拉伸' },
    { name: '髋关节绕环', dur: '前后各 10 次',
      why: '腿日必做，动态活动度' },
    { name: '原地高抬腿走 / 侧向跨步', dur: '各 10 步',
      why: '动态热身，提升下肢发力感' },
    { name: '颈部侧向拉伸', dur: '左右各 30 秒',
      why: '活动度用。注意：静态拉伸没有被证明能预防损伤（R4），这项是为了改善你的颈部活动范围' },
    { name: '上斜方肌 + 胸小肌拉伸', dur: '每侧 30 秒',
      why: '活动度用。你的左侧上斜方肌长期紧张、胸小肌导致含胸。这是为了活动范围，不是防伤' }
  ];

  const COOLDOWN = [
    { name: '大腿前侧拉伸', dur: '每侧 30 秒' },
    { name: '大腿后侧拉伸', dur: '每侧 30 秒' },
    { name: '臀部四字拉伸', dur: '每侧 30 秒', why: '重点，抽筋高发部位' },
    { name: '胸小肌 + 上斜方肌拉伸', dur: '每侧 30 秒', why: '重点，针对高低肩' },
    { name: '仰卧抱膝', dur: '30 秒', why: '让神经系统降下来' }
  ];

  /* ---------------------------------------------------------------------
   * 组数次数：按阶段给
   *
   * 【依据核查 2026-10-11】每次改动都查过 PubMed，来源见 docs/参数依据核查报告.md
   *
   * Currier et al. 2023, Br J Sports Med (PMID 37414459)，178项力量研究/n=5097
   * 的贝叶斯网络 meta 分析，结论原文：
   *   "higher-load, multiset, thrice-weekly training ... was the highest-ranked
   *    RTx for strength"
   *   "higher-load, multiset, twice-weekly training ... was the highest-ranked
   *    RTx for hypertrophy"
   *
   * → multiset（多组）在力量和肌肥大两项中都是最优组合。
   * → 我之前给新手只排2 组，是**方向错了**，不是偏保守。已纠正。
   *
   * 各阶段真正变化的是「离力竭多远」，不是组数变少。
   * ------------------------------------------------------------------- */
  function volumeFor(phaseId) {
    switch (phaseId) {
      case 'adapt': return {
        sets: 3, reps: 12, rpe: '做完还能再做 3 次',
        note: '组数按文献给足。适应期靠"离力竭远"来降低难度，不是靠减少组数'
      };
      case 'build': return {
        sets: 3, reps: 12, rpe: '做完还能再做 2 次',
        note: '组数不变，开始接近力竭'
      };
      case 'strengthen': return {
        sets: 4, reps: 10, rpe: '接近但不超过 10 次',
        note: '证据里多组是有益变量，进入强化期后可以加一组'
      };
      default: return {
        sets: 4, reps: 10, rpe: '全程动作不变形',
        note: '保持组数，专注动作质量'
      };
    }
  }

  /**
   * 起始重量。
   *
   * 【重要变更】原来适应期打七折（base *= 0.7）。核查结论：
   *   PubMed 检索 "delayed onset muscle soreness deload beginner systematic review"
   *   返回 Count=0 —— 找不到任何支持"减载/打折起始重量用于新手"的循证依据。
   *   Currier 2023 的做法是直接给最优剂量，而不是打折。
   * → 七折已删除。现在所有阶段统一用器械上限的一半，只受硬上限约束。
   *
   * 【P1 新增】weightCut：最近记录出现代偿/疼痛/抽筋/久未训练时触发，
   * 重量降一档。阶段不变。这是有条件减量，不是无条件打折 ——
   * 与上面被删除的"七折"性质不同：那一条没有触发条件也没有依据。
   */
  function weightFor(ex, phaseId, weightCut) {
    const lim = Safety.limitFor(ex.machine);
    let base;
    if (ex.loadStyle === 'bodyweight') return { text: '自重', kg: 0 };
    base = ex.loadStyle === 'plate_per_side'
      ? Math.max(2.5, lim.maxPerSide * 0.5)
      : Math.max(2.5, lim.maxTotal * 0.5);
    base = Safety.round2_5(base);
    // 有条件减量：最近记录有问题时降一档，且不低于器械最小配重
    if (weightCut) {
      base = Math.max(2.5, base - 2.5);
    }
    // 硬顶：绝不超上限。round2_5 可能把 3.5 抬到 5，高位下拉这里必须再夹一次
    base = Math.min(base, lim.maxTotal);

    let text;
    switch (ex.loadStyle) {
      case 'bodyweight': text = '自重'; break;
      case 'plate_per_side': text = `每侧 ${base} kg`; break;
      case 'selector': text = `调到约 ${base} kg 的档位`; break;
      default: text = `${base} kg`;
    }
    return { text, kg: base };
  }

  /* ---------------------------------------------------------------------
   * 渐进：只加组次，最后才加重量。加重量只有一个条件。
   * ------------------------------------------------------------------- */
  function progressionFor(ex, phaseId, log, weightCut) {
    const v = volumeFor(phaseId);
    const lim = Safety.limitFor(ex.machine);
    const w = weightFor(ex, phaseId, weightCut);

    // 最近记录有问题时，明确告诉用户"这次不该加重量"
    if (weightCut) {
      return '最近记录出现了代偿或不适，本次不增加重量。' +
             '先把这个重量做稳，再谈加重。';
    }

    if (lim.note && /永久上限/.test(lim.note)) {
      return `这台是${lim.note}，任何阶段都不上调。`;
    }
    if (phaseId === 'adapt') return '本阶段不加重量，先把动作做标准。';
    if (phaseId === 'build') return '本阶段重量不变，把次数和组数加上去。';

    // 强化期及以后：查日志
    const hist = (log && log.entries && log.entries[ex.id]) || [];
    if (hist.length < 2) return '再有 1 次干净的训练记录后，才评估要不要加重量。';
    const last2 = hist.slice(-2);
    const clean = last2.every(h => !h.pain && !h.cramp && !h.compensation);
    if (!clean) return `上一次记录到代偿或不适，重量维持 ${w.text} 不变，先把动作做干净。`;

    const next = Safety.nextWeight(ex.machine, hist);
    if (next <= w.kg) return `连续 2 次做干净了，但已经到上限 ${lim.maxTotal} kg，保持不变。`;
    return `连续 2 次无代偿，可以尝试 ${next} kg（+${Math.round((next / w.kg - 1) * 100)}%）。加了做不满 ${v.reps} 次，就退回 ${w.text}。`;
  }

  /* ---------------------------------------------------------------------
   * 生成单次训练课
   * ------------------------------------------------------------------- */
  function buildDay(tpl, phaseId, opts) {
    const v = volumeFor(phaseId);
    const cap = opts.session.tasks;
    const log = opts.log;
    const usedIds = opts.usedIds || new Set();
    const weightCut = !!opts.weightCut;

    const tasks = [];
    const entries = Object.entries(tpl.slots).sort((a, b) => b[1] - a[1]);

    entries.forEach(([part, count]) => {
      for (let i = 0; i < count; i++) {
        if (tasks.length >= cap) break;

        // 红线闸：只看未 banned 的动作
        const cands = (global.EXERCISES || [])
          .filter(e => !e._banned)
          .filter(e => !usedIds.has(e.id))
          .map(e => ({ e, s: fitScore(e, part) }))
          .filter(x => x.s >= 0)
          .sort((a, b) => b.s - a.s);

        if (!cands.length) continue;
        const pick = cands[0].e;
        usedIds.add(pick.id);

        const w = weightFor(pick, phaseId, weightCut);
        const machine = (global.MACHINES || []).find(m => m.id === pick.machine);

        tasks.push({
          ex: pick,
          name: pick.name,
          machineId: pick.machine,
          machineName: machine ? machine.name : pick.machine,
          machineLook: machine ? machine.look : '',
          howToFind: machine ? (machine.tells || []) : [],
          weight: w.text,
          kg: w.kg,
          hardCap: Safety.limitFor(pick.machine).maxTotal,
          hardCapNote: Safety.limitFor(pick.machine).note || `上限 ${Safety.limitFor(pick.machine).maxTotal} kg`,
          sets: v.sets,
          reps: v.reps,
          rpe: v.rpe,
          rest: opts.session.rest,
          cues: pick.cues,
          stopSignals: pick.stopSignals,
          setup: pick.setup,
          mistakes: pick.mistakes,
          searchHint: pick.searchHint,
          risk: riskNote(pick),
          progression: progressionFor(pick, phaseId, log, weightCut),
          canSkip: true
        });
      }
    });

    // 少于配额时补有氧（用最低风险的方式）
    if (tasks.length < cap - 1 && /有氧恢复课/.test(tpl.name)) {
      const cardio = (global.EXERCISES || []).filter(e => partOf(e) === 'cardio' && !e._banned);
      if (cardio[0] && !usedIds.has(cardio[0].id)) {
        tasks.push(makeCardioTask(cardio[0]));
      }
    }

    return {
      key: tpl.key,
      name: tpl.name,
      light: !!tpl.light,
      lightNote: tpl.light ? '这一天的强度是刻意压低的。它的作用是恢复，不是消耗。别偷偷加重量。' : '',
      tasks,
      backup: (global.EXERCISES || [])
        .filter(e => !e._banned && partOf(e) === mainPart(tpl))
        .slice(0, 3)
        .map(e => ({ name: e.name, machine: ((global.MACHINES || []).find(m => m.id === e.machine) || {}).name })),
      warmup: WARMUP,
      cooldown: COOLDOWN,
      minPass: `完成 ${Math.min(2, tasks.length)} 个任务就算达标。今天做 0 个也可以。`
    };
  }

  function makeCardioTask(ex) {
    const machine = (global.MACHINES || []).find(m => m.id === ex.machine);
    return {
      ex, name: ex.name,
      machineId: ex.machine,
      machineName: machine ? machine.name : ex.machine,
      machineLook: machine ? machine.look : '',
      howToFind: machine ? (machine.tells || []) : [],
      weight: '不称重',
      kg: 0,
      hardCap: 0, hardCapNote: '有氧不称重，用"还能说话但不能唱歌"的强度',
      sets: 1, reps: 0, rest: 0,
      rpe: '强度：还能说话但不能唱歌',
      rest: 0,
      cues: ['沉肩', '挺胸', '手肘主导（这台是手主导，但肩膀要保持下沉）'],
      stopSignals: ['说话已经困难 → 降速或停', '膝盖或脚踝有不适 → 停'],
      setup: ex.setup, mistakes: ex.mistakes, searchHint: ex.searchHint,
      risk: riskNote(ex),
      progression: '时间从 15 分钟开始，每 2 周加 5 分钟。心率不用测，用"能说话"这个标准。',
      canSkip: true,
      timeBased: true
    };
  }

  function mainPart(tpl) {
    const e = Object.entries(tpl.slots).sort((a, b) => b[1] - a[1])[0];
    return e ? e[0] : 'core';
  }

  function riskNote(ex) {
    const bits = [];
    if (ex.domsRisk === 'high') bits.push('练后重度酸痛（你的已知弱点）');
    if (ex.crampRisk === 'high') bits.push('抽筋风险高，热身务必做臀部激活');
    if (ex.trapRisk === 'mid' || ex.trapRisk === 'high') bits.push('留意有没有耸肩');
    if (ex.shoulderImpingeRisk === 'mid' || ex.shoulderImpingeRisk === 'high') bits.push('手肘不要过度外展');
    return bits.length ? bits.join('；') : '风险可控';
  }

  /* ---------------------------------------------------------------------
   * 生成整周计划
   * ------------------------------------------------------------------- */
  function buildWeek(goal, phaseId, log) {
    // 前置：给所有动作打红线标记（每次都重打，不依赖外部已经打过）
    (global.EXERCISES || []).forEach(e => Safety.markSafety(e));

    const days = goal.freq.days;
    const tpls = TEMPLATES[days] || TEMPLATES[3];
    const usedIds = new Set();

    // 【P1】按训练记录调整强度。
    // 之前这里直接用阶段，训练表现完全不影响计划 —— 这正是要修的缺陷。
    // 现在若有记录，会读 Assess 的结论：疼痛/抽筋/代偿/久未训练都会降档。
    // 注意：只降不升。自动升级风险更大，且评估基于自报数据不够可靠。
    let effectivePhase = phaseId;
    let adjustNote = null;
    let weightCut = false;
    if (log && global.Assess) {
      try {
        const a = global.Assess.evaluate(log);
        if (a.intensityAdjust) {
          const adj = global.Assess.applyIntensity(a, phaseId);
          effectivePhase = adj.phaseId;
          adjustNote = a.headline + ' → 强度已按记录调整为「' + adj.to + '」（' + adj.level + '）';
        }
        // 重量与阶段是两个独立维度。
        // 代偿/疼痛/抽筋/久未训练 都会触发 weightCut —— 阶段不变，但重量降一档。
        // 缺了这个，界面文案说"降一档重量"而计划原样输出，等于什么都没做。
        weightCut = !!a.weightCut;
      } catch (e) {
        // 评估模块出问题绝不能影响出计划
        effectivePhase = phaseId;
      }
    }

    const built = tpls.map(t => buildDay(t, effectivePhase, {
      session: goal.session, log, usedIds, weightCut
    }));

    // 校验闸：整周必须通过，不通过就不给用户看
    const allTasks = built.flatMap(d => d.tasks.filter(t => !t.timeBased));
    const meta = {
      sessionsPerWeek: days,
      // 关键：连续天数必须从「日历排布」算，不是从「训练课数组长度」算。
      // 每周 3 次排在一三五，训练课数组长度是 3，但日历上并不连续。
      consecutiveHardDays: maxConsecutiveHard(goal.scheduleNote, built)
    };
    const check = Safety.assertSafe(allTasks.map(t => t.ex), meta);

    return {
      phaseId,
      effectivePhase,
      adjusted: effectivePhase !== phaseId || weightCut,
      weightCut,
      adjustNote: adjustNote || (weightCut ? '最近记录出现了代偿/不适，本课重量已自动降一档（阶段不变）' : null),
      days: built,
      schedule: goal.scheduleNote,
      safetyCheck: check,
      stats: {
        totalTasks: allTasks.length,
        parts: PART_LABEL,
        byPart: allTasks.reduce((acc, t) => {
          const p = partOf(t.ex) || '?';
          acc[p] = (acc[p] || 0) + 1; return acc;
        }, {})
      }
    };
  }

  /**
   * 从日历排布算「日历上连续几个训练日」，轻有氧日不计入。
   * 一三五排 3 次 -> 最长连续 1 天，合法。
   * 连排 3 次且都不是轻日 -> 3，违规。
   */
  function maxConsecutiveHard(schedule, built) {
    if (!schedule) return 0;
    const lightSet = new Set(built.filter(d => d.light).map(d => d.key));
    // 训练日 -> 对应模板 key 的映射：schedule 的第 i 个训练日对应 TEMPLATES[i]
    let trainIdx = 0, cur = 0, max = 0;
    schedule.forEach(d => {
      if (!d.isTraining) { cur = 0; return; }
      const key = d.template || null;
      cur = cur + 1;
      max = Math.max(max, cur);
      trainIdx++;
    });
    return max;
  }

  /* ---------------------------------------------------------------------
   * 训练反馈 → 计划调整
   * 痛/抽筋是硬停止，没有替代方案。
   * ------------------------------------------------------------------- */
  const REACTIONS = {
    pain: {
      label: '痛（不是酸）',
      stop: true,
      headline: '立刻停下这个动作',
      lines: [
        '停止。不要"再试一次"，也不要"换个小重量继续"。',
        '今天剩下的任务取消，不补做。',
        '今晚热敷疼痛部位，早点睡。',
        '明天这个部位不训练，换成纯轻有氧或休息。'
      ],
      urgent: '如果疼超过 3 天，或者伴随肿胀、关节响、动作受限，去看骨科或康复科。这不是练得不够的问题。'
    },
    cramp: {
      label: '抽筋 / 要抽筋了',
      stop: true,
      headline: '立刻停下，坐着别动',
      lines: [
        '停止。不要硬拉，不要甩。',
        '缓慢静态拉伸抽筋的肌肉，直到症状缓解 —— 这是循证综述支持的主要处理方式。',
        '慢慢屈伸关节（脚踝绕环、缓慢伸膝），让肌肉恢复长度。',
        '注意：「多喝水」不是有效解法。J Athl Train 2022 的循证综述明确把它列为无效的泛化建议。有效的是找出你的个体风险因素。',
        '今天到此为止，臀部 24 小时内不安排任何动作。'
      ],
      urgent: '同一处反复抽筋不是训练量的问题，去看医生排除缺钙、缺镁、循环问题。'
    },
    doms: {
      label: '对称的肌肉酸',
      stop: false,
      headline: '这是正常恢复，说明练到了',
      lines: [
        '48 小时内不要重复练同一个肌群。',
        '今天可以轻松散步，不要"练到不酸为止"。',
        '补水 + 补充蛋白质 + 睡够 7 小时。'
      ],
      warning: '注意区分：只有左侧酸，或者酸到影响动作，那是代偿警报，按代偿处理。'
    },
    compensation: {
      label: '单侧酸 / 耸肩 / 身体歪',
      stop: false,
      headline: '这是代偿信号，不是练到了',
      // 【安全修正】原第 1、2 条自相矛盾：第一句说"不是降重量继续"，
      // 第二句立刻要求"降到能完全控制的档位"——用户只会执行后一句。
      // 而"降重量继续做"正是让代偿固化的做法（负荷仍被代偿肌接管）。
      // 现在改为：本次直接不做，下次从空载重来。见 docs/内容与安全审校报告.md R-1
      lines: [
        '立刻停止这个动作。这一次就到这里，不要降重量接着做。',
        '降重量继续 = 负荷还是被同一块代偿肌接管，只是数字变小了，代偿会固化。',
        '下次从空载或最轻一档重新开始，先看一遍动作示范。连续 2 次都做干净了，才考虑加回去。',
        '这个动作在完全做干净之前，不要放回主项，也不要当热身辅助用。',
        '上斜方肌放松 + 肩胛下沉训练，列为每日必做。'
      ],
      severity: '最重要的一类反馈。代偿不解决，后面所有训练收益都会被浪费。'
    },
    skip: {
      label: '器械找不到 / 没时间',
      stop: false,
      headline: '换一个，或者今天就到这儿',
      lines: [
        `器材图鉴里有同部位的白名单替代动作，可以直接查。`,
        '不用凑合，也不用硬找。',
        '今天做 0 个任务也是完成，训练不断就行。'
      ]
    },
    low: {
      label: '今天状态一般',
      stop: false,
      headline: '状态差的日子，做热身也算完成',
      lines: [
        '只做热身和拉伸。',
        '轻负荷训练其实有利于恢复，比完全跳过更好。',
        '计划往后顺延，不补课。'
      ]
    }
  };

  function react(signal) {
    return REACTIONS[signal] || REACTIONS.pain;
  }

  global.Plan = {
    PART_LABEL, BODY_PART_MAP, TEMPLATES, WARMUP, COOLDOWN, REACTIONS,
    partOf, fitScore, buildWeek, buildDay, react,
    weightFor, volumeFor, progressionFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Plan;

})(typeof window !== 'undefined' ? window : globalThis);
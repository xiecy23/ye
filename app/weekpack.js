/* =========================================================================
 * weekpack.js —— 8 周周包（把"四个笼统阶段"切成"八个看得见的小包"）
 * =========================================================================
 * 作用
 *   goal.js 的 PHASES 是四个阶段、每个阶段跨 2 周。用户在阶段里的两周看到
 *   的是同一个名字（"适应期"），没有"这周过完了"的感觉，也没有"这周到底
 *   做什么"的答案。
 *
 *   参考 Keep 的「第一周 | 暴汗运动」：把长周期切成命名的小包，用户看到的是
 *   "这周练什么"，不是一个抽象的阶段名。所以这里给 1–8 周每周一个短名字 +
 *   一句话目标 + 本周重点 + 一个"做到什么就算数"的 milestone。
 *
 *   本文件不改变任何训练内容。训练内容仍然由 plan.js 按 PHASES 生成 ——
 *   周包只是给同一份内容换一个"这周"的说法，让 8 周变成 8 个能记住的台阶。
 *
 * 【与 PHASES 的一致性】
 *   阶段信息（phaseId / phaseName / level / phaseProgress / isPhaseEnd）不是
 *   抄一份，而是运行时从 Goal.PHASES 读出来算的，所以阶段定义改了这里会跟着
 *   变。PACKS 里写的 phaseId 只用于 audit() 断言；若阶段周范围被改动导致
 *   周包挂错阶段，audit().problems 会直接报出来。详见 audit()。
 *
 * 导出（全局 WeekPack）
 *   WeekPack.forWeek(n)               返回第 n（1–8）周的包信息，见下方字段表
 *   WeekPack.all()                    返回 1–8 周的全部包（数组）
 *   WeekPack.renderInto(el, week)     往容器追加一个周包列表卡片，当前周高亮
 *   WeekPack.mountInto(el, week)      先清空容器再渲染（语义同 progress.js）
 *   WeekPack.audit()                  自检：阶段覆盖 / 周包覆盖 / 挂载一致性 / 禁用词
 *   WeekPack.PACKS                    8 个包的原始数据（只读参考）
 *   WeekPack.styleSheet()             注入的 CSS 文本（想并进 app.css 时用）
 *
 *   forWeek(n) 返回：
 *   {
 *     week: 3, phaseId: 'build', phaseName: '积累期',
 *     level: 'K2', levelLabel: '初学', phaseHeadline: '重量先不动，先把次数涨上去',
 *     phaseWeeks: '第 3–4 周',
 *     packName: '第 3 周 · 稳住动作', shortName: '稳住动作',
 *     goal: '这周的一句话目标', focus: '本周重点',
 *     loadRule: '这周关于重量的一句话规则',
 *     milestone: '做到什么算这周完成', note: '可选补充',
 *     isPhaseStart: false, isPhaseEnd: false, phaseProgress: '1/2'
 *   }
 *
 * 集成
 *   index.html 里放在 app.js 之前、progress.js 之后：
 *     <script src="app/progress.js"></script>
 *     <script src="app/weekpack.js"></script>
 *     <script src="app/app.js"></script>
 *   然后在 app.js 里调一次（放在 renderGoal() 的 phc 卡片后面最自然，
 *   因为那一页本来就是讲"这 8 周怎么走"的）：
 *     if (typeof WeekPack !== 'undefined') {
 *       try { WeekPack.mountInto(res, Log.load().week); } catch (e) {}
 *     }
 *   renderGoal() 每次切到「目标」页都会重跑，所以挂在这里不会重复渲染。
 *   currentWeek 传空时自动回落到 Log.load().week，读不到就是第 1 周。
 *
 * 硬约束：不修改 goal.js / app.js / index.html / app.css。本文件只新建节点
 *         和注入样式。
 *
 * 文案硬约束（本项目面向零基础新手，「做 0 项也算完成」）
 *   - 不出现：未达标、失败、落后、欠、必须完成
 *   - milestone 一律写成"做到什么就算数"，不写成"必须做到什么"
 *   - 没有 danger 配色。周包永远不会是"没完成"的错误状态
 *   ⚠️ audit() 里带禁用词扫描，但它只拦得住关键词，不要把 ok:true
  *     当作文案审校通过的依据。覆盖很窄：词表只有几个词、只扫
  *     goal/focus/loadRule/milestone/note 五个字段、不扫渲染层固定文案、
  *     也不扫 Goal.PHASES 里的文字。条件式晋升这类语义问题
  *     （例如“没做到就停在这周”）任何词表都扫不出来 —— 本项目已经因此
  *     漏掉过两条必须改的问题。语义级审查只能靠人读。
 * ========================================================================= */

(function (global) {
  'use strict';

  const STYLE_ID = 'weekpack-style';

  /* ====================================================================
   * 8 个周包
   *
   * 命名规则（Keep 风格）：短、口语、末尾落在动作上。前缀"第 N 周 · "由
   * forWeek() 拼，这里只存短名。
   *
   * 每个包的四段文案分工，写之前先想清楚，别混：
   *   goal      —— 这一周的一句话目标（为什么练）
   *   focus     —— 这周具体做什么（怎么做）
   *   loadRule  —— 这周关于重量的一句话规则（与 PHASES 语义对齐）
   *   milestone —— 做到什么就算数（不是"必须做到什么"）
   *   note      —— 可选的一句补充，通常是"这是本阶段最后一周"之类
   *
   * phaseId 只用于 audit() 断言，对外返回的阶段信息一律从 Goal.PHASES 现算。
   * ==================================================================== */
  const PACKS = [
    /* ---------------- 适应期（1–2 周）：不加重量，学动作 ---------------- */
    {
      week: 1,
      phaseId: 'adapt',
      shortName: '认识器械',
      goal: '把要用的几台机器认出来 —— 知道怎么坐、怎么调，比练到累重要得多。',
      focus: '跟着「今天练什么」里的机器清单，每台坐上去、调好位置，空载走 1 组就换下一台。认不出来的先拍照记下来，回头对照器材图鉴。',
      loadRule: '不加重量。用空载或最轻一档，先把动作走顺。',
      milestone: '能自己把本周要用的机器调好，就算数；一次只认一台也算。',
      note: '这周不追次数，也不追出汗量。'
    },
    {
      week: 2,
      phaseId: 'adapt',
      shortName: '打基础',
      goal: '每次训练全程做对 —— 不耸肩、不歪斜、不为了凑次数把动作做完。',
      focus: '每个动作 3 组 × 12 次，做完还能再做 3 次就停。出现耸肩或歪斜就停下这个动作（不是降重量继续），去反馈页记一条，下次从空载或最轻一档重新开始。',
      loadRule: '不加重量。这台机器现在多重，就一直是多重。',
      milestone: '连续 2 次训练全程没有耸肩、没有歪斜、没有不适，就算数 —— 做到 1 次也是好开始。',
      // 【文案修正】原为「做到上面那条就可以进下一阶段；没做到就停在这周继续，不赶时间」。
      // 「停在这周继续」是惩罚性措辞 —— "继续"在语境里等于"你还没通过"，
      // 与本文件 footer「做 0 项也算完成」自相矛盾。
      // 改成：这一条只是参考，不是门槛。
      note: '这是适应期的最后一周。上面那条是给你自己看的参考，不是门槛 —— 做到就自然往下走，没到就多待几天，两种都不影响后面。'
    },

    /* ---------------- 积累期（3–4 周）：重量不变，加次数 ---------------- */
    {
      week: 3,
      phaseId: 'build',
      shortName: '稳住动作',
      // 【文案修正】原为「把 3 组 × 12 次完整做下来」——
      // 「完整」是硬性量词，而同一条目的 milestone 写的是「做不满也没关系」，
      // 两段自相矛盾。改成与 milestone 一致的说法。
      goal: '同一个重量，把 3 组 × 12 次尽量做下来。做不满也算数，下次接着来。',
      focus: '重量保持不动，这周缺的是次数不是配重片。开始记训练日志：重量、次数、有没有代偿。',
      loadRule: '重量不变。这周动的是次数，不是配重片。',
      milestone: '有一次训练，同一个重量把 3 组 × 12 次做完，就算数；做不满也没关系，下次接着来。',
      note: '热身从这周开始加到 8 分钟，臀部激活别跳过。'
    },
    {
      week: 4,
      phaseId: 'build',
      shortName: '加次数',
      goal: '把次数练到第 3 组末尾动作还不变形。',
      focus: '开始接近力竭，但每组还能再做 2 次就停。第 3 组末尾仍然保持动作标准，是这周唯一要盯的事。',
      loadRule: '重量不变。次数加上去之后，第 3 组还做得干净。',
      // 【文案修正】原为「第 3 组做完动作还是标准的，就算数。」——
      // 丢了「3 组 × 12 次」这个训练量，与 goal.js 对应阶段的
      // exitCondition「能稳定完成 3 组 × 12 次，且第 3 组末尾动作仍然标准」
      // 不一致。用户按周包判断会以为不用看组数次数。
      milestone: '有一次训练，同一个重量把 3 组 × 12 次做完、第 3 组末尾动作还是标准的，就算数。做不满也没关系，下次接着来。',
      note: '这是积累期的最后一周。上面那条是参考，不是门槛 —— 想加重量就先看看它；不想加就先按现在的重量练，一样算数。'
    },

    /* ---------- 强化期（5–6 周）：满足条件才加重量（10–15%）
     * 【重要】高位下拉永久锁 5 kg（safety.js: high_pulldown maxTotal 5，
     * 因单臂 20 kg 代偿伤史，不随进度上调）。所以这两周的文案只能说
     * "挑一台试加"，绝不能写成"全面加重"。 */
    {
      week: 5,
      phaseId: 'strengthen',
      shortName: '试着加重',
      goal: '只挑已经做干净的那几台，试加 10–15%；其余保持原重量。',
      focus: '加重量只有一个条件：这台机器连续 2 次训练没有代偿、没有不适。高位下拉是例外 —— 它永久锁在 5 kg，任何阶段都不上调。',
      loadRule: '只有连续 2 次干净记录的那一台，才试加 10–15%。高位下拉始终 5 kg，不随进度上调。',
      milestone: '有一台在连续两次做干净之后试加了重量、加完还做得动，就算数。没到条件的那几台维持原重量，同样算数。',
      note: '这周最容易上头：不要全面加重，一次只动一台，加完做不满就退回去。'
    },
    {
      week: 6,
      phaseId: 'strengthen',
      shortName: '守住重量',
      goal: '把加过的那几台重新做干净；动作一变形就停掉那台，不要降重量接着做。',
      focus: '腿部训练降到每周 1 次，不超过器械上限。高位下拉还是 5 kg。这 2 周出现腿重度酸痛或臀部抽筋，这一阶段就顺延，不硬推进。',
      // 【安全修正】原为「动作一变形就降回去」。
      // 那是"降重继续"指令，与 plan.js:504「不要降重量接着做」、
      // 以及本文件第 2 周的「不是降重量继续」正面冲突。
      // 降重量继续做，负荷还是被同一块代偿肌接管，只是数字变小，代偿会固化。
      loadRule: '加过的那几台重新做干净。高位下拉还是 5 kg。动作一变形就停下这个动作，本次不再做它。',
      // 【安全修正】原为「有一次在动作变形的时候主动把重量降回来，就算数」。
      // 这把"降重继续"定义成了本周成就奖励，比单纯的指令错误更严重 ——
      // 等于告诉用户这是正确做法。改为奖励"主动停"这个正确动作。
      milestone: '有一次在动作变形的时候主动停掉那台机器、没有硬做完，就算数 —— 这就是这周真正的收获。',
      note: '这是强化期的最后一周。'
    },

    /* ------------- 巩固期（7–8 周）：不加重量，把动作变成本能 ------------- */
    {
      week: 7,
      phaseId: 'consolidate',
      shortName: '变成本能',
      goal: '不加重量，把节奏和幅度练到不用想。',
      focus: '每天 5 分钟体态专项：胸小肌拉伸、上斜方肌拉伸、胸椎活动度。训练时不再翻提示卡，靠身体记住怎么起、怎么收。',
      loadRule: '不加重量。',
      milestone: '不用翻提示卡就知道每台机器怎么调、每个动作怎么起，就算数。',
      note: '这周的目标是把动作从"照着做"变成"自然会"。'
    },
    {
      week: 8,
      phaseId: 'consolidate',
      shortName: '重新定目标',
      goal: '给这 8 周做一次收尾，然后重新选一个下个周期想解决的问题。',
      focus: '想试的话，主项试加 5% 感受一下就好，不追求突破。然后回到「目标」页，重新做一次 1 分钟评估，选下个周期的主攻方向。',
      loadRule: '不加重量。想试的话，主项试加 5% 感受一下就好，不追求突破。',
      milestone: '重新选一次目标、或者决定先休息一段，就算数 —— 两种都是这 8 周的正常收尾。',
      note: '第 8 周结束是重新评估，不是完成挑战领奖励。'
    }
  ];

  /* ====================================================================
   * 阶段表兜底
   *
   * 正常情况下阶段信息从 Goal.PHASES 现读（这样一致性由代码保证，不靠人工比对）。
   * 但 weekpack.js 可能被单独加载（比如单测、或脚本顺序被改动），那时 Goal 还不存在。
   * 这里只留必要字段做兜底，数值与 goal.js 对齐；一旦 goal.js 改了周范围，
   * audit() 会在 Goal 可用时报出不一致，不会静默错下去。
   * ==================================================================== */
  const FALLBACK_PHASES = [
    { id: 'adapt', weeks: [1, 2], name: '适应期', level: 'K1', levelLabel: '零基础',
      headline: '这两周唯一任务是「每次都做对」，不是练到累' },
    { id: 'build', weeks: [3, 4], name: '积累期', level: 'K2', levelLabel: '初学',
      headline: '重量先不动，先把次数涨上去' },
    { id: 'strengthen', weeks: [5, 6], name: '强化期', level: 'K2', levelLabel: '初学·可小幅加重',
      headline: '开始小幅加重量，但只有一个前提条件' },
    { id: 'consolidate', weeks: [7, 8], name: '巩固期', level: 'K3', levelLabel: '进阶·不加量',
      headline: '不加重量，把动作变成本能' }
  ];

  const TOTAL_WEEKS = 8;

  /* ====================================================================
   * 样式（前缀 .wk-，与 app.css / progress.js(.pg-) 零重叠）
   * 刻意没有任何 danger 配色 —— 周包永远不会是"没完成"的错误状态。
   * ==================================================================== */
  const CSS = `
.wk {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  padding: 14px;
  margin-bottom: 12px;
}
.wk-h { margin: 0 0 2px; font-size: 15px; font-weight: 650; color: var(--text); }
.wk-meta { margin: 0 0 10px; font-size: 11px; color: var(--text-faint); }
.wk-lead { margin: 0 0 10px; font-size: 14px; color: var(--text); }
.wk-list { list-style: none; margin: 0; padding: 0; }
.wk-item {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.wk-item:last-child { margin-bottom: 0; }
.wk-item.wk-cur { border-color: var(--accent); background: var(--accent-bg); }
.wk-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.wk-w { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.wk-nm { font-size: 15px; font-weight: 650; color: var(--text); }
.wk-ph { margin-left: auto; font-size: 11px; color: var(--text-dim); }
.wk-goal { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
.wk-item.wk-cur .wk-goal { color: var(--text); }
.wk-more { margin-top: 8px; font-size: 12.5px; color: var(--text-dim); }
.wk-more b { color: var(--text); }
.wk-ms {
  margin-top: 8px; font-size: 12.5px; color: var(--text-dim);
  background: var(--ok-bg); border-radius: 10px; padding: 8px 10px;
}
.wk-ms b { color: var(--ok); }
.wk-note { margin: 8px 0 0; font-size: 11px; color: var(--text-faint); }
.wk-foot { margin: 10px 0 0; font-size: 11px; color: var(--text-faint); }
@media (prefers-reduced-motion: reduce) { .wk-item { transition: none; } }
`;

  function ensureStyle() {
    if (!global.document || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.appendChild(document.createTextNode(CSS));
    document.head.appendChild(s);
  }

  /* ====================================================================
   * 小工具
   * ==================================================================== */

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 1–8 的整数；给不出合法值就当第 1 周，不抛错 */
  function normWeek(n) {
    const x = Math.floor(Number(n));
    if (!isFinite(x)) return 1;
    return Math.max(1, Math.min(TOTAL_WEEKS, x));
  }

  /** 阶段表：优先用 goal.js 的，读不到才回落兜底 */
  function phases() {
    const g = global.Goal;
    if (g && Array.isArray(g.PHASES) && g.PHASES.length) return g.PHASES;
    return FALLBACK_PHASES;
  }

  function phaseOfWeek(list, w) {
    for (let i = 0; i < list.length; i++) {
      const wk = list[i].weeks || [];
      if (w >= wk[0] && w <= wk[1]) return list[i];
    }
    return null;
  }

  function currentWeekFromLog() {
    try {
      const st = (global.Log && global.Log.load) ? global.Log.load() : null;
      if (st && st.week) return normWeek(st.week);
    } catch (e) { /* 日志坏了不该影响看周包 */ }
    return 1;
  }

  /* ====================================================================
   * 对外接口
   * ==================================================================== */

  /**
   * 第 n 周的包。阶段字段从 Goal.PHASES 现算，包文案从 PACKS 取。
   * 传入越界值会被夹到 1–8，不抛错。
   */
  function forWeek(n) {
    const w = normWeek(n);
    const list = phases();
    const ph = phaseOfWeek(list, w);
    const pack = PACKS.filter(function (p) { return p.week === w; })[0] || {};
    const wk = (ph && ph.weeks) || [w, w];
    const a = wk[0], b = wk[1];

    return {
      week: w,

      // —— 阶段信息：全部来自 Goal.PHASES，不是本地抄的 ——
      phaseId: ph ? ph.id : (pack.phaseId || ''),
      phaseName: ph ? ph.name : '',
      level: ph ? ph.level : '',
      levelLabel: ph ? ph.levelLabel : '',
      phaseHeadline: ph ? (ph.headline || '') : '',
      phaseWeeks: '第 ' + a + '–' + b + ' 周',

      // —— 本周包信息 ——
      packName: '第 ' + w + ' 周 · ' + (pack.shortName || (ph ? ph.name : '')),
      shortName: pack.shortName || '',
      goal: pack.goal || '',
      focus: pack.focus || '',
      loadRule: pack.loadRule || '',
      milestone: pack.milestone || '',
      note: pack.note || '',

      // —— 位置 ——
      isPhaseStart: w === a,
      isPhaseEnd: w === b,
      phaseProgress: (w - a + 1) + '/' + (b - a + 1)
    };
  }

  /** 1–8 周的全部包 */
  function all() {
    const out = [];
    for (let w = 1; w <= TOTAL_WEEKS; w++) out.push(forWeek(w));
    return out;
  }

  /* ====================================================================
   * 自检
   *
   * 这是"与 PHASES 的一致性怎么核对"的答案：不靠人眼比对，靠这个函数。
   * 四类断言：
   *   1. 阶段表是否覆盖 1–8 周（有空洞就是 goal.js 被改坏了）
   *   2. PACKS 是否覆盖 1–8 周
   *   3. 每个周包挂的阶段，是否与阶段表的周范围一致
   *   4. 文案里有没有出现禁用词（施压类表述）
   * ==================================================================== */
  // 「欠」是单字扫描，宁可误报不可漏报（"欠缺""欠佳"会被拦下来，改个说法即可）。
  // 其余四条是词组，不会误伤正常中文。
  const BANNED_WORDS = [
    '未达标', '失败', '落后', '欠', '必须完成',
    // 以下为本轮审校后补入。原词表只拦否定式，漏掉了「达标」的肯定式
    // 以及条件式晋升的常用词（见 docs/新增模块文案审校.md W-3）。
    '达标', '没做到', '做不到', '停在这周', '完整做下来'
  ];

  /** 渲染层的固定文案：用户每次打开都会看到，但不在 FIELDS 里 */
  const RENDER_TEXT = [
    '8 周安排 · 每周一个小包',
    '练几次、做几项都行，做 0 项也算完成'
  ];

  function audit() {
    const problems = [];
    const list = phases();

    // 1. 阶段覆盖 1–8
    const covered = [];
    list.forEach(function (p) {
      (p.weeks || []).forEach(function (w) { covered.push(w); });
    });
    for (let w = 1; w <= TOTAL_WEEKS; w++) {
      if (covered.indexOf(w) < 0) problems.push('阶段表没有覆盖第 ' + w + ' 周');
    }

    // 2. PACKS 覆盖 1–8
    const packed = PACKS.map(function (p) { return p.week; });
    for (let w = 1; w <= TOTAL_WEEKS; w++) {
      if (packed.indexOf(w) < 0) problems.push('周包缺第 ' + w + ' 周');
    }

    // 3. 挂载一致性：PACKS.phaseId 必须与阶段表的周范围一致
    PACKS.forEach(function (p) {
      const ph = phaseOfWeek(list, p.week);
      if (!ph) { problems.push('第 ' + p.week + ' 周找不到对应阶段'); return; }
      if (ph.id !== p.phaseId) {
        problems.push('第 ' + p.week + ' 周的包挂在 ' + p.phaseId +
                      '，但阶段表里这一周属于 ' + ph.id + '（阶段周范围变了，包名要重写）');
      }
    });

    // 4. 禁用词扫描
    const FIELDS = ['goal', 'focus', 'loadRule', 'milestone', 'note'];
    const scan = function (label, text) {
      BANNED_WORDS.forEach(function (bad) {
        if (String(text || '').indexOf(bad) >= 0) {
          problems.push(label + ' 出现禁用词「' + bad + '」');
        }
      });
    };
    PACKS.forEach(function (p) {
      FIELDS.forEach(function (k) {
        scan('第 ' + p.week + ' 周的 ' + k, p[k]);
      });
    });
    // 渲染层固定文案：用户每次打开都看得到，原来不在扫描范围内
    RENDER_TEXT.forEach(function (t, i) {
      scan('渲染层固定文案 #' + (i + 1), t);
    });
    // Goal.PHASES 的 rules（会显示在目标页）
    // 注意：exitCondition 刻意不扫禁用词 —— 它是内部判据字段，
    // 本来就要表达"什么算达标"，出现「达标」二字是正确的。
    // 只有否定的「未达标」才是问题。把两类字段用同一套词表扫描是错的。
    (list || []).forEach(function (ph) {
      (ph.rules || []).forEach(function (r, i) {
        scan(ph.name + ' 的 rules[' + i + ']', r);
      });
    });

    return {
      ok: problems.length === 0,
      problems: problems,
      phases: list.length,
      packs: PACKS.length,
      fromGoal: !!(global.Goal && Array.isArray(global.Goal.PHASES)),
      // 明确声明覆盖边界，避免下一个人看到 ok:true 就认为审校通过。
      // 本项目已经因为这个误读漏掉过两条必须改的问题（见 docs/新增模块文案审校.md W-3）。
      covers: {
        keywordScan: true,
        fields: ['goal', 'focus', 'loadRule', 'milestone', 'note', 'RENDER_TEXT',
                 'Goal.PHASES.rules'],
        notCovered: [
          '语义级施压（条件式晋升、隐性倒计时等）——任何词表都扫不出来，只能人读',
          '渲染层动态拼接的文案',
          '其它模块（progress / compensation / plan / onboarding）的文案'
        ],
        note: 'ok:true 只代表关键词扫描通过，不代表文案审校通过。'
      }
    };
  }

  /* ====================================================================
   * 渲染
   * ==================================================================== */

  let seq = 0;

  function item(p, cur) {
    const isCur = p.week === cur;
    const li = el('li', 'wk-item' + (isCur ? ' wk-cur' : ''));
    if (isCur) li.setAttribute('aria-current', 'step');

    const row = el('div', 'wk-row');
    row.appendChild(el('span', 'wk-w', '第 ' + p.week + ' 周'));
    row.appendChild(el('span', 'wk-nm', esc(p.shortName)));
    row.appendChild(el('span', 'wk-ph',
      esc(p.phaseName + ' · ' + p.phaseProgress) + (p.isPhaseEnd ? ' · 阶段末' : '')));
    li.appendChild(row);

    li.appendChild(el('p', 'wk-goal', esc(p.goal)));

    // 只有当前周展开细节 —— 8 周全展开太长，反而没人看
    if (isCur) {
      li.appendChild(el('div', 'wk-more', '<b>这周重点：</b>' + esc(p.focus)));
      li.appendChild(el('div', 'wk-more', '<b>这周重量：</b>' + esc(p.loadRule)));
      li.appendChild(el('div', 'wk-ms', '<b>做到什么就算数：</b>' + esc(p.milestone)));
      if (p.note) li.appendChild(el('p', 'wk-note', esc(p.note)));
    }
    return li;
  }

  function build(currentWeek) {
    ensureStyle();
    const cur = normWeek(currentWeek == null ? currentWeekFromLog() : currentWeek);
    const p = forWeek(cur);

    const card = el('section', 'wk');
    const hid = 'wk-h-' + (++seq);
    card.setAttribute('aria-labelledby', hid);

    const h = el('h3', 'wk-h', '8 周安排 · 每周一个小包');
    h.id = hid;
    card.appendChild(h);

    card.appendChild(el('p', 'wk-meta',
      '你现在在第 ' + cur + ' 周 · ' + esc(p.phaseName) +
      ' · 本阶段第 ' + p.phaseProgress + ' 周 · ' + esc(p.phaseWeeks)));
    card.appendChild(el('p', 'wk-lead', esc(p.packName) + ' —— ' + esc(p.goal)));

    const ol = el('ol', 'wk-list');
    all().forEach(function (x) { ol.appendChild(item(x, cur)); });
    card.appendChild(ol);

    card.appendChild(el('p', 'wk-foot',
      '每个包只讲这一周做什么。练几次、做几项都行，做 0 项也算完成 —— ' +
      '包不会因为少练一次就作废。'));
    return card;
  }

  /** 追加渲染（不清空容器），语义同 progress.js 的 renderInto */
  function renderInto(container, currentWeek) {
    if (!container || !container.appendChild) return null;
    const card = build(currentWeek);
    container.appendChild(card);
    return card;
  }

  /** 先清空再渲染，语义同 progress.js 的 mountInto */
  function mountInto(container, currentWeek) {
    if (!container || !container.appendChild) return null;
    container.innerHTML = '';
    return renderInto(container, currentWeek);
  }

  const WeekPack = {
    PACKS: PACKS,
    forWeek: forWeek,
    all: all,
    audit: audit,
    renderInto: renderInto,
    mountInto: mountInto,
    currentWeek: currentWeekFromLog,
    normWeek: normWeek,
    styleSheet: function () { return CSS; }
  };
  global.WeekPack = WeekPack;
  if (typeof module !== 'undefined' && module.exports) module.exports = WeekPack;

})(typeof window !== 'undefined' ? window : globalThis);

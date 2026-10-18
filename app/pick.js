/* =========================================================================
 * pick.js —— 自选动作的合理性判定
 * =========================================================================
 * 存在的理由：原来的产品是"我替你决定练什么"。但零基础新手进健身房
 * 最大的困惑之一恰恰是"我想练这个行不行"——系统不回答，他就只能问人。
 *
 * 定位：让用户自己选，然后给判断。**不是审批，是解释。**
 *
 * 四档而不是两档。理由：只有"可以/不可以"，用户会觉得系统在管他；
 * 而实际上大部分选择是"可以，但有条件"。分四档能把红线（不可协商）
 * 和风险偏好（可以商量）区分开。
 *
 *   ok       今天就能做
 *   caution  能做，但有条件（说清条件是什么）
 *   avoid    今天不建议（不是永远不做）
 *   stop     不要做（红线，不可协商）
 *
 * 硬性原则：
 *   - 不可协商的红线只有 Safety 那一套，本模块不新增红线
 *   - "avoid" 必须给出"什么时候可以回来做"，不能只否决不给出路
 *   - 用户的选择被记录下来，但不改变系统的阶段安排
 * ======================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
   * 档案前提
   * 这一层完全来自 SAFETY_PROFILE，改档案这里自动跟着变。
   * 单独列出来是为了让"为什么这条不合理"能指回档案，而不是硬编码。
   * ------------------------------------------------------------------- */
  function why(cond, text) { return cond ? text : ''; }

  /** 学员档案里记着的伤 —— 这些是"个人化"的判断依据，不是通用规则 */
  function historyNotes(ex) {
    const out = [];
    const m = ex.machine;
    const name = ex.name || '';

    // 单臂高位下拉 20kg 的伤史：高位下拉类动作必须双手、必须低重量
    if (/下拉|pulldown/.test(m) || /下拉/.test(name)) {
      out.push('你有单臂高位下拉 20kg 的伤史（当时左斜方肌严重代偿）。' +
               '所以这一类只做双手对称，而且重量有永久上限。');
    }
    // 臀部极易抽筋
    if (ex.crampRisk === 'high' && /臀|glute|hip/.test(m + name)) {
      out.push('你的臀部很容易抽筋。这个动作的抽筋风险标的是高，' +
               '练之前先把髋部活动开。');
    }
    // 左侧上斜方肌长期紧张
    if (ex.trapRisk === 'high' || /斜方/.test(name)) {
      out.push('左侧上斜方肌长期紧张，很容易在这个动作上抢活。' +
               '有耸肩的感觉就是错了，不是"练到了"。');
    }
    // 腿后侧酸痛严重
    if (ex.domsRisk === 'high' && /leg|腿|hamstring|curl/.test(m + name)) {
      out.push('你的腿部酸痛（延迟性肌肉酸痛）会比较重，' +
               '练完接下来两天上下楼梯会明显感觉到。');
    }
    return out;
  }

  /* ---------------------------------------------------------------------
   * 核心判定
   * ------------------------------------------------------------------- */
  function judge(exId) {
    const all = global.EXERCISES || [];
    const ex = all.find(function (e) { return e.id === exId; });
    if (!ex) {
      return {
        level: 'unknown', levelLabel: '没找到这个动作',
        headline: '这个动作不在库里',
        detail: '可能是名字对不上。换一个说法搜一次试试。',
        actions: []
      };
    }

    // 打一次红线标记（不依赖外部已经打过）
    const marked = global.Safety.markSafety(Object.assign({}, ex));

    const base = {
      exercise: ex,
      machine: ex.machine,
      level: 'ok',
      levelLabel: '今天就能做',
      headline: '',
      detail: '',
      // reasons 分三类：红线 / 个人档案 / 常规提示
      blockers: [],
      notes: [],
      historyNotes: [],
      conditions: [],
      cap: null,
      ok: true
    };

    /* ---------- 第 1 层：红线（不可协商） ---------- */
    if (marked._banned) {
      // safety.js 的 _banReasons 是 {type, why} 对象数组，不是字符串数组。
      // 直接塞进 blockers 会让界面显示 [object Object]。
      const reasons = (marked._banReasons || []).map(function (r) {
        return (r && typeof r === 'object')
          ? ('【' + (r.type || '红线') + '】' + (r.why || ''))
          : String(r);
      });
      base.level = 'stop';
      base.levelLabel = '不要做';
      base.ok = false;
      base.headline = '这个动作在红线里';
      base.blockers = reasons.length ? reasons : ['它属于项目禁止的类别'];
      base.detail = '这一条不是我的偏好，是硬规则 —— 你的情况（' +
                    '左高右低、左侧上斜方肌易代偿、单臂高位下拉伤史）' +
                    '让这类动作的风险没法靠降难度解决。';
      base.conditions = ['换一个同部位、同为固定器械的动作'];
      return base;
    }

    // 红线之外的高危标记：引擎放行，但风险明确
    if (ex.trapRisk === 'high') {
      base.blockers.push('上斜方肌代偿风险标为高：你的左侧上斜方肌长期紧张，' +
                         '这类动作最容易让它抢活');
    }
    if (ex.shoulderImpingeRisk === 'high') {
      base.blockers.push('肩峰撞击风险标为高');
    }

    /* ---------- 第 2 层：档案相关 ---------- */
    base.historyNotes = historyNotes(ex);

    /* ---------- 第 3 层：当天状态 ---------- */
    let st = null;
    try {
      st = (global.Log && global.Log.load) ? global.Log.load() : null;
    } catch (e) { st = null; }

    let recentPain = false, recentComp = false, daysSince = null;
    if (st) {
      const all2 = Object.values(st.entries || {}).flat();
      // 必须按时间排序。Object.values().flat() 的顺序是 key 的插入顺序，
      // 不是记录的时间顺序 —— 直接 slice(-N) 取到的不是"最近 N 次"。
      // assess.js 里是排过序的，这里漏了会导致"最近记过痛"判断失效。
      const chrono = all2.slice().sort(function (a, b) {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
      const recent = chrono.slice(-6);
      recentPain = recent.some(function (e) { return e.pain; });
      recentComp = recent.some(function (e) { return e.compensation; });
      if (chrono.length) {
        const last = new Date(chrono[chrono.length - 1].date).getTime();
        daysSince = Math.floor((Date.now() - last) / 864e5);
      }
    }

    /* ---------- 组装文案 ---------- */
    const lim = global.Safety.limitFor(ex.machine);
    if (lim && lim.maxTotal) base.cap = lim;

    if (base.blockers.length) {
      base.level = 'avoid';
      base.levelLabel = '今天不建议';
      base.ok = false;
      base.headline = '能选，但今天先别做这个';
      base.conditions = [
        '等你最近几次训练里没有代偿了，再回来做',
        '真想做的话，把重量降到 ' + (base.cap ? Math.max(2.5, Math.min(5, base.cap.maxTotal / 2)) : 2.5) +
          ' kg 起，全程一旦耸肩或身体歪就停掉这个动作'
      ];
    } else if (ex.domsRisk === 'high' || ex.crampRisk === 'high') {
      base.level = 'caution';
      base.levelLabel = '能做，有条件';
      base.conditions = [
        ex.crampRisk === 'high'
          ? '练之前先做髋部激活，有抽筋前兆（那种突然绷紧的感觉）立刻停'
          : '重量降到能稳稳做完 12 次为止，不冲次数',
        '这次只做这一台，别连着做同类动作'
      ];
    } else if (base.historyNotes.length) {
      base.level = 'caution';
      base.levelLabel = '能做，注意一点';
      base.conditions = [
        '重量用 ' + (base.cap ? Math.max(2.5, base.cap.maxTotal / 2) : 2.5) + ' kg 起步，不要一次加太多',
        '全程留意有没有耸肩或单侧酸 —— 有就停掉这个动作，下次从空载重来'
      ];
    }

    if (base.ok) {
      base.headline = '可以练这台';
      base.detail = '重量从 ' + (base.cap ? Math.max(2.5, base.cap.maxTotal / 2) : 2.5) +
                    ' kg 起（器械上限的一半）。' +
                    '做的时候不用力竭，能再做 3 次就停。';
    }

    base.notes.push(
      (ex.stopSignals || []).slice(0, 2).join('；')
    );

    /* ---------- 第四层：当天身体状态覆盖前面 ---------- */
    if (recentPain && base.ok) {
      base.level = 'avoid';
      base.levelLabel = '今天不建议';
      base.ok = false;
      base.headline = '你最近记过痛，今天先不加新东西';
      base.detail = '最近几次记录里有痛。痛不是"练得不够"，是身体在叫停。' +
                    '今天做你已经在做的那些就行，别试没做过的动作。';
      base.conditions = ['等痛彻底消失，再考虑加新动作'];
      return base;
    }
    if (recentComp && base.ok && base.level === 'ok') {
      base.level = 'caution';
      base.levelLabel = '能做，但先别加新';
      base.detail = '最近几次记录里有过代偿。先把已经在做的动作做干净，' +
                    '新动作等稳定了再加。';
    }

    // 太久没练
    if (daysSince != null && daysSince >= 10 && base.ok && base.level === 'ok') {
      base.level = 'caution';
      base.levelLabel = '能做，先减量';
      base.detail = '已经 ' + daysSince + ' 天没训练了。今天重新开始用最轻的一档，' +
                    '别按以前的重量。';
      base.conditions = ['第一课用最轻重量找回感觉'];
    }

    return base;
  }

  /* ---------------------------------------------------------------------
   * 批量：今天想练这些，一起判定
   * 逐个给结论，再给一句整体建议 —— 不拦着不让练多个。
   * ------------------------------------------------------------------- */
  function judgeSet(ids) {
    const list = (ids || []).map(judge).filter(function (r) { return r.level !== 'unknown'; });
    const counts = { ok: 0, caution: 0, avoid: 0, stop: 0 };
    list.forEach(function (r) { counts[r.level]++; });

    let summary;
    if (!list.length) {
      summary = '还没有选动作。';
    } else if (counts.stop) {
      summary = '有 ' + counts.stop + ' 个在红线里，不能做。' +
                '其余的你自己决定 —— 系统只负责指出不该做的。';
    } else if (counts.avoid) {
      summary = '有 ' + counts.avoid + ' 个今天不建议做。' +
                '想练就练剩下的那几个，不用管系统怎么说。';
    } else if (counts.caution) {
      summary = '都能做，其中 ' + counts.caution + ' 个有条件。' +
                '把下面的条件看完再上机器。';
    } else {
      summary = '这几个都可以，按你平时的重量做就行。';
    }

    return {
      results: list,
      counts: counts,
      summary: summary,
      canDoCount: counts.ok + counts.caution
    };
  }

  /** 供界面筛选：只显示能做的 */
  function filterAllowed(ids) {
    return (ids || []).filter(function (id) { return judge(id).ok; });
  }

  global.Pick = {
    judge, judgeSet, filterAllowed,
    LEVELS: {
      ok: { key: 'ok', label: '今天就能做' },
      caution: { key: 'caution', label: '能做，有条件' },
      avoid: { key: 'avoid', label: '今天不建议' },
      stop: { key: 'stop', label: '不要做' }
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Pick;

})(typeof window !== 'undefined' ? window : globalThis);
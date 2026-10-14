/* =========================================================================
 * log.js —— 训练日志 + 进度状态
 * =========================================================================
 * 数据全部存在手机浏览器的 localStorage 里，不上传任何服务器。
 * 这是日志存在的唯一理由：给渐进规则提供依据。
 * 没有日志，引擎只能按日期推阶段；有了日志，引擎按"你做干净了没有"推。
 * ========================================================================= */

(function (global) {
  'use strict';

  const KEY = 'fitcoach.state';

  /* ---------------------------------------------------------------------
   * localStorage 不可用时的内存兜底。
   * 必须有这一层：iOS Safari 无痕模式下访问 localStorage 会直接抛
   * SecurityError，Recognize 的拍照功能也是同一个存储。没有兜底的话，
   * 一个异常就能让整个应用白屏。
   * ------------------------------------------------------------------- */
  const mem = {};
  const storage = (function () {
    try {
      const t = '__t__';
      localStorage.setItem(t, '1');
      localStorage.removeItem(t);
      return localStorage;
    } catch (e) {
      return {
        getItem: k => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; }
      };
    }
  })();

  const DEFAULT = {
    goal: null,          // Goal.derive() 的结果
    phaseIndex: 0,       // 当前处于哪个阶段
    week: 1,
    entries: {},         // { exerciseId: [ {date, sets, reps, kg, pain, cramp, compensation, note} ] }
    sessions: [],        // [{date, dayKey, done:[exIds], feel:'good'|'ok'|'bad', note}]
    lastSignal: null,    // 最近一次反馈，用于计划页提示
    goalHistory: [],     // 换过的目标存档：[{pain, short, startedAt, endedAt, sessions, entries}]
    createdAt: null
  };

  function load() {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return Object.assign({}, DEFAULT, { createdAt: new Date().toISOString() });
      const s = JSON.parse(raw);
      // 补齐新增字段，兼容旧数据
      return Object.assign({}, DEFAULT, s);
    } catch (e) {
      return Object.assign({}, DEFAULT, { createdAt: new Date().toISOString() });
    }
  }

  function save(state) {
    storage.setItem(KEY, JSON.stringify(state));
    return state;
  }

  function update(fn) {
    const s = load();
    const r = fn(s);
    save(s);
    return r;
  }

  /* ---------------------------------------------------------------------
   * 记录一次动作执行
   * ------------------------------------------------------------------- */
  function logExercise(exId, data) {
    return update(s => {
      if (!s.entries[exId]) s.entries[exId] = [];
      s.entries[exId].push(Object.assign({
        date: new Date().toISOString(),
        sets: 0, reps: 0, kg: 0,
        pain: false, cramp: false, compensation: false, note: ''
      }, data || {}));
      // 只保留最近 12 条，防止无限增长
      if (s.entries[exId].length > 12) s.entries[exId] = s.entries[exId].slice(-12);
      return s.entries[exId];
    });
  }

  /* ---------------------------------------------------------------------
   * 记录一次训练课
   * ------------------------------------------------------------------- */
  function logSession(dayKey, doneExIds, feel, note) {
    return update(s => {
      s.sessions.push({
        date: new Date().toISOString(),
        dayKey,
        done: doneExIds || [],
        feel: feel || 'ok',
        note: note || ''
      });
      if (s.sessions.length > 60) s.sessions = s.sessions.slice(-60);
      return s.sessions;
    });
  }

  function setLastSignal(signal) {
    return update(s => { s.lastSignal = signal; return signal; });
  }

  /**
   * 设定 / 切换目标。
   *
   * 【借鉴 Keep 后修正】原实现是"换了痛点就清空全部 entries 和 sessions"，
   * 理由是"旧数据对新目标没参考价值"。这个判断是错的：
   *
   *   entries（做了几组、有没有代偿、有没有痛）反映的是**动作控制能力**，
   *   这部分不随目标变化 —— 你换目标不会突然忘记怎么沉肩。
   *   phaseIndex / week 反映的是**当前目标的进度**，这个才该重置。
   *
   * Keep 的做法是随时能换课程包而不丢历史。所以现在：
   *   - 保留 entries / sessions（用户的资产，也是 Assess 的评估依据）
   *   - 重置 phaseIndex / week（新目标从头开始）
   *   - 把旧目标存档到 goalHistory，可回看"我练过哪几个目标"
   */
  function setGoal(goal) {
    return update(s => {
      const changed = s.goal && s.goal.pain !== goal.pain;

      if (changed) {
        s.goalHistory = s.goalHistory || [];
        const ents = Object.values(s.entries || {}).flat();
        s.goalHistory.push({
          pain: s.goal.pain,
          short: s.goal.short,
          statement: s.goal.statement,
          startedAt: s.createdAt || null,
          endedAt: new Date().toISOString(),
          sessions: (s.sessions || []).length,
          entries: ents.length,
          // 记录切换时的身体信号，方便回看"为什么换目标"
          hadPain: ents.filter(e => e.pain).length,
          hadCramp: ents.filter(e => e.cramp).length
        });
        if (s.goalHistory.length > 10) s.goalHistory = s.goalHistory.slice(-10);

        // 只重置目标进度，不动训练记录
        s.phaseIndex = 0;
        s.week = 1;
      }

      s.goal = goal;
      if (!s.createdAt) s.createdAt = new Date().toISOString();
      return goal;
    });
  }

  /** 当前目标已经练了多久 / 多少次 */
  function goalProgress(s) {
    const st = s || load();
    const all = Object.values(st.entries || {}).flat();
    return {
      sessions: (st.sessions || []).length,
      entries: all.length,
      clean: all.filter(e => !e.pain && !e.cramp && !e.compensation).length,
      compensation: all.filter(e => e.compensation).length,
      pain: all.filter(e => e.pain).length,
      cramp: all.filter(e => e.cramp).length,
      history: (st.goalHistory || []).slice().reverse()
    };
  }

  function advancePhase() {
    return update(s => {
      if (s.phaseIndex < 3) s.phaseIndex += 1;
      s.week = Goal.PHASES[s.phaseIndex].weeks[0];
      return Goal.PHASES[s.phaseIndex];
    });
  }

  /**
   * 退阶。
   * 只在用户明确点击时执行 —— 系统只给建议，不自动改。
   * 理由：评估基于自报数据，误报时自动降级会打击积极性，
   * 而自动升级风险更大。所以两个方向都交给人决定。
   */
  function retreatPhase() {
    return update(s => {
      if (s.phaseIndex > 0) s.phaseIndex -= 1;
      s.week = Goal.PHASES[s.phaseIndex].weeks[0];
      return Goal.PHASES[s.phaseIndex];
    });
  }

  function resetWeek() {
    return update(s => { s.week += 1; return s.week; });
  }

  function resetAll() {
    storage.removeItem(KEY);
    return Object.assign({}, DEFAULT, { createdAt: new Date().toISOString() });
  }

  /* ---------------------------------------------------------------------
   * 本周时间窗：周一 00:00 ~ 下周一 00:00（本地时区）
   *
   * 【口径统一】原先这里用"滚动 7 天"（Date.now() - 7*864e5），
   * 而 progress.js 用周一到周日。结果：周日那天反馈页的「近 7 天 N 次」
   * 会比计划页的「本周 N 次」多 1，两个数字互相打架。
   * 现在统一走这一个函数，progress.js 也调用它。
   * ------------------------------------------------------------------- */
  function weekStart(now) {
    const d = now ? new Date(now) : new Date();
    d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7;   // 0 = 周一
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }

  function inThisWeek(dateStr, now) {
    const t = new Date(dateStr).getTime();
    return t >= weekStart(now) && t < weekStart(now) + 7 * 864e5;
  }

  /* ---------------------------------------------------------------------
   * 统计
   * ------------------------------------------------------------------- */
  function stats(s) {
    const st = s || load();
    const all = Object.values(st.entries).flat();
    return {
      totalSessions: st.sessions.length,
      totalExercises: all.length,
      painCount: all.filter(e => e.pain).length,
      crampCount: all.filter(e => e.cramp).length,
      compensationCount: all.filter(e => e.compensation).length,
      // 与 progress.js 同源，不再是滚动 7 天
      thisWeek: st.sessions.filter(x => inThisWeek(x.date)).length
    };
  }

  /** 出勤率：实际 / 应出勤。用于"习惯"目标的及格线 */
  function attendance(s) {
    const st = s || load();
    if (!st.goal) return null;
    const weeks = Math.max(1, Math.ceil(
      (Date.now() - new Date(st.createdAt || Date.now()).getTime()) / (7 * 864e5)
    ));
    const expected = st.goal.freq.days * weeks;
    return {
      done: st.sessions.length,
      expected,
      rate: expected ? Math.round(st.sessions.length / expected * 100) : 0
    };
  }

  /** 导出全部数据（备份用，纯文本） */
  function exportAll() {
    return JSON.stringify(load(), null, 2);
  }

  global.Log = {
    load, save, update,
    logExercise, logSession, setLastSignal, setGoal, goalProgress,
    advancePhase, retreatPhase, resetWeek, resetAll,
    stats, attendance, exportAll, weekStart, inThisWeek
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Log;

})(typeof window !== 'undefined' ? window : globalThis);
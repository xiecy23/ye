/* =========================================================================
 * progress.js —— 本周完成度（单一闭环数字）
 * =========================================================================
 * 参考 Keep 的「运动消耗 569 / 600 千卡」：一个数 + 一句话 + 一条进度。
 * 但这个项目的用户是零基础新手，Keep 那套"还差 31 千卡"的紧迫感在这里是
 * 反效果 —— 一次没去满就会开始解释、补救、然后放弃。
 *
 * 所以这里的规则是硬约束，不是风格偏好：
 *   - 永远不说"未达标""没完成""欠""差""失败"，没有百分比告警，没有红色。
 *   - done > 0 就是"这就算数"。目标只作为背景信息出现，不作为扣分依据。
 *   - done === 0 说的是"哪天来都行"，不是"你今天没练"。
 *   - done >= expected 直接说练够了，并且把话头引向休息，不引向加量。
 *
 * 计算口径（和计划引擎保持一致）
 *   - 「本周」= 周一到周日，和 Goal.buildSchedule 的 dow=0=周一 对齐。
 *     注意 Log.stats().thisWeek 是滚动 7 天、Log.attendance() 按 createdAt 推，
 *     三个口径互不相同，见 docs/ux-integration.md 的已知不一致。
 *   - done = 本周 sessions 条数（点"练完勾一下"记一条，做 0 项也记）。
 *   - sets = 本周 entries 里 sets 之和（点"记一次执行"记一条）。
 *
 * 导出（全局 Progress）
 *   Progress.compute(state)  返回 {done, expected, ratio, headline, detail, ...}
 *   Progress.mountInto(el)   清空容器并渲染成一个卡片，返回节点
 *   Progress.renderInto(el)  只追加不清空
 *   Progress.styleSheet()    拿注入的 CSS 文本（想并进 app.css 时用）
 *
 * 集成
 *   index.html 里放在 app.js 之前：<script src="app/progress.js"></script>
 *   在 app.js 的 renderPlan() 里调一次 Progress.mountInto(box) 即可，
 *   因为 renderPlan() 每次切到「计划」页都会重跑。
 * ========================================================================= */

(function (global) {
  'use strict';

  const STYLE_ID = 'progress-style';

  const CSS = `
/* =========================================================================
   progress 样式
   前缀 .pg-，与 app.css 类名零重叠。颜色复用既有变量，不引入新配色。
   注意：这里刻意没有任何 danger / warn 色。完成度永远不会是"错误状态"。
   ========================================================================= */
.pg {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--ok);
  border-radius: var(--radius);
  padding: 14px;
  margin-bottom: 12px;
}
.pg-h { margin: 0 0 2px; font-size: 15px; font-weight: 650; color: var(--text); }
.pg-meta { margin: 0 0 10px; font-size: 11px; color: var(--text-faint); }
.pg-top { display: flex; align-items: baseline; gap: 8px; margin: 2px 0 10px; }
.pg-num {
  font-size: 34px; font-weight: 700; line-height: 1;
  color: var(--ok); font-variant-numeric: tabular-nums;
}
.pg-num .pg-of { font-size: 17px; font-weight: 600; color: var(--text-dim); margin-left: 3px; }
.pg-unit { font-size: 13px; color: var(--text-dim); }
.pg-bar {
  height: 10px; border-radius: 999px; overflow: hidden;
  background: var(--surface-2); border: 1px solid var(--border);
}
.pg-fill {
  height: 100%; background: var(--ok);
  border-radius: 999px;
  transition: width .35s ease;
  min-width: 0;
}
.pg.settled .pg-bar { display: none; }   /* 满了就不再显示进度条，避免"刷满"的暗示 */
.pg-head { margin: 10px 0 3px; font-size: 14px; color: var(--text); }
.pg-detail { margin: 0; font-size: 13px; color: var(--text-dim); }
.pg-ok {
  margin-top: 10px; font-size: 13px; color: var(--text-dim);
  background: var(--ok-bg); border-radius: 10px; padding: 9px 11px;
}
.pg-ok b { color: var(--ok); }
@media (prefers-reduced-motion: reduce) { .pg-fill { transition: none; } }
`;

  function ensureStyle() {
    if (!global.document || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.appendChild(document.createTextNode(CSS));
    document.head.appendChild(s);
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ====================================================================
   * 时间窗：本周 = 周一 00:00 ~ 下周一 00:00（本地时区）
   *
   * 【口径统一】起点统一取 Log.weekStart() —— 它同时被 Log.stats().thisWeek
   * 使用。原先本文件自己算一份、log.js 用滚动 7 天，导致周日那天
   * 计划页「本周 N 次」和反馈页「近 7 天 N 次」会差 1。
   * 保留 weekWindow 这个包装只是为了 index（0=周一）和 end 的便利，
   * 时间计算本身不再另起一份。见 docs/内容与安全审校报告.md 附带发现。
   * ==================================================================== */

  function weekWindow(now) {
    const d = now || new Date();
    const startMs = (typeof Log !== 'undefined' && Log.weekStart)
      ? Log.weekStart(d)
      : (function () {                       // Log 不可用时的等价实现
          const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
          return x.getTime();
        })();
    const start = new Date(startMs);
    const end = new Date(startMs + 7 * 864e5);
    return { start, end, index: (start.getDay() + 6) % 7 };
  }

  function inWeek(iso, w) {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    return t >= w.start.getTime() && t < w.end.getTime();
  }

  function flatEntries(st) {
    const out = [];
    const map = (st && st.entries) || {};
    Object.keys(map).forEach(function (k) {
      (map[k] || []).forEach(function (e) { out.push(e); });
    });
    return out;
  }

  /* ====================================================================
   * 文案
   * 每一条分支都写死了"鼓励优先"的措辞。新增分支前先读这段注释。
   * ==================================================================== */

  function copy(o) {
    const { done, expected, sets, weekLabel, restDays } = o;
    // 及格线（goal.js 统一定义：每周 N-1 次）。分支判定必须用它，
    // 否则会出现 settled=true 但文案还说"剩下的不用赶"的自相矛盾。
    const pass = o.pass != null ? o.pass
      : (global.Goal && Goal.passLine ? Goal.passLine(expected) : Math.max(1, expected - 1));

    // —— 还没定目标：不算数，只做引导 ——
    if (!expected) {
      return {
        tone: 'neutral',
        headline: '还没定目标 —— 先花 1 分钟选一个',
        detail: '定完之后这里就会显示「本周练了几次」。' +
                '现在先去认器材也一样有用，认出来的机器会一直留在这一页。'
      };
    }

    // —— 一次都没练：说"哪天来都行"，不说"你没完成" ——
    // 【文案修正】headline 原为「这周还没开始 —— 哪天来都行，今天来也算」。
    // 「还没开始」预设了"应该已经开始"，把零定义成缺失状态。
    // 而产品原则说的是「做 0 项也算完成」，同一件事三处说"完成"、这里说"没开始"。
    // 这张卡是用户定完目标后看到的第一块内容，第一印象不该是否定句。
    if (done === 0) {
      return {
        tone: 'neutral',
        headline: '这周随时可以开始 —— 今天来也算',
        detail: '你给自己定的是每周 ' + expected + ' 次，及格线是 ' + pass + ' 次。' +
                '今天做 1 个任务就算今天，练 0 项也完全没有问题，这一周照样算数。' +
                '实在不方便，这周就当休息，下周再说。'
      };
    }

    // —— 做了一部分：明确"这就算数"，目标只做背景 ——
    // 用及格线而不是 expected 判定：练到及格线就该进"练够了"分支，
    // 不该继续说"剩下的不用赶"。
    // 【文案修正】detail 原为「剩下的 N 次不用赶」。
    // "剩下的"即使加了"不用赶"，仍是"还差几次"的同型结构 ——
    // 先算出欠账再宽容，用户读到的还是欠账。改为不提剩余数量。
    if (done < pass) {
      return {
        tone: 'good',
        headline: '这周已经练了 ' + done + ' 次，这就算数',
        detail: '你给自己定的目标是每周 ' + expected + ' 次，及格线是 ' + pass + ' 次。' +
                '这周想再去就再去，不想去也完全没问题 —— 练得少不会白练。'
      };
    }

    // —— 达标：直接宣布结束，把话头引向恢复，不引向加量 ——
    return {
      tone: 'settled',
      headline: done >= expected
        ? ('这周 ' + done + ' 次，练够了')
        : ('这周 ' + done + ' 次，已经过了及格线'),
      detail: (done >= expected
        ? '已经到每周 ' + expected + ' 次的目标了。'
        : '你给自己定的目标是 ' + expected + ' 次，' + pass + ' 次就是及格线。') +
              '接下来几天是给身体恢复用的 —— 想动就散散步或拉伸，不用再加量。'
    };
  }

  /* ====================================================================
   * compute
   * ==================================================================== */

  function compute(state) {
    const st = state || (global.Log && global.Log.load ? global.Log.load() : {}) || {};
    const now = new Date();
    const w = weekWindow(now);

    const expected = (st.goal && st.goal.freq && Number(st.goal.freq.days)) || 0;

    const sessions = (st.sessions || []).filter(function (s) { return inWeek(s.date, w); });
    const done = sessions.length;

    const entries = flatEntries(st).filter(function (e) { return inWeek(e.date, w); });
    const sets = entries.reduce(function (a, e) { return a + (Number(e.sets) || 0); }, 0);
    const reps = entries.reduce(function (a, e) { return a + (Number(e.reps) || 0); }, 0);
    const logged = entries.length;

    const ratio = expected > 0 ? Math.min(1, done / expected) : 0;

    const c = copy({
      done: done, expected: expected, sets: sets,
      restDays: Math.max(0, 7 - expected),
      weekLabel: (st.week || 1),
      // 及格线从 goal.js 取，保证与目标页的「及格线：每周至少出勤 N 次」同一个数
      pass: (global.Goal && Goal.passLine) ? Goal.passLine(expected) : Math.max(1, expected - 1)
    });

    // 本周还剩几个日历天（周一=0）
    const daysLeft = 7 - w.index;
    const phaseName = (global.Goal && st.goal && global.Goal.PHASES)
      ? (Goal.PHASES[st.phaseIndex] || {}).name : '';

    return {
      done: done,
      expected: expected,
      ratio: ratio,
      headline: c.headline,
      detail: c.detail,

      // —— 以下是给渲染层用的附加信息，UI 层可以忽略 ——
      tone: c.tone,
      sets: sets,
      reps: reps,
      loggedEntries: logged,
      daysLeft: daysLeft,
      weekNo: st.week || 1,
      phaseName: phaseName,
      // 【口径统一】原为 done >= expected（要练满 freq.days 才算够）。
      // 但 goal.js 定义的及格线是 freq.days - 1（"每周至少出勤 N 次就算达标"），
      // 两个数字同屏出现会打架。现在 settled 用统一的及格线判定，
      // 大数字仍显示用户自己定的目标 —— 那是他的意愿，不该改。
      settled: done >= (global.Goal && Goal.passLine
        ? Goal.passLine(expected) : Math.max(1, expected - 1)) && expected > 0,
      // 0 项也算完成：产品原则的开关位，UI 层想强调"0 项也算"时读它
      zeroCounts: true,
      label: expected ? (done + ' / ' + expected + ' 次') : '还没有定目标',
      ariaLabel: expected
        ? ('本周已练 ' + done + ' 次，你自己定的目标是每周 ' + expected + ' 次')
        : '本周完成度：还没有设定目标'
    };
  }

  /* ====================================================================
   * 渲染
   * ==================================================================== */

  let seq = 0;
  function build(p) {
    ensureStyle();
    const card = el('section', 'pg' + (p.tone === 'settled' ? ' settled' : ''));
    const hid = 'pg-h-' + (++seq);
    card.setAttribute('aria-labelledby', hid);

    const h = el('h3', 'pg-h', '这周练得怎么样');
    h.id = hid;
    card.appendChild(h);

    const meta = [];
    if (p.weekNo) meta.push('第 ' + p.weekNo + ' 周');
    if (p.phaseName) meta.push(p.phaseName);
    // 【文案修正】原为无条件显示「本周还剩 N 天」。
    // 问题是：练够之后还显示倒计时，等于在暗示"你还能再练"——
    // 这与本项目「不施压」的原则冲突（见 docs/新增模块文案审校.md P-1）。
    // 现在练够了就不倒数，改成肯定句；没练够时才提还剩几天。
    if (p.settled) {
      meta.push('这周的份已经练够了');
    } else if (p.daysLeft > 0) {
      meta.push('本周还剩 ' + p.daysLeft + ' 天');
    }
    card.appendChild(el('p', 'pg-meta', meta.join(' · ')));

    if (p.expected) {
      // 大数字 + 单位
      const top = el('div', 'pg-top');
      const num = el('div', 'pg-num', String(p.done) + '<span class="pg-of">/' + p.expected + '</span>');
      num.setAttribute('aria-hidden', 'true');   // 下面的 role=progressbar 会念同样的数
      top.appendChild(num);
      top.appendChild(el('div', 'pg-unit', '次，本周'));
      card.appendChild(top);

      // 进度条：用 progressbar + valuetext，避免读屏器念出"33%"这种百分比
      const bar = el('div', 'pg-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(p.expected));
      bar.setAttribute('aria-valuenow', String(p.done));
      bar.setAttribute('aria-valuetext', p.ariaLabel);
      bar.setAttribute('aria-label', '本周训练次数');
      const fill = el('div', 'pg-fill');
      fill.style.width = Math.round(p.ratio * 100) + '%';
      fill.setAttribute('aria-hidden', 'true');
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    card.appendChild(el('p', 'pg-head', p.headline));
    card.appendChild(el('p', 'pg-detail', p.detail));

    // 组数等细节，挂一条成功态（不是警告）—— 做得多是好事
    const bits = [];
    if (p.sets > 0) bits.push('完成 ' + p.sets + ' 组');
    if (p.reps > 0) bits.push('共 ' + p.reps + ' 次');
    // 【文案修正】加「本周」限定。
    // 这张卡和下面的代偿卡（compensation.js）上下相邻，两张卡都有"记录"字样：
    // 这里是本周的条数，代偿卡是全部历史的留存条数。不加限定同屏会互相打架。
    if (p.loggedEntries > 0) bits.push('本周记录 ' + p.loggedEntries + ' 个动作');
    if (bits.length) {
      card.appendChild(el('div', 'pg-ok', '<b>这周的实打实的量：</b>' + bits.join(' · ')));
    }
    card.appendChild(el('div', 'pg-detail',
      '口径：点「练完勾一下」记一次，点「记一次执行」记一个动作。做 0 项也记 1 次出勤。'));

    return card;
  }

  function renderInto(container) {
    if (!container || !container.appendChild) return null;
    const card = build(compute());
    container.appendChild(card);
    return card;
  }

  function mountInto(container) {
    if (!container || !container.appendChild) return null;
    container.innerHTML = '';
    return renderInto(container);
  }

  const Progress = {
    compute,
    mountInto,
    renderInto,
    weekWindow,
    styleSheet: function () { return CSS; }
  };
  global.Progress = Progress;
  if (typeof module !== 'undefined' && module.exports) module.exports = Progress;

})(typeof window !== 'undefined' ? window : globalThis);
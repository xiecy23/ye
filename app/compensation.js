/* =========================================================================
 * compensation.js —— 代偿次数仪表（动作控制的观察窗口）
 * =========================================================================
 * 参考 Keep 的「身体年龄」：一个数 + 一句话 + 一条进度。
 * 区别在于这个数 Keep 算不出来 —— 本项目的训练卡上有一个
 * 「有代偿（耸肩/歪斜/单侧酸）」勾选框，所以这里能给出一个只属于这个应用的数字。
 *
 * 【这是观察窗口，不是考核指标】
 * 这句是硬约束，不是文案偏好。用户是零基础新手，左高右低高低肩、左侧上斜方肌
 * 容易代偿、臀部容易抽筋。代偿多恰恰说明这个人正在做一件对他有难度的事。
 * 所以本文件里：
 *   - 全卡片没有任何 danger / warn 配色。代偿多的时候左边框是中性蓝，不是红色。
 *   - 主数字是「记录了几次」这个中性事实，不是「代偿率百分之多少」。
 *     比率只在图例里作为次要信息出现，不做大字，也不做进度条告警。
 *   - 数据为空时说「还没有记录」，不说「0 次代偿」——后者会被读成「你没练」。
 *   - 记录少于 3 条时不给任何判断，直接说先攒几条。
 *   - 文案里刻意不出现任何带评判的词。要表达「不是你的问题」时，
 *     用「这不是做得好不好的问题」这种正面陈述，而不是否定式表述。
 *     改文案前请先读这一段，新增分支同样受这几条约束。
 *
 * 计算口径
 *   - total：Log.load().entries 里所有记录平铺后的条数，与 Log.stats().totalExercises 同源。
 *     注意 log.js 对每个动作只保留最近 12 条，所以 total 是「留存的记录数」，
 *     不等于历史总次数。卡片上会把这一点写给用户看，免得他自己算不明白。
 *   - compensation / pain / cramp：对应字段为 true 的条数。
 *   - rate = compensation / total（0–1）。只在 total > 0 时有意义。
 *   - streak：从最近一条往前数，连续「没有代偿」的条数。
 *     注意这与 assess.js 的 cleanStreak 口径不同 —— 那边要求疼痛/抽筋/代偿三类全无。
 *     这里只关心代偿，所以额外提供 cleanStreak 给需要严格口径的地方用。
 *   - trend：最近 5 条 vs 之前 5 条的代偿率之差。
 *     两组各少于 3 条时返回 'unknown'（即留存记录少于 8 条时不给趋势）。
 *     差值绝对值 < 0.2 视为 'flat'：5 条样本下比率只能取 0 / 0.2 / 0.4…，
 *     0.2 正好等于一条记录的变动，比这更细的阈值没有实际含义。
 *
 * 导出（全局 Compensation）
 *   Compensation.compute(state)  返回 {total, compensation, pain, cramp, clean, rate,
 *                                    ratePct, trend, trendDelta, recentRate, priorRate,
 *                                    streak, cleanStreak, enough, headline, detail,
 *                                    tone, label, ariaLabel, note, minSample}
 *   Compensation.mountInto(el)   清空容器并渲染成一张卡片，返回节点
 *   Compensation.renderInto(el)  只追加不清空
 *   Compensation.styleSheet()    拿注入的 CSS 文本（想并进 app.css 时用）
 *
 * 集成
 *   1) index.html —— 放在 progress.js 之后、app.js 之前：
 *        <script src="app/progress.js"></script>
 *        <script src="app/compensation.js"></script>   <!-- ← 新增这一行 -->
 *        <script src="app/app.js"></script>
 *   2) sw.js —— 把 './app/compensation.js' 加进 ASSETS 数组，
 *      否则首次离线打开时这个文件不在预缓存里（运行时虽会靠
 *      stale-while-revalidate 补上，但首次离线会缺这张卡）。
 *   3) app.js 的 renderPlan() —— 在 Progress.mountInto(box) 之后追加：
 *        if (typeof Compensation !== 'undefined' && Compensation.renderInto) {
 *          try { Compensation.renderInto(box); } catch (e) { }
 *        }
 *      ⚠ 这里必须用 renderInto，不能用 mountInto。mountInto 会先清空容器，
 *        对同一个 box 连调两次 mountInto 会把前面那张卡片（本周完成度）冲掉。
 *        想用 mountInto，就得在 HTML 里给它一个独立容器：
 *          <div id="compensationBox"></div>
 *        然后 Compensation.mountInto(document.getElementById('compensationBox'))。
 * ========================================================================= */

(function (global) {
  'use strict';

  const STYLE_ID = 'compensation-style';

  /* 阈值集中放这里，改口径只改这一处 */
  const MIN_SAMPLE = 3;        // 少于 3 条不给任何判断
  const RECENT = 5;            // 趋势：最近 5 条
  const PRIOR = 5;             // 趋势：之前 5 条
  const MIN_PER_SIDE = 3;      // 两组各至少 3 条才敢比
  const FLAT_EPS = 0.2;        // 差不到一条记录就算没变

  const CSS = `
/* =========================================================================
   compensation 样式
   前缀 .cp-，与 app.css 类名零重叠。颜色变量复用 app.css，并带 fallback，
   万一 app.css 没加载也不会变成看不见的透明块。
   注意：这里刻意没有任何 danger / warn 配色。代偿多不是「错误状态」，
   所以左边框只有中性蓝（默认）和 ok 绿（一条代偿都没有）两种。
   ========================================================================= */
.cp {
  background: var(--surface, #171a21);
  border: 1px solid var(--border, #2a2f3a);
  border-left: 3px solid var(--accent, #5b9dff);
  border-radius: var(--radius, 14px);
  padding: 14px;
  margin-bottom: 12px;
}
.cp.clean { border-left-color: var(--ok, #3ddc97); }
.cp-h { margin: 0 0 2px; font-size: 15px; font-weight: 650; color: var(--text, #e8eaed); }
.cp-meta { margin: 0 0 10px; font-size: 11px; color: var(--text-faint, #8b94a1); }
.cp-top { display: flex; align-items: baseline; gap: 8px; margin: 2px 0 10px; flex-wrap: wrap; }
.cp-num {
  font-size: 30px; font-weight: 700; line-height: 1;
  color: var(--text, #e8eaed); font-variant-numeric: tabular-nums;
}
.cp-num .cp-of { font-size: 13px; font-weight: 600; color: var(--text-dim, #9aa3b2); margin-left: 4px; }
.cp-unit { font-size: 13px; color: var(--text-dim, #9aa3b2); }
.cp-bar {
  display: flex; height: 10px; border-radius: 999px; overflow: hidden;
  background: var(--surface-2, #1f232c); border: 1px solid var(--border, #2a2f3a);
}
.cp-seg { height: 100%; }
.cp-seg.clean { background: var(--ok, #3ddc97); }
.cp-seg.comp { background: var(--accent, #5b9dff); }
.cp-legend { margin: 7px 0 0; font-size: 12px; color: var(--text-faint, #8b94a1); }
.cp-head { margin: 10px 0 3px; font-size: 14px; color: var(--text, #e8eaed); }
.cp-detail { margin: 0; font-size: 13px; color: var(--text-dim, #9aa3b2); }
.cp-note {
  margin-top: 10px; font-size: 12px; color: var(--text-faint, #8b94a1);
  background: var(--surface-2, #1f232c); border-radius: 10px; padding: 9px 11px;
}
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
   * 数据整理
   * ==================================================================== */

  /** 把 entries 这个「动作 -> 记录数组」的字典压平成一个数组 */
  function flatEntries(st) {
    const out = [];
    const map = (st && st.entries) || {};
    Object.keys(map).forEach(function (k) {
      const list = map[k];
      // 脏数据兜底：条目不是数组就跳过，不让一张观察卡把整个计划页带崩
      if (!Array.isArray(list)) return;
      list.forEach(function (e) { out.push(e); });
    });
    return out;
  }

  /** 时间戳。date 缺失或解析不出来时给 0，避免排序被 NaN 搅乱 */
  function ts(e) {
    const t = new Date(e && e.date).getTime();
    return isNaN(t) ? 0 : t;
  }

  /** 按时间升序（早的在前）。趋势和连续次数都依赖这个顺序 */
  function chronoOrder(st) {
    return flatEntries(st).sort(function (a, b) { return ts(a) - ts(b); });
  }

  function count(list, key) {
    return list.filter(function (e) { return !!(e && e[key]); }).length;
  }

  /** 从最近一条往前数，连续满足 ok 的条数 */
  function countBack(list, ok) {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (ok(list[i])) n++;
      else break;
    }
    return n;
  }

  function rateOf(list) {
    if (!list.length) return 0;
    return count(list, 'compensation') / list.length;
  }

  /* ---------------------------------------------------------------------
   * 趋势：最近 5 条 vs 之前 5 条的代偿率
   * 样本不够就老实返回 'unknown'，不硬给一个方向。
   * ------------------------------------------------------------------- */
  function trendOf(chrono) {
    const n = chrono.length;
    const recent = chrono.slice(Math.max(0, n - RECENT));
    const prior = chrono.slice(Math.max(0, n - RECENT - PRIOR), Math.max(0, n - RECENT));

    const base = {
      trend: 'unknown',
      trendDelta: null,
      recentRate: null,
      priorRate: null,
      recentN: recent.length,
      priorN: prior.length
    };
    if (recent.length < MIN_PER_SIDE || prior.length < MIN_PER_SIDE) return base;

    const rr = rateOf(recent);
    const pr = rateOf(prior);
    const delta = rr - pr;

    base.recentRate = rr;
    base.priorRate = pr;
    base.trendDelta = delta;
    base.trend = Math.abs(delta) < FLAT_EPS ? 'flat' : (delta < 0 ? 'improving' : 'worsening');
    return base;
  }

  /* ====================================================================
   * 文案
   * 每一条分支都写死了「不评判」的措辞。新增分支前先读文件头那一段。
   * ==================================================================== */

  function trendLine(trend) {
    if (trend === 'improving') return '最近几次比前面少。';
    if (trend === 'worsening') return '最近几次比前面多了一点。';
    return '';
  }

  function streakLine(streak, compensation) {
    // 【文案修正】原为「最近连续 N 次是干净的。」
    // 「干净」在本文件里只排除代偿，不排除疼痛和抽筋；
    // 而 assess.js 的 cleanStreak 要求三类全无。同一个词两个定义，
    // 两张卡都在计划页，用户会拿到矛盾信息。
    // 用户可见文案里改用明确说法，不用裸的「干净」。
    if (compensation > 0 && streak >= 3) return '最近连续 ' + streak + ' 次没有报代偿。';
    return '';
  }

  function join(parts) {
    return parts.filter(function (s) { return s && s.length; }).join(' ');
  }

  function copy(o) {
    // pain / cramp 也要解构：note 里要判断是否存在痛与抽筋，
    // 好在卡片上直接给出停止指令而不是让用户自己去另一页找。
    const { total, compensation, rate, streak, trend, pain, cramp } = o;

    // —— 一条记录都没有：说"还没有记录"，不说"0 次代偿" ——
    if (total === 0) {
      return {
        tone: 'empty',
        headline: '还没有记录',
        // 【文案修正】原为「这一格是空的，不是零分。」
        // 这句话本意是安慰，但它第一次把"分数"概念带进了这张卡 ——
        // 而整个设计都在回避评分框架。改成不提分数。
        detail: '这一格是空的，不是你没做够 —— ' +
                '等你哪天在训练卡上点「记一次执行」，这里才开始有东西可看。' +
                '现在什么都不用做。'
      };
    }

    // —— 记录太少：不给判断 ——
    if (total < MIN_SAMPLE) {
      return {
        tone: 'empty',
        // 【文案修正】原为「数据还太少，先攒几条」。
        // 「先攒几条」是任务口吻：headline 是最大字号，
        // 用户先读到的是"你还欠几条记录"。改为陈述现状，不下任务。
        headline: '现在只有 ' + total + ' 条记录，还看不出什么',
        detail: '所以这里先不下结论 —— 样本够的时候它会自己开始说话。' +
                '练到哪记到哪就行，不用为了凑数专门去记。'
      };
    }

    const extra = join([trendLine(trend), streakLine(streak, compensation)]);

    // —— 一条代偿都没有 ——
    if (compensation === 0) {
      return {
        tone: 'clean',
        headline: '到现在为止，一条代偿都没报',
        detail: join([
          '累计 ' + total + ' 次记录里没有出现代偿信号。',
          '这说明你用的重量是能控制住的，动作没有靠别的肌肉去顶。',
          '按现在的节奏走就行 —— 也不用因为「一直很干净」就自己加量。'
        ])
      };
    }

    // —— 偶发 ——
    if (rate <= 0.25) {
      return {
        tone: 'watch',
        headline: '偶尔报一次，属于常见情况',
        detail: join([
          '累计 ' + total + ' 次里报了 ' + compensation + ' 次代偿。',
          '零星的几次通常出现在加重量、没睡好或者赶时间的那天，不用专门处理。',
          '下次做那个动作时把速度放慢一点就够了。',
          extra
        ])
      };
    }

    // —— 中等：给一个具体的下一步，但不评判人 ——
    if (rate <= 0.5) {
      return {
        tone: 'watch',
        headline: '有几次报了代偿，可以看一眼是哪个动作',
        detail: join([
          '累计 ' + total + ' 次里有 ' + compensation + ' 次。',
          '这不是做得好不好的问题 —— 它只说明那几组的重量，' +
          '超出了当时身体能控制的范围。',
          '想知道具体是哪个动作，去「反馈」页的记录里对一下，' +
          '那个动作先停掉，下次从空载或最轻一档重新开始。',
          extra
        ])
      };
    }

    // —— 偏多：强调"这是信号"，给一条最简单的出路 ——
    return {
      tone: 'watch',
      headline: '报代偿的次数比较多 —— 这是信号，先别加量',
      detail: join([
        '累计 ' + total + ' 次里有 ' + compensation + ' 次报了代偿。',
        '先说明一点：这不是做得好不好的问题。刚开始练的人报代偿很常见 —— ' +
        '动作还没形成习惯，负荷分给了不该出力的肌肉，这是学动作过程的一部分。',
        '现在可以做的事只有一件：把触发代偿的那个动作先停掉，' +
        '下次从空载或最轻一档重新开始，不要降着重量接着做 —— ' +
        '负荷还是会被同一块肌肉接管，代偿会固化。',
        '身体不舒服的那几天，做 0 项也算完成。',
        extra
      ])
    };
  }

  /* ====================================================================
   * compute
   * ==================================================================== */

  function compute(state) {
    const st = state || (global.Log && global.Log.load ? global.Log.load() : {}) || {};
    const chrono = chronoOrder(st);

    const total = chrono.length;
    const compensation = count(chrono, 'compensation');
    const pain = count(chrono, 'pain');
    const cramp = count(chrono, 'cramp');
    const clean = total - compensation;
    const rate = total > 0 ? compensation / total : 0;

    // 连续无代偿（本模块主口径）
    const streak = countBack(chrono, function (e) { return !e.compensation; });
    // 连续三类全无（与 assess.js 的 cleanStreak 对齐）
    const cleanStreak = countBack(chrono, function (e) {
      return !e.pain && !e.cramp && !e.compensation;
    });

    const tr = trendOf(chrono);

    const c = copy({
      total: total,
      compensation: compensation,
      rate: rate,
      streak: streak,
      trend: tr.trend,
      // note 里要按有无痛/抽筋给出不同处置，必须传进去
      pain: pain,
      cramp: cramp
    });

    return {
      total: total,
      compensation: compensation,
      pain: pain,
      cramp: cramp,
      clean: clean,
      rate: rate,
      ratePct: Math.round(rate * 100),

      trend: tr.trend,
      trendDelta: tr.trendDelta,
      recentRate: tr.recentRate,
      priorRate: tr.priorRate,
      recentN: tr.recentN,
      priorN: tr.priorN,

      streak: streak,
      cleanStreak: cleanStreak,

      headline: c.headline,
      detail: c.detail,

      // —— 以下是给渲染层用的附加信息，UI 层可以忽略 ——
      tone: c.tone,
      enough: total >= MIN_SAMPLE,
      minSample: MIN_SAMPLE,
      // 【文案修正】同上：不用裸的「干净」，改成明确的「没有报代偿」
      label: total === 0 ? '还没有记录' : (clean + ' / ' + total + ' 次没有报代偿'),
      ariaLabel: total === 0
        ? '动作控制观察窗口：还没有记录'
        : ('动作控制观察窗口：累计 ' + total + ' 次记录，其中 ' +
           compensation + ' 次报了代偿'),
      // 【安全修正】原为「想知道是哪个动作触发的，可以在「反馈」页的记录里对一下；
      // 疼痛和抽筋的处理也在那一页。」
      // 这是把处置推断成了用户的任务 —— 尤其"疼痛和抽筋的处理也在那一页"
      // 等于让用户自己去找。而痛和抽筋是停止信号，必须在这里直接给指令。
      // 见 docs/新增模块文案审校.md C-4。
      note: (pain > 0 || cramp > 0)
        ? ('记录里有 ' +
           (pain > 0 ? ('疼痛 ' + pain + ' 次，') : '') +
           (cramp > 0 ? ('抽筋 ' + cramp + ' 次。') : '') +
           '痛和抽筋都是停止信号，不是"练得不够" —— 出现就立刻停掉那个动作，' +
           '当天不补做。疼痛持续超过 3 天，或伴随肿胀、关节响、活动受限，' +
           '去看骨科或康复科。代偿的处理见上面。')
        : ('代偿 = 耸肩、身体歪、只有单侧酸。它是身体给的信号，不是评分 —— ' +
           '报几次都不影响你「做了就算完成」。' +
           '想知道是哪个动作触发的，可以在「反馈」页的记录里对一下。')
    };
  }

  /* ====================================================================
   * 渲染
   * ==================================================================== */

  let seq = 0;
  function build(p) {
    ensureStyle();
    const card = el('section', 'cp' + (p.tone === 'clean' ? ' clean' : ''));
    const hid = 'cp-h-' + (++seq);
    card.setAttribute('aria-labelledby', hid);

    const h = el('h3', 'cp-h', '动作控制 · 观察窗口');
    h.id = hid;
    card.appendChild(h);

    const meta = [];
    if (p.total > 0) {
      meta.push('累计 ' + p.total + ' 次记录');
      meta.push('每台器械最多留 12 条');
    } else {
      meta.push('这一格还是空的');
    }
    if (p.trend !== 'unknown') meta.push('最近 5 次 vs 之前 5 次');
    card.appendChild(el('p', 'cp-meta', meta.join(' · ')));

    // 只有样本够了才摆数字。样本太少时摆数字等于在暗示一个结论。
    if (p.enough) {
      const top = el('div', 'cp-top');
      // 主数字是「记录了几次」这个中性事实，不是代偿率
      const num = el('div', 'cp-num', String(p.total) + '<span class="cp-of">次记录</span>');
      num.setAttribute('aria-hidden', 'true');
      top.appendChild(num);
      top.appendChild(el('div', 'cp-unit',
        p.compensation === 0 ? '没有报过代偿' : '其中 ' + p.compensation + ' 次报了代偿'));
      card.appendChild(top);

      // 分段条：干净在前、代偿在后。两者都是中性信息，没有告警色。
      // 图例文字已经把同样的信息说了一遍，所以整条对读屏器隐藏。
      const bar = el('div', 'cp-bar');
      bar.setAttribute('aria-hidden', 'true');
      const segClean = el('div', 'cp-seg clean');
      segClean.style.width = Math.round(p.clean / p.total * 100) + '%';
      const segComp = el('div', 'cp-seg comp');
      segComp.style.width = Math.round(p.compensation / p.total * 100) + '%';
      bar.appendChild(segClean);
      bar.appendChild(segComp);
      card.appendChild(bar);

      // 【文案修正】同上：「干净」改为明确的说法
      const bits = ['没有报代偿 ' + p.clean + ' 次', '代偿 ' + p.compensation + ' 次'];
      if (p.pain > 0) bits.push('疼痛 ' + p.pain + ' 次');
      if (p.cramp > 0) bits.push('抽筋 ' + p.cramp + ' 次');
      card.appendChild(el('p', 'cp-legend', bits.join(' · ')));
    }

    card.appendChild(el('p', 'cp-head', p.headline));
    card.appendChild(el('p', 'cp-detail', p.detail));
    card.appendChild(el('div', 'cp-note', p.note));

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

  const Compensation = {
    compute,
    mountInto,
    renderInto,
    trendOf,
    chronoOrder,
    styleSheet: function () { return CSS; },
    LIMITS: {
      MIN_SAMPLE: MIN_SAMPLE,
      RECENT: RECENT,
      PRIOR: PRIOR,
      MIN_PER_SIDE: MIN_PER_SIDE,
      FLAT_EPS: FLAT_EPS
    }
  };
  global.Compensation = Compensation;
  if (typeof module !== 'undefined' && module.exports) module.exports = Compensation;

})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================================
 * onboarding.js —— 首次引导（3 步，可跳过，不遮挡功能）
 * =========================================================================
 * 作用
 *   第一次打开时顶部的三行字太突兀，用户不知道这是什么、要不要会玩、
 *   数据存在哪。这里换成 3 步轻量引导，回答三个问题：
 *     1. 这是什么（解决什么问题）
 *     2. 需要什么（一部手机 / 一家健身房 / 一次联网）
 *     3. 怎么开始（去目标页花 1 分钟）
 *
 * 设计约束（和产品原则一致）
 *   - 不做全屏遮罩、不做焦点陷阱。它就是「器材」页顶上一张卡，
 *     下面的功能全部照常可用，用户随时能关掉。
 *   - 跳过 / 关闭写 localStorage，之后不再出现；「反馈」页可以一键再看。
 *   - 纯 CSS/JS，无图片、无字体、无网络请求。样式由本文件注入，
 *     因为不允许改 app.css。
 *   - 文案不许制造压力：「做 0 项也算完成」这句话必须出现在引导里。
 *
 * 导出（全局 Onboarding）
 *   Onboarding.shouldShow()        现在该不该显示
 *   Onboarding.mount(container)    挂到指定容器；不传则自动插到「器材」页最前面
 *   Onboarding.dismiss(reason)     关闭并记状态
 *   Onboarding.reset()             清掉标记（用于「再看一遍」）
 *   Onboarding.isOpen()            当前是否有引导在显示
 *   Onboarding.STEPS               三步的文案（给别处复用 / 改写）
 *
 * 集成
 *   index.html 里放在 app.js 之前：<script src="app/onboarding.js"></script>
 *   不改 app.js 也能工作（DOMContentLoaded 自动挂到 #page-kit 第一个子节点）。
 *   改了 app.js 可以在 boot() 里显式调 Onboarding.mount(el)。
 *   见 docs/ux-integration.md。
 * ========================================================================= */

(function (global) {
  'use strict';

  const KEY = 'fitcoach.onboard.v1';
  const ROOT_ID = 'onb-root';
  const STYLE_ID = 'onb-style';
  const REOPEN_ID = 'onb-reopen';

  /* ====================================================================
   * 文案
   * 原则：每一步只回答一个问题，不塞术语，不承诺效果。
   * ==================================================================== */

  const STEPS = [
    {
      key: 'what',
      icon: '🧭',
      title: '这是什么',
      lead: '你第一次进健身房，卡住你的通常不是没力气，是不知道该练哪台机器。',
      points: [
        '这里只做三件事：<b>认器材</b>、<b>定目标</b>、<b>每天给一份清单</b>。',
        '清单上每一条都写清楚用哪台机器、几组几次、什么重量上限。',
        // 【安全修正】原为「能不能用这台、什么时候必须停，已经在代码里判好了，
        // 不用你自己决定。」
        // 前半句成立（safety.js 的 markSafety 确实预先判了），
        // 但后半句是危险的：痛、抽筋、代偿这三个最高优先级信号，
        // 代码完全无法自行检测，只能等用户上报。
        // 对零基础新手说「不用你自己决定」，会把注意力从身体感觉上移开，
        // 而这恰恰是新手最需要建立的能力。
        '能不能用这台，代码已经替你判好了。但有一件事只能你自己来：' +
        '做的时候感觉不对（痛、抽筋、耸肩、身体歪），要如实告诉它 —— ' +
        '在任务卡上勾一下、或去「反馈」页选一下，它才知道该让你停。'
      ],
      note: '这不是考核表。做 0 项也算完成，做少了也不会有人来催你。'
    },
    {
      key: 'need',
      icon: '🎒',
      title: '需要什么',
      lead: '门槛比你想象的低。',
      points: [
        '<b>一部手机</b>，安卓苹果都行。',
        '<b>一家健身房</b>，或者家里能活动的空间也行。',
        '<b>一次联网</b>：只有第一次打开要联网，之后离线也能用。'
      ],
      note: '不需要账号、不需要买课、不需要运动服。所有数据只存在你这台手机的浏览器里，没有服务器，不上传；随时能在「反馈 → 导出/重置」里一键清空。'
    },
    {
      key: 'start',
      icon: '▶️',
      title: '怎么开始',
      lead: '三步，第一步 1 分钟。',
      steps: [
        '<b>去「目标」页</b>，回答 3 个问题：现在哪里最不舒服 / 一周能练几次 / 每次能待多久。',
        '<b>「计划」页</b>会直接给出今天要做哪几个动作，每条都带器械认领方法。',
        '<b>练完去「反馈」页</b>选一下感觉。特别是「痛」和「抽筋」——那两条会直接给你停止指令，这是安全规则，不是客气话。'
      ],
      note: '不知道哪台机器？在「器材」页用嘴描述一下，比如「头上有横杆，下面一张椅子」，或者拍张照存着，之后导出来就能确认。'
    }
  ];

  const CSS = `
/* =========================================================================
   onboarding 样式
   独立作用域前缀 .onb-，与 app.css 的类名零重叠，可随时整段删除。
   颜色一律复用 app.css 的 CSS 变量，主题改动自动跟随。
   ========================================================================= */
.onb {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  padding: 14px;
  margin: 0 0 14px;
}
.onb-h {
  display: flex; align-items: center; gap: 10px;
  margin: 0 0 2px; font-size: 15px; font-weight: 650;
}
.onb-h .onb-ic { font-size: 20px; line-height: 1; flex-shrink: 0; }
.onb-dots { margin: 0 0 10px; font-size: 11px; color: var(--text-faint); letter-spacing: .4px; }
.onb-body { font-size: 14px; color: var(--text-dim); }
.onb-body > * { margin: 0 0 8px; }
.onb-lead { color: var(--text); }
.onb-body ul { margin: 0 0 8px; padding-left: 18px; }
.onb-body li { margin-bottom: 6px; }
.onb-note {
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 12px;
  font-size: 13px; color: var(--text-dim);
}
.onb-nav {
  display: flex; gap: 8px; align-items: center;
  margin-top: 12px; flex-wrap: wrap;
}
.onb-btn {
  flex: 1 1 auto; min-height: 46px; padding: 12px 14px;
  border-radius: 12px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text);
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  min-width: 88px;
}
.onb-btn:active { transform: scale(.99); }
.onb-btn.primary { background: var(--accent); border-color: var(--accent); color: #06101f; }
.onb-btn.ghost { flex: 0 0 auto; background: none; color: var(--text-dim); font-weight: 500; min-width: 64px; }
.onb-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* 关闭按钮：右上角小圆点，触控目标 44×44（视觉上是小圆点，但可点区域够） */
.onb-x {
  margin-left: auto; flex: 0 0 auto;
  width: 44px; height: 44px; margin-right: -10px; margin-top: -10px;
  border: 0; background: none; color: var(--text-faint);
  font-size: 22px; line-height: 1; cursor: pointer; border-radius: 50%;
}
.onb-x:hover { color: var(--text); }
.onb-x:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* 重新打开引导的小入口：安静，但一直找得到 */
.onb-reopen {
  display: block; width: 100%; margin: 16px 0 4px;
  padding: 12px; min-height: 44px;
  background: none; border: 1px dashed var(--border); border-radius: 12px;
  color: var(--text-faint); font: inherit; font-size: 13px; cursor: pointer;
}
.onb-reopen:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

  function ensureStyle() {
    if (!global.document || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.appendChild(document.createTextNode(CSS));
    document.head.appendChild(s);
  }

  /* ====================================================================
   * localStorage（必须兜底：无痕模式下 localStorage 会直接抛 SecurityError，
   * 跟 log.js 里同一层道理。抛异常不该让整个应用白屏。）
   * ==================================================================== */

  const mem = {};
  const storage = (function () {
    try {
      const t = '__onb__';
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

  function readFlag() {
    try {
      const raw = storage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeFlag(v) {
    try { storage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 无痕模式，内存兜底 */ }
  }

  /* ====================================================================
   * 判断
   * ==================================================================== */

  function state() {
    try {
      return (global.Log && global.Log.load) ? global.Log.load() : {};
    } catch (e) { return {}; }
  }

  /**
   * 显示条件（全部满足才显示）
   *   - 本次会话 / 本机没跳过过
   *   - Log.load().goal 为空 —— 定过目标的老用户绝不该再被拦一次
   *   - Log 存在（老缓存或脚本顺序异常时不硬塞，避免和引导打架）
   */
  function shouldShow() {
    const f = readFlag();
    if (f && f.dismissedAt) return false;
    if (!global.Log || !global.Log.load) return false;
    const st = state();
    if (st && st.goal) return false;
    return true;
  }

  function isOpen() {
    return !!(global.document && document.getElementById(ROOT_ID));
  }

  /* ====================================================================
   * 渲染
   * ==================================================================== */

  let idx = 0;
  let root = null;

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function goto(page) {
    const b = document.querySelector('#tabbar button[data-page="' + page + '"]');
    if (b) b.click();
  }

  function defaultHost() {
    const page = document.getElementById('page-kit') || document.querySelector('.page');
    if (!page) return null;
    if (!page.__onbHost) {
      const host = el('div');
      host.id = 'onb-host';
      page.insertBefore(host, page.firstChild);
      page.__onbHost = host;
    }
    return page.__onbHost;
  }

  function render() {
    const s = STEPS[idx];

    // 标题行（图标 + 标题 + 关闭）
    const head = el('div', 'onb-h');
    const ic = el('span', 'onb-ic', s.icon);
    ic.setAttribute('aria-hidden', 'true');
    head.appendChild(ic);
    const h = el('h2', null, esc(s.title));
    h.id = 'onb-title';
    h.style.cssText = 'margin:0;font-size:15px;font-weight:650';
    head.appendChild(h);

    const x = el('button', 'onb-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', '关闭引导，之后不再出现');
    x.addEventListener('click', function () { dismiss('close'); });
    head.appendChild(x);
    root.appendChild(head);

    // 正文：aria-live 让切步自动被读出来，不抢焦点就不会打断打字/滚动
    const body = el('div', 'onb-body');
    body.setAttribute('aria-live', 'polite');
    body.setAttribute('aria-atomic', 'true');
    // 【无障碍修正】步骤指示原在 body 之外，aria-live 覆盖不到。
    // 删掉重复的 UX.announce 之后，读屏器就听不到"第几步"了，
    // 所以必须把它移进 body，才能被同一次播报读到。
    body.appendChild(el('p', 'onb-dots',
      '第 ' + (idx + 1) + ' 步 / 共 ' + STEPS.length + ' 步 · 大约 ' + (STEPS.length * 20) + ' 秒读完'));
    body.appendChild(el('p', 'onb-lead', s.lead));
    const ul = el('ul');
    (s.points || s.steps || []).forEach(function (p) { ul.appendChild(el('li', null, p)); });
    body.appendChild(ul);
    body.appendChild(el('div', 'onb-note', s.note));
    root.appendChild(body);

    // 导航
    const nav = el('div', 'onb-nav');
    if (idx > 0) {
      const prev = el('button', 'onb-btn ghost', '上一步');
      prev.type = 'button';
      prev.addEventListener('click', function () { move(-1); });
      nav.appendChild(prev);
    }

    const skip = el('button', 'onb-btn ghost', '跳过');
    skip.type = 'button';
    skip.setAttribute('aria-label', '跳过新手引导，之后不再出现');
    skip.addEventListener('click', function () { dismiss('skip'); });
    nav.appendChild(skip);

    if (idx < STEPS.length - 1) {
      const nx = el('button', 'onb-btn primary', '下一步');
      nx.type = 'button';
      nx.addEventListener('click', function () { move(1); });
      nav.appendChild(nx);
    } else {
      const go2 = el('button', 'onb-btn primary', '去定目标（1 分钟）');
      go2.type = 'button';
      go2.addEventListener('click', function () {
        dismiss('start');
        goto('goal');
      });
      nav.appendChild(go2);
    }
    root.appendChild(nav);
  }

  function move(d) {
    idx = Math.max(0, Math.min(STEPS.length - 1, idx + d));
    root.innerHTML = '';
    render();
    // 【无障碍修正】原先这里调 UX.announce() 播报第 N 步，
    // 而上方 body 已带 aria-live="polite"，重建后会再念一遍完整内容 ——
    // 两个 polite 区同时播报，读屏用户听到同一段内容念两遍（第二遍还截断）。
    // 见 docs/新增模块文案审校.md O-2。
    // 现在只保留 body 的 aria-live（它播报的是完整内容），此处不再重复播报。
    // 步骤序号与标题已经写在 body 的可见文本里，会被一起念出来。
  }

  function mount(container) {
    if (!global.document) return null;
    ensureStyle();

    if (isOpen()) return root;

    const host = (container && container.appendChild)
      ? container
      : defaultHost();
    if (!host) return null;

    // 「目标」已经定了 / 已经跳过了，就不显示。reopen() 会先清掉标记再调这里。
    if (!shouldShow()) return null;

    idx = 0;
    root = el('section', 'onb');
    root.id = ROOT_ID;
    root.setAttribute('aria-labelledby', 'onb-title');
    host.appendChild(root);
    render();

    // 首次进入把焦点送到标题，键盘用户不用从页首 Tab 二十多次才够得到
    const h = root.querySelector('#onb-title');
    if (h) {
      h.setAttribute('tabindex', '-1');
      try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
    }
    // 【无障碍修正】此处原先也调 UX.announce，与 body 的 aria-live 重复播报。
    // 首次渲染时 body 会被 polite 区念一遍（含步骤序号、lead、要点、note），
    // 再 announce 一次只会让读屏用户听到两遍。见 docs/新增模块文案审校.md O-2。
    return root;
  }

  function dismiss(reason) {
    writeFlag({ dismissedAt: new Date().toISOString(), reason: reason || 'skip' });
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    addReopen();
    // 焦点不能丢：引导卡被移除时，按钮连同焦点一起没了。这里主动把焦点送到
    // 「再看一遍」的小入口上，键盘用户不会莫名其妙掉回页首。
    const re = document.getElementById(REOPEN_ID);
    if (re) { try { re.focus({ preventScroll: true }); } catch (e) { re.focus(); } }
    if (global.UX && UX.announce) UX.announce('引导已关闭，「器材」页底部有「新手引导」可以再看。');
  }

  /**
   * 关闭后留一个安静的重开入口。
   * 这是「用户随时能关」的另一半：关得掉，也找得回来。
   */
  function addReopen() {
    if (!global.document) return;
    if (document.getElementById(REOPEN_ID)) return;
    const page = document.getElementById('page-kit') || document.querySelector('.page');
    if (!page) return;
    const b = el('button', 'onb-reopen', '新手引导 · 随时可以再看一遍（3 步，20 秒）');
    b.type = 'button';
    b.id = REOPEN_ID;
    b.addEventListener('click', function () { reopen(); });
    page.appendChild(b);
  }

  function reopen() {
    const b = document.getElementById(REOPEN_ID);
    if (b) b.remove();
    writeFlag({ dismissedAt: null, reason: 'reopen' });
    const host = defaultHost();
    if (host) {
      mount(host);
      host.scrollIntoView({ behavior: (global.UX && UX.behavior) ? UX.behavior() : 'smooth', block: 'start' });
    }
  }

  function reset() {
    try { storage.removeItem(KEY); } catch (e) { /* noop */ }
    const b = document.getElementById(REOPEN_ID);
    if (b) b.remove();
  }

  const Onboarding = {
    STEPS,
    shouldShow,
    mount,
    dismiss,
    reopen,
    reset,
    isOpen
  };
  global.Onboarding = Onboarding;
  if (typeof module !== 'undefined' && module.exports) module.exports = Onboarding;

  /* ====================================================================
   * 自动挂载
   * 放在 app.js 之前加载 → DOMContentLoaded 先跑 → 引导会插到 #page-kit
   * 第一个子节点。app.js 的各个 render* 只清自己的子容器（#kitResults、
   * #kitAll…），不会清掉 #page-kit，所以顺序上互不覆盖。
   * ==================================================================== */
  if (global.document) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        if (shouldShow()) { mount(); return; }
        // 已经跳过的老用户：把重开入口补上（localStorage 里有记录、DOM 里没有按钮
        // —— 正常刷新不会走到这里，这是给缓存/清库等边缘情况兜底）
        const f = readFlag();
        if (f && f.dismissedAt) addReopen();
      });
    } else if (shouldShow()) {
      mount();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
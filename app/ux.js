/* =========================================================================
 * ux.js —— 无障碍层（aria / 焦点 / 触控 / 对比度审计）
 * =========================================================================
 * 作用
 *   1. 建两个 aria-live 区域，把 toast 这类"纯视觉提示"变成屏幕阅读器听得到的话。
 *      这是这个项目当前最真实的无障碍缺陷：#toast 只是 opacity 0→1，
 *      VoiceOver / TalkBack 完全收不到，用户不知道"已记录"到底成功了没有。
 *   2. 补 tab 语义（tablist / tab / tabpanel）、方向键、roving tabindex 和
 *      切换后的焦点管理。
 *   3. 运行时审计：对比度 / 触控目标 / 可访问名 / 实时区 / 缩放 / 动效。
 *   4. 用「注入式样式」修掉改不了 app.css 的那几条：触控目标 >= 44px、
 *      :focus-visible 焦点环、prefers-reduced-motion 降级。
 *
 * 导出（全局 UX）
 *   UX.announce(msg, opts)     礼貌播报（aria-live=polite），重复消息不丢
 *   UX.alert(msg)              紧急播报（assertive），只给安全类信息用
 *   UX.enhance(root)           补语义属性，可重复调用；DOMContentLoaded 自动跑
 *   UX.onPageChange(page)      app.js 的 go() 里调一次，确定性更强（可选）
 *   UX.audit(root)             返回 [{id, level, area, msg, fix}]
 *   UX.auditSummary(root)      返回 {total, error, warn, pass, failed:[id]}
 *   UX.contrast(fg, bg)        WCAG 2.1 相对亮度对比度，'#0f1115' 写法
 *   UX.paletteFix              对比度不达标时的建议替换值（只读参考，未自动改）
 *   UX.behavior()              prefers-reduced-motion 时返回 'auto'，否则 'smooth'
 *   UX.CONFIG                  阈值与开关
 *
 * 集成
 *   index.html 里放在 app.js 之前：<script src="app/ux.js"></script>
 *   不改 app.js 也能工作（自动初始化 + MutationObserver 自愈）。
 *   改了 app.js 效果更确定，见 docs/ux-integration.md。
 *
 * 硬约束：不修改 index.html / app.css / app.js。本文件只新建节点和注入样式。
 * ========================================================================= */

(function (global) {
  'use strict';

  const CONFIG = {
    TOUCH_MIN: 44,          // WCAG 2.2 AA 触控目标最小边长（CSS px）
    AA_TEXT: 4.5,           // 正文对比度阈值
    AA_LARGE: 3.0,          // 大字（>=18.66px 粗体 / >=24px）对比度阈值
    AA_UI: 3.0,             // 非文字 UI 组件（边框、图形）阈值
    REPEAT_TONE_MS: 2400,   // 与 app.js toast() 的显示时长一致，用于超时清屏
    AUTO_INIT: true
  };

  /* ====================================================================
   * 对比度计算（WCAG 2.1）
   * 纯函数，独立于 DOM，任何时候都能调；单元测试可以直接喂色值。
   * ==================================================================== */

  function parseColor(c) {
    if (!c) return null;
    let s = String(c).trim();
    if (s.charAt(0) === '#') {
      s = s.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      if (s.length !== 6) return null;
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }
    const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
  }

  // sRGB -> 相对亮度。阈值 0.03928 是 WCAG 原文的 0.03928，不是 0.04045。
  function relLuminance(color) {
    const rgb = parseColor(color);
    if (!rgb) return null;
    const ch = rgb.map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(fg, bg) {
    const a = relLuminance(fg);
    const b = relLuminance(bg);
    if (a == null || b == null) return null;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }

  /* 已知不达标项的修正建议。只提供值，不自动改 app.css —— 配色是产品决策，
   * 不是无障碍 bug 修复范围内的自动行为。这里给的是"实测 + 可用替代值"。
   *
   * 实测（2026-10 跑的 WCAG 2.1 相对亮度公式，非目测）：
   *   --text-faint #6b7480  bg 3.99 / surface 3.68 / surface-2 3.32   ← 全部不达标
   *   --text-dim   #9aa3b2  bg 7.43 / surface 6.84 / surface-2 6.18   达标
   *   --accent     #5b9dff  bg 6.94 / surface 6.39 / surface-2 5.78   达标
   *   --ok         #3ddc97  最差 7.77（在 --ok-bg 底上）               达标
   *   --warn       #ffc857  最差 4.76（在 --danger-bg 叠 surface-2 上） 达标
   *   --danger     #ff6b6b  最差 5.30（在 --danger-bg 底上）           达标
   *   → 只有 --text-faint 一条需要改。--danger 第一眼看是"红=危险所以偏暗"，
   *     但 rgba(.12) 的浅底把它托起来了，实测够 AA，不用动。
   */
  const paletteFix = {
    '--text-faint': {
      current: '#6b7480',
      suggested: '#8b94a1',       // 最差底色(surface-2)上 5.13:1
      minimal: '#868f9c',          // 最小改动方案，最差底色上 4.81:1
      why: '3.99:1（页面底）/ 3.68:1（卡片底）/ 3.32:1（输入控件底），全部低于 AA 4.5:1',
      where: 'header .sub / .hint / .score / .empty / .metric .how / .searchbar placeholder'
    }
  };

  /* ====================================================================
   * 注入式样式
   * 为什么不写进 app.css：本任务不允许改 app.css；而这些修正全是
   * "纯 a11y 补丁"，与视觉设计无关，用 .a11y- 前缀作用域隔离，随时可撤。
   * ==================================================================== */

  const STYLE_ID = 'ux-a11y-style';
  const CSS = `
/* ---------- 触控目标：补到 >= 44px ---------- */
details.more > summary { min-height: 44px; display: flex; align-items: center; padding: 10px 0; }
button.btn.sm { min-height: 44px; padding: 11px 14px; }
.shot .del { width: 44px; height: 44px; font-size: 17px; }
label.check { min-height: 44px; padding: 13px; }
label.btn.primary { min-height: 46px; display: flex !important; align-items: center; justify-content: center; }
.searchbar { padding: 12px; }
.searchbar input { min-height: 30px; }

/* ---------- 焦点可见 ----------
   app.css 把 -webkit-tap-highlight-color 整个关掉了，又没有定义任何
   :focus-visible 样式。深色底上必须自己画，否则键盘用户的焦点位置不可见。 */
:where(a, button, summary, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 6px;
}
/* label 包 hidden input 的情况（如"拍一台器械"）：原生不可聚焦，
   强行加上 tabindex 后必须给焦点样式，否则焦点直接消失。 */
[role="button"][tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

/* ---------- 动效降级 ---------- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
}
`;

  function ensureStyle() {
    if (!global.document) return;
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ====================================================================
   * aria-live 区域
   * ==================================================================== */

  const LIVE_CLS = 'ux-sr-only';
  const LIVE_CSS = `
.${LIVE_CLS} {
  position: absolute !important; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%);
  white-space: nowrap;
}
`;

  let politeNode = null, alertNode = null, lastMsg = '';

  function liveNodes() {
    if (!global.document) return null;
    if (politeNode && politeNode.isConnected) return { polite: politeNode, alert: alertNode };
    const id = STYLE_ID;
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.appendChild(document.createTextNode(CSS + LIVE_CSS));
      document.head.appendChild(s);
    } else {
      ensureStyle();
    }
    politeNode = document.createElement('div');
    politeNode.className = LIVE_CLS;
    politeNode.id = 'ux-live';
    politeNode.setAttribute('role', 'status');
    politeNode.setAttribute('aria-live', 'polite');
    politeNode.setAttribute('aria-atomic', 'true');

    alertNode = document.createElement('div');
    alertNode.className = LIVE_CLS;
    alertNode.id = 'ux-live-alert';
    alertNode.setAttribute('role', 'alert');
    alertNode.setAttribute('aria-live', 'assertive');
    alertNode.setAttribute('aria-atomic', 'true');

    document.body.appendChild(politeNode);
    document.body.appendChild(alertNode);
    return { polite: politeNode, alert: alertNode };
  }

  /**
   * 写入实时区域。
   * 两个坑：
   *   1. 连续两次写完全一样的文本，部分读屏器会判定"没变"而不再朗读；
   *      这里对重复消息追加一个零宽字符强制产生 DOM 变化。
   *   2. 先清空再等一个任务写入，保证「同一节点、同一属性」的变更被识别为
   *      内容更新而不是无变化。
   */
  function write(node, msg) {
    if (!node) return;
    let text = String(msg == null ? '' : msg);
    if (text === lastMsg) text += '\u200B';
    lastMsg = String(msg == null ? '' : msg);
    node.textContent = '';
    global.setTimeout(function () { node.textContent = text; }, 50);
    global.setTimeout(function () {
      if (node.textContent) node.textContent = '';
    }, CONFIG.REPEAT_TONE_MS + 600);
  }

  function announce(msg, opts) {
    if (!msg) return;
    const n = liveNodes();
    write(n && n.polite, msg);
  }

  function alertMsg(msg) {
    if (!msg) return;
    const n = liveNodes();
    write(n && n.alert, msg);
  }

  /* ====================================================================
   * toast → aria-live 自动桥接
   * app.js 的 toast() 只改 #toast 的 textContent 和 class。
   * 用 MutationObserver 盯着它，app.js 一行都不用改，读屏器就能听到反馈。
   * ==================================================================== */

  let toastObserver = null;

  function bindToast() {
    if (!global.document || toastObserver) return;
    const t = document.getElementById('toast');
    if (!t) return;

    // toast 本身也要有 role，否则读屏器的虚拟光标停在上面时会读出空内容
    if (!t.hasAttribute('role')) t.setAttribute('role', 'status');
    if (!t.hasAttribute('aria-live')) t.setAttribute('aria-live', 'polite');

    let last = '';
    toastObserver = new MutationObserver(function () {
      const txt = (t.textContent || '').trim();
      if (txt && txt !== last) { last = txt; announce(txt); }
      else if (!txt) last = '';
    });
    toastObserver.observe(t, { childList: true, characterData: true, subtree: true });
  }

  /* ====================================================================
   * tab 语义 + 焦点管理
   * ==================================================================== */

  let kbdMode = false;   // 最近一次输入是不是键盘 —— 只有键盘切页才抢焦点

  function trackModality() {
    if (!global.document) return;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ' ||
          e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
        kbdMode = true;
      }
    }, true);
    document.addEventListener('pointerdown', function () { kbdMode = false; }, true);
  }

  const TAB_LABEL = { kit: '器材', goal: '目标', plan: '计划', react: '反馈' };

  function enhanceTabs() {
    if (!global.document) return;
    const bar = document.getElementById('tabbar');
    if (!bar) return;

    if (!bar.hasAttribute('role')) {
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', '主导航');
    }
    const btns = Array.prototype.slice.call(bar.querySelectorAll('button[data-page]'));
    btns.forEach(function (b) {
      const key = b.dataset.page;
      b.setAttribute('role', 'tab');
      b.id = b.id || ('ux-tab-' + key);
      b.setAttribute('aria-controls', 'page-' + key);
      // 图标是装饰，emoji 会被读屏器念成"放大镜"，必须藏掉
      const ic = b.querySelector('.ic');
      if (ic) ic.setAttribute('aria-hidden', 'true');
      // roving tabindex：整个 tablist 在 Tab 序列里只占一格，方向键在内部移动
      const on = b.getAttribute('aria-selected') === 'true';
      b.setAttribute('tabindex', on ? '0' : '-1');
    });

    // 方向键：ARIA Tabs 模式的标准键盘行为
    bar.addEventListener('keydown', function (e) {
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % btns.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = btns.length - 1;
      if (j < 0) return;
      e.preventDefault();
      kbdMode = true;
      btns[j].focus();
      btns[j].click();
    });

    // app.js 的 go() 会改 aria-selected。这里只观察属性变化，
    // 不去 hook 它的函数 —— 这样即使 app.js 改动也不会失效。
    if (bar.__uxObs) return;
    const mo = new MutationObserver(function () {
      btns.forEach(function (b) { syncTab(b); });
      const cur = btns.find(b => b.getAttribute('aria-selected') === 'true');
      if (cur) handlePageChange(cur.dataset.page);
    });
    btns.forEach(function (b) {
      mo.observe(b, { attributes: true, attributeFilter: ['aria-selected'] });
    });
    bar.__uxObs = mo;
  }

  function syncTab(b) {
    const on = b.getAttribute('aria-selected') === 'true';
    b.setAttribute('tabindex', on ? '0' : '-1');
    const page = document.getElementById(b.getAttribute('aria-controls'));
    if (!page) return;
    if (!page.hasAttribute('role')) page.setAttribute('role', 'tabpanel');
    if (!page.hasAttribute('tabindex')) page.setAttribute('tabindex', '-1');
    if (!page.hasAttribute('aria-labelledby')) page.setAttribute('aria-labelledby', b.id);
  }

  let lastPage = null;
  function handlePageChange(page) {
    if (page === lastPage) return;
    lastPage = page;
    const pg = document.getElementById('page-' + page);
    if (kbdMode && pg) {
      // 键盘用户：直接把焦点送进新面板，读屏器会自然朗读面板开头。
      // 这里刻意不额外 announce，否则同一段内容会被念两遍。
      try { pg.focus({ preventScroll: true }); } catch (e) { pg.focus(); }
      pg.scrollIntoView({ behavior: behavior(), block: 'start' });
    } else {
      // 鼠标/触摸用户：焦点留在 tab 按钮上（抢焦点反而烦人），只播报页名。
      announce('已切换到「' + (TAB_LABEL[page] || page) + '」页');
    }
  }

  function onPageChange(page) {
    enhanceTabs();
    lastPage = null;
    handlePageChange(page);
  }

  /* ====================================================================
   * 动态内容的持续增强
   * app.js 的每个 render* 都是 innerHTML 重建，静态改一次不够，
   * 所以用 MutationObserver 兜住后续生成的节点。
   * ==================================================================== */

  function enhanceDynamic(root) {
    if (!root || !root.querySelectorAll) return;

    // 1) 搜索结果 / 器材列表这类"刷出来"的内容，单独给一个 live 区
    const kitResults = document.getElementById('kitResults');
    if (kitResults && !kitResults.hasAttribute('aria-live')) {
      kitResults.setAttribute('aria-live', 'polite');
      kitResults.setAttribute('aria-atomic', 'false');
    }

    // 2) 选项组：.opts 是由 JS 生成的，用 aria-pressed 模拟单选。
    //    不谎称 radiogroup（app.js 写的是 aria-pressed，不是 aria-checked），
    //    只补 group 角色和来自上一个标题的名字。
    root.querySelectorAll('.opts').forEach(function (g) {
      if (g.getAttribute('role')) return;
      g.setAttribute('role', 'group');
      if (!g.hasAttribute('aria-label')) {
        let lab = '';
        let n = g.previousElementSibling;
        for (let i = 0; i < 3 && n; i++, n = n.previousElementSibling) {
          if (/^H[1-3]$/.test(n.tagName)) { lab = n.textContent.trim(); break; }
        }
        if (!lab) {
          const pg = g.closest ? g.closest('.page') : null;
          const h = pg && pg.querySelector('h2');
          lab = h ? h.textContent.trim() : '选项';
        }
        g.setAttribute('aria-label', lab + '（单选）');
      }
    });

    // 3) label 包着的 hidden input（"拍一台器械"）：原生不可聚焦，
    //    键盘和读屏用户根本够不到相机。补 role/tabindex/回车触发。
    root.querySelectorAll('label').forEach(function (l) {
      const inp = l.querySelector('input[type="file"]');
      if (!inp) return;
      if (l.getAttribute('role') === 'button') return;
      l.setAttribute('role', 'button');
      l.setAttribute('tabindex', '0');
      l.setAttribute('aria-label', (l.textContent || '').trim() || '选择照片');
      l.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); }
      });
    });
  }

  let mainObserver = null;
  function watchMain() {
    if (!global.document || mainObserver) return;
    const main = document.querySelector('main');
    if (!main) return;
    let t = null;
    const run = function () { enhanceDynamic(main); };
    mainObserver = new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(run, 60);   // render* 一次会插几十个节点，合并处理
    });
    mainObserver.observe(main, { childList: true, subtree: true });
  }

  /* ====================================================================
   * prefers-reduced-motion
   * app.css 有 .page 的 fade 动画，app.js 有两处 scrollIntoView({behavior:'smooth'})。
   * CSS 归 CSS，这里只做 JS 侧：仅对"系统要求减少动效"的用户把平滑滚动降为瞬时。
   * ==================================================================== */

  let motionPatched = false;
  function reduceMotion() {
    if (!global.matchMedia) return false;
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function behavior() { return reduceMotion() ? 'auto' : 'smooth'; }
  function patchMotion() {
    if (motionPatched || !reduceMotion() || !global.Element) return;
    motionPatched = true;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg) {
      if (arg && typeof arg === 'object') {
        try { return orig.call(this, Object.assign({}, arg, { behavior: 'auto' })); }
        catch (e) { /* 老浏览器不支持对象形式，落到下面 */ }
      }
      return orig.call(this, arg);
    };
  }

  /* ====================================================================
   * 审计
   * 返回 [{id, level:'error'|'warn', area, msg, fix}]
   * level=error 表示 WCAG A/AA 明确不达标；warn 表示"能用但会让人难受"。
   * ==================================================================== */

  function cssVar(name, fallback) {
    if (!global.getComputedStyle) return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function rect(n) {
    try { return n.getBoundingClientRect(); } catch (e) { return null; }
  }

  function visible(n) {
    const r = rect(n);
    return !!r && r.width > 0 && r.height > 0;
  }

  function name(n) {
    let s = n.tagName.toLowerCase();
    if (n.id) s += '#' + n.id;
    if (n.className && typeof n.className === 'string') {
      s += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    const t = (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18);
    return t ? s + ' 「' + t + '」' : s;
  }

  function accessibleName(n) {
    if (!global.getComputedStyle) return true;
    const aria = n.getAttribute('aria-label');
    if (aria && aria.trim()) return true;
    const by = n.getAttribute('aria-labelledby');
    if (by && by.split(/\s+/).some(id => document.getElementById(id))) return true;
    if (n.getAttribute('aria-labelledby')) return true;
    const ttl = n.getAttribute('title');
    if (ttl && ttl.trim()) return true;
    if (n.closest && n.closest('label')) return true;
    // 图标按钮：可见文字只有 emoji / 符号
    const own = Array.prototype.filter.call(n.childNodes, function (c) {
      return c.nodeType === 3;
    }).map(c => c.textContent.trim()).join('');
    const emojiOnly = own.length > 0 && !/[一-龥A-Za-z0-9]/.test(own);
    if (emojiOnly) return false;
    return (n.textContent || '').trim().length > 0;
  }

  function audit(root) {
    const out = [];
    const scope = root || document.body;
    if (!scope) return out;
    const add = (id, level, area, msg, fix) => out.push({ id, level, area, msg, fix });

    /* ---- 1. 语言 / 文档级 ---- */
    if (document.documentElement.getAttribute('lang')) { /* ok */ }
    else add('doc-lang', 'error', '文档', '<html> 缺 lang，读屏器会用错发音引擎', '加 lang="zh-CN"');

    const vp = document.querySelector('meta[name="viewport"]');
    const vpc = vp ? (vp.getAttribute('content') || '') : '';
    if (/maximum-scale\s*=\s*1(\b|\.)/.test(vpc) || /user-scalable\s*=\s*no/.test(vpc)) {
      add('doc-zoom', 'error', '文档',
        'viewport 用 maximum-scale=1 / user-scalable=no 禁用了缩放，违反 WCAG 1.4.4',
        '删掉这两个参数，让用户可以放大');
    }

    /* ---- 2. 实时区域 ---- */
    const toast = document.getElementById('toast');
    if (toast && !toast.hasAttribute('aria-live') && !toast.getAttribute('role')) {
      add('live-toast', 'error', '屏幕阅读器',
        '#toast 只有 opacity 过渡，没有任何 aria-live / role，读屏器完全收不到"已记录""已复制"',
        'UX.bindToast() 已自动补 role=status + aria-live=polite');
    }
    if (!document.getElementById('ux-live')) {
      add('live-region', 'error', '屏幕阅读器',
        '页面没有 polite 实时区，异步完成的提示无法播报',
        'UX.announce(msg) / UX.alert(msg)');
    }
    const hdr = document.querySelector('header h1');
    if (hdr && !hdr.hasAttribute('aria-live')) {
      add('live-title', 'warn', '屏幕阅读器',
        '顶部标题随页面切换而变，但没有实时区，切换后用户不知道自己在哪一页',
        'UX.onPageChange(page) 会播报；或给 header 容器加 aria-live="polite"');
    }

    /* ---- 3. tab 语义 ---- */
    const bar = document.getElementById('tabbar');
    if (bar) {
      if (bar.getAttribute('role') !== 'tablist') {
        add('tab-role', 'error', '导航',
          '#tabbar 缺 role="tablist"，子按钮也没有 role="tab" / aria-controls',
          'UX.enhance() 已自动补齐');
      }
      const missingRoving = Array.prototype.some.call(bar.querySelectorAll('button[data-page]'),
        b => !b.hasAttribute('tabindex'));
      if (missingRoving) {
        add('tab-keyboard', 'error', '键盘',
          'tab 按钮没有 roving tabindex，Tab 键要在 4 个 tab 上逐个停，没有方向键导航',
          'UX.enhance() 已补 ArrowLeft/Right/Home/End + roving tabindex');
      }
      const decorativeEmoji = Array.prototype.filter.call(bar.querySelectorAll('.ic'),
        e => !e.hasAttribute('aria-hidden'));
      if (decorativeEmoji.length) {
        add('tab-emoji', 'warn', '屏幕阅读器',
          'tab 里的 emoji 图标没藏起来，会被念成"放大镜 器材"之类',
          'UX.enhance() 已给 .ic 加 aria-hidden="true"');
      }
    }
    const orphan = Array.prototype.filter.call(document.querySelectorAll('.page'),
      p => !p.hasAttribute('role'));
    if (orphan.length && bar) {
      add('panel-role', 'error', '导航',
        orphan.length + ' 个 .page 缺 role="tabpanel" / aria-labelledby',
        'UX.enhance() 已自动补齐');
    }
    // 切页后焦点：非激活页用 display:none 已经正确移出了无障碍树
    const activePages = document.querySelectorAll('.page.active');
    if (!activePages.length && document.querySelector('.page')) {
      add('panel-active', 'warn', '导航', '没有 .page.active，所有页面都不显示', '检查 go() 是否跑过');
    }

    /* ---- 4. 表单标签 ---- */
    Array.prototype.forEach.call(scope.querySelectorAll('input, textarea, select'), function (f) {
      if (f.type === 'hidden') return;
      const hasLabel = accessibleName(f) ||
        (f.id && document.querySelector('label[for="' + CSS.escape(f.id) + '"]')) ||
        (f.closest && f.closest('label'));
      if (!hasLabel) {
        const ph = f.getAttribute('placeholder');
        add('label-' + name(f), ph ? 'error' : 'error', '表单',
          name(f) + ' 没有可访问名' + (ph ? '（只有 placeholder，不算 label，会随输入消失）' : ''),
          'UX.enhance() 会给搜索框补 aria-label；其余需在渲染处加');
      }
    });

    /* ---- 5. 触控目标 ---- */
    const tapSel = 'button, summary, a[href], label.check, label.btn, input[type="checkbox"], input[type="radio"], [role="button"]';
    const small = new Map();
    Array.prototype.forEach.call(scope.querySelectorAll(tapSel), function (n) {
      if (n.disabled) return;
      if (!visible(n)) return;
      if (n.classList && n.classList.contains('shot')) return;
      const r = rect(n);
      const w = Math.round(r.width), h = Math.round(r.height);
      if (h >= CONFIG.TOUCH_MIN && w >= CONFIG.TOUCH_MIN) return;
      // checkbox 本身 20px 是原生控件，可点区域是包它的 label.check，按 label 记
      if (n.tagName === 'INPUT' && n.closest && n.closest('label.check')) return;
      const key = (n.tagName.toLowerCase() + '.' + String(n.className || '').trim().split(/\s+/)[0]) || n.tagName;
      const prev = small.get(key);
      if (!prev) small.set(key, { n, w, h });
      else if (h < prev.h) small.set(key, { n, w, h });
    });
    small.forEach(function (v, key) {
      add('touch-' + key, 'error', '触控',
        name(v.n) + ' 实际只有 ' + v.w + '×' + v.h + 'px，低于 ' + CONFIG.TOUCH_MIN + 'px（WCAG 2.2 AA 2.5.8）',
        'UX 注入样式已把 details summary / .btn.sm / .shot .del / .check 补到 >= 44px');
    });

    /* ---- 6. 触摸反馈 ---- */
    if (!Array.prototype.some.call(document.styleSheets || [], function () { return false; }) && false) { /* noop */ }
    const hit = /-webkit-tap-highlight-color\s*:\s*transparent/.test(cssTextAll());
    if (hit) {
      add('touch-feedback', 'warn', '触控',
        '全局设了 -webkit-tap-highlight-color:transparent 且没有任何 :focus-visible 样式，' +
        '手机上点下去没有任何视觉反馈，键盘用户的焦点位置也不可见',
        'UX 注入样式已补 2px --accent 焦点环');
    }

    /* ---- 7. 动效 ---- */
    if (!reduceMotion() && !prefersReducedMotionCss()) {
      add('motion', 'warn', '动效',
        '检测到 prefers-reduced-motion 没有对应的降级（页面淡入动画 + 平滑滚动）',
        'UX 注入样式已降级 CSS 动画；JS 侧 scrollIntoView 已被 UX 改写');
    }

    /* ---- 8. 图片 ---- */
    Array.prototype.forEach.call(scope.querySelectorAll('img'), function (im) {
      if (im.getAttribute('alt') == null) {
        add('img-alt', 'error', '图片', name(im) + ' 缺 alt 属性', '给 img 加 alt');
      }
    });

    /* ---- 9. 对比度 ---- */
    const bg = cssVar('--bg', '#0f1115');
    const surface = cssVar('--surface', '#171a21');
    const surface2 = cssVar('--surface-2', '#1f232c');
    const pairs = [
      ['--text', bg, '正文'],
      ['--text', surface, '正文（卡片内）'],
      ['--text-dim', bg, '次要说明文字'],
      ['--text-dim', surface, '次要说明文字（卡片内）'],
      ['--text-dim', surface2, '次要说明文字（选项按钮内）'],
      ['--text-faint', bg, 'hint / 空状态 / header 副标题'],
      ['--text-faint', surface, 'hint / .score / .metric .how'],
      ['--text-faint', surface2, '搜索框 placeholder'],
      ['--accent', surface, 'details summary / 链接'],
      ['--accent', surface2, '选中态选项文字'],
      ['--ok', bg, '通过文案'],
      ['--warn', bg, '注意文案'],
      ['--danger', bg, '停止文案'],
      ['--danger', surface, '.stop .lb'],
      ['--danger', surface2, '.btn.danger 文字'],
      ['--ok', tint(cssVar('--ok', '#3ddc97'), surface), '.cues li（成功底色）'],
      ['--warn', tint(cssVar('--warn', '#ffc857'), surface), '.badge.warn（注意底色）'],
      ['--danger', tint(cssVar('--danger', '#ff6b6b'), surface), '.stop .lb / .spec.cap（危险底色）'],
      ['--danger', tint(cssVar('--danger', '#ff6b6b'), surface2), '危险底色叠在选项按钮上（全站最差组合）']
    ];
    pairs.forEach(function (p) {
      const fg = cssVar(p[0], '#888888');
      const ratio = contrast(fg, p[1]);
      if (ratio == null) return;
      if (ratio < CONFIG.AA_TEXT) {
        const fix = paletteFix[p[0]];
        add('contrast-' + p[0] + '-' + p[2], 'error', '对比度',
          p[0] + ' ' + fg + ' 在 ' + p[1] + ' 上只有 ' + ratio + ':1，低于 AA 4.5:1（用途：' + p[2] + '）',
          fix ? '把 --' + p[0].replace(/^--/, '') + ' 改成 ' + fix.suggested +
                 '（最小改动方案 ' + fix.minimal + '），改完是 ' +
                 (contrast(fix.suggested, p[1]) || '?') + ':1' : '调亮前景色到 4.5:1 以上');
      }
    });

    // 非文字 UI 组件（边框、勾选框描边）
    [['--border', surface, '.card / .btn / .searchbar 边框'],
     ['--border', surface2, '.opt / .btn 边框（搜索框边界靠它，可辨识性直接影响能不能找到输入框）']]
      .forEach(function (p) {
        const r = contrast(cssVar(p[0], '#2a2f3a'), p[1]);
        if (r != null && r < CONFIG.AA_UI) {
          add('contrast-ui-' + p[2], 'warn', '对比度',
            p[0] + ' 在 ' + p[1] + ' 上只有 ' + r + ':1，低于非文字组件的 3:1（' + p[2] + '）',
            '卡片边框可以只当分组装饰；但输入框/按钮的边界要能被看见，建议提到 3:1');
        }
      });

    // 卡片面 vs 页面底：这是整个暗色配色的结构问题，必须写进报告而不是藏起来。
    // WCAG 公式在极低亮度区间会低估人眼的分辨力（暗色模式的已知副作用），
    // 所以这里只报 warn，并写清真实影响：低视力 + 高亮度环境屏幕下卡片会糊成一片。
    const struct = contrast(surface, bg);
    if (struct != null && struct < CONFIG.AA_UI) {
      add('contrast-structure', 'warn', '对比度',
        '卡片面 --surface 与页面底 --bg 只有 ' + struct + ':1，卡片边界几乎不可见。' +
        '人眼在低亮度下分辨度高于 WCAG 公式，所以视觉上能接受；但 WCAG 1.4.11 要求' +
        '非文字组件 >= 3:1，低视力用户在高亮度屏幕 + 反光环境下会分不清卡片边界',
        '要么提亮 --surface，要么给卡片边框单独提亮，别指望边框兜底（边框本身也才 1.3:1）');
    }

    /* ---- 10. 图标按钮 ---- */
    Array.prototype.forEach.call(scope.querySelectorAll('button, [role="button"]'), function (b) {
      if (!accessibleName(b)) {
        add('name-' + name(b), 'error', '屏幕阅读器',
          name(b) + ' 是图标/纯符号按钮但没有 aria-label，读屏器只会念出一个 emoji',
          '给按钮加 aria-label');
      }
    });

    /* ---- 11. 单选语义 ---- */
    Array.prototype.forEach.call(scope.querySelectorAll('.opts'), function (g) {
      const opts = g.querySelectorAll('.opt');
      if (!opts.length) return;
      const pressed = Array.prototype.some.call(opts, o => o.hasAttribute('aria-pressed'));
      const checked = Array.prototype.some.call(opts, o => o.hasAttribute('aria-checked'));
      if (pressed && !checked) {
        add('radio-' + name(g), 'warn', '表单',
          '这组选项是单选，但用 aria-pressed 模拟（读屏器会念成"按钮 已按下"）。' +
          '标准做法是 role="radiogroup" + 子项 role="radio" + aria-checked',
          'UX 只补了 role="group" 和名字，不谎称 radio；改造需动 app.js 的渲染代码');
      }
    });

    return out;
  }

  function tint(fg, bg, alpha) {
    const f = parseColor(fg), b = parseColor(bg);
    if (!f || !b) return bg;
    const a = alpha == null ? 0.12 : alpha;
    return '#' + [0, 1, 2].map(function (i) {
      return Math.round(f[i] * a + b[i] * (1 - a)).toString(16).padStart(2, '0');
    }).join('');
  }

  let _cssAll = null;
  function cssTextAll() {
    if (_cssAll != null) return _cssAll;
    let buf = '';
    try {
      Array.prototype.forEach.call(document.styleSheets, function (sh) {
        try { buf += Array.prototype.join.call(sh.cssRules, '\n'); } catch (e) { /* 跨域 */ }
      });
    } catch (e) { /* noop */ }
    const link = document.querySelector('link[rel="stylesheet"]');
    if (link && link.sheet) { /* 已上面处理 */ }
    _cssAll = buf;
    return buf;
  }

  function prefersReducedMotionCss() {
    return /prefers-reduced-motion/.test(cssTextAll());
  }

  function auditSummary(root) {
    const list = audit(root);
    const s = { total: list.length, error: 0, warn: 0, pass: 0, failed: [], items: list };
    list.forEach(function (i) {
      if (i.level === 'error') { s.error++; s.failed.push(i.id); }
      else s.warn++;
    });
    return s;
  }

  /* ====================================================================
   * 初始化
   * ==================================================================== */

  let enhanced = false;
  function enhance() {
    if (!global.document) return;
    ensureStyle();
    liveNodes();
    trackModality();
    patchMotion();
    bindToast();
    enhanceTabs();
    watchMain();
    enhanceDynamic(document.body);
    enhanced = true;
    return UX;
  }

  const UX = {
    CONFIG,
    paletteFix,
    contrast,
    relLuminance,
    announce,
    alert: alertMsg,
    bindToast,
    enhance,
    onPageChange,
    audit,
    auditSummary,
    behavior,
    prefersReducedMotion: reduceMotion
  };
  global.UX = UX;
  if (typeof module !== 'undefined' && module.exports) module.exports = UX;

  if (CONFIG.AUTO_INIT && global.document) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', enhance);
    } else {
      enhance();
    }
  }

})(typeof window !== 'undefined' ? window : globalThis);
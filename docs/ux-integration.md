# 无障碍 / 首次引导 / 完成度 —— 接线说明

本目录新增三个文件，全部是独立 IIFE，挂到全局 `UX` / `Onboarding` / `Progress`。
**没有修改 `index.html` / `app\app.js` / `app\app.css`**，本文件给出接线方案，由改这三处的人执行。

| 文件 | 导出 | 作用 |
|---|---|---|
| `app/ux.js` | `UX` | aria-live、tab 语义与焦点管理、对比度/触控/标签审计、注入式 a11y 样式 |
| `app/onboarding.js` | `Onboarding` | 3 步首次引导，可跳过、不遮挡、关得掉也找得回 |
| `app/progress.js` | `Progress` | 本周完成度单一闭环数字（次数 / 组数 + 鼓励性结论） |

零第三方依赖、零 CDN、零网络请求。三个文件都能在 `node --check` 下通过，
也可以 `require()` 出来跑逻辑测试。

---

## 1. index.html 加哪几行

现有加载顺序在 `index.html:184-195`：

```
id-alias → safety → data-machines → data-exercises → goal → log
→ assess → plan → evidence → recognize → api → app.js
```

在 `api.js` 之后、`app.js` 之前插三行（`index.html:194` 与 `195` 之间）：

```html
<script src="app/api.js"></script>
<script src="app/ux.js"></script>          <!-- 新增 -->
<script src="app/onboarding.js"></script>  <!-- 新增 -->
<script src="app/progress.js"></script>    <!-- 新增 -->
<script src="app/app.js"></script>
```

**为什么放这个位置**

- `ux.js` / `onboarding.js` / `progress.js` 在 `DOMContentLoaded` 时自动初始化。
  放在 `app.js` 之前 → 它们的 `DOMContentLoaded` 监听器先注册、先执行。
- `UX.enhance()` 先跑不影响 `app.js` 的 `boot()`：它只读静态 HTML（`#tabbar`、
  `.page`、`.searchbar`），再挂 `MutationObserver` 兜住后续 render 生成的节点。
- `onboarding.js` 把引导卡插成 `#page-kit` 的第一个子节点。`app.js` 的各个
  `render*()` 只清自己的子容器（`#kitResults` / `#kitAll` / `#todayTour` …），
  **不会清空 `#page-kit` 本身**，所以两者互不覆盖，顺序上谁先都行。
- `progress.js` 不自动挂载，必须由 `app.js` 调（见下），因为它要插进
  `#planBody`，而那个容器归 `renderPlan()` 管。

---

## 2. app.js 里在哪几行调用

### 2.1 必改（只有这一处是必须的）

`app\app.js:509-510`，`renderPlan()` 的开头：

```js
  function renderPlan() {
    const box = $('#planBody');
    box.innerHTML = '';
    Progress.mountInto(box);        // ← 新增：本周完成度卡插在最上面
    const st = Log.load();
```

`renderPlan()` 在 `boot()` 和 `go('plan')` 里都会跑，所以切到「计划」页自动刷新。

### 2.2 推荐（确定性更好，但不做也能工作）

**a) toast 播报 —— `app\app.js:971-977`**

```js
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    UX.announce(msg);                              // ← 新增
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }
```

> 不加也能工作：`UX.bindToast()` 已经在跑 `MutationObserver` 盯着 `#toast`，
> 自动把它转发到 `aria-live` 区域。显式调是为了少一层依赖、少一点延迟。
> **安全类提示（痛/抽筋）改用 `UX.alert(msg)`**（assertive，会打断读屏）。

**b) 切页焦点 —— `app\app.js:90` 之后**

```js
    window.scrollTo(0, 0);
    UX.onPageChange(page);                          // ← 新增
```

> 不加也能工作：`UX` 观察 `#tabbar button[aria-selected]` 的属性变化，
> 谁改了它都会同步 roving tabindex + 焦点。显式调的好处是首帧就到位，不依赖观察器。

**c) 首次引导挂载 —— `app\app.js:52` 附近（`bindDataBtns()` 之后）**

```js
    bindDataBtns();
    if (Onboarding.shouldShow()) Onboarding.mount();   // ← 新增
    renderKitAll();
```

> 不加也能工作（`onboarding.js` 会自动挂到 `#page-kit`）。显式调是为了把
> 「什么时候弹」的决定权留在 app.js 手里。

### 2.3 建议但不在本任务范围

`app\app.js:492` 和 `app\app.js:778` 两处 `scrollIntoView({behavior:'smooth'})`：

```js
  box.scrollIntoView({ behavior: UX.behavior(), block: 'nearest' });
```

`UX.behavior()` 在用户开了「减少动态效果」时返回 `'auto'`。
（`UX` 已经在 `prefers-reduced-motion: reduce` 生效时自动改写了
`Element.prototype.scrollIntoView`，所以不改这两行也不会有动画 —— 但显式写更清楚。）

---

## 3. 审计怎么跑

浏览器控制台：

```js
UX.auditSummary()
// → { total, error, warn, failed: [...], items: [{id, level, area, msg, fix}] }

UX.audit(document.body).filter(i => i.level === 'error').map(i => i.id)
```

对比度单独算：

```js
UX.contrast('#6b7480', '#0f1115')   // 3.99
UX.paletteFix['--text-faint']       // { suggested: '#8b94a1', minimal: '#868f9c', ... }
```

---

## 4. 无障碍审计结果（2026-10 实测，非目测）

### 4.1 对比度 —— WCAG 2.1 相对亮度公式实算

正文阈值 AA = 4.5:1，非文字组件 = 3:1。rgba(.12) 的底色先按 alpha 合成为实色再算。

| 前景 | 底色 | 实测 | 判定 |
|---|---|---|---|
| `--text-faint` `#6b7480` | `--bg` `#0f1115` | **3.99:1** | ✗ |
| `--text-faint` | `--surface` `#171a21` | **3.68:1** | ✗ |
| `--text-faint` | `--surface-2` `#1f232c` | **3.32:1** | ✗ |
| `--text-dim` `#9aa3b2` | `--surface-2` | 6.18:1 | ✓ |
| `--text` `#e8eaed` | `--bg` | 15.68:1 | ✓ |
| `--accent` `#5b9dff` | `--surface-2` | 5.78:1 | ✓ |
| `--ok` `#3ddc97` | `--ok-bg` 合成 `#1c312f` | 7.77:1 | ✓ |
| `--warn` `#ffc857` | `--warn-bg` 合成 `#332f27` | 8.66:1 | ✓ |
| `--danger` `#ff6b6b` | `--danger-bg` 合成 `#33242a` | 5.30:1 | ✓ |
| `--danger` | `--danger-bg` 叠 `--surface-2` `#3a2c34` | 4.76:1 | ✓（全站最差组合） |
| `.btn.primary` `#06101f` | `--accent` | 7.00:1 | ✓ |
| `--border` `#2a2f3a` | `--surface-2` | **1.17:1** | ✗ 非文字组件 |
| `--surface` | `--bg` | **1.09:1** | ✗ 非文字组件（结构问题） |

**结论：只有 `--text-faint` 一条真不达标，修正值：**

| 方案 | 值 | bg | surface | surface-2 |
|---|---|---|---|---|
| 推荐 | `#8b94a1` | 6.16 | 5.68 | **5.13** |
| 最小改动 | `#868f9c` | 5.78 | 5.32 | **4.81** |

改 `app.css:12` 一行即可。受影响的地方：`header .sub`、`.hint`、`.score`、
`.empty`、`.metric .how`、`.searchbar input::placeholder` —— 全站辅助文字都走这一条。

`--danger` 第一眼看着像「红=危险所以偏暗」，但 `rgba(255,107,107,.12)` 的浅底把它托起来了，
实测最差 4.76:1，**够 AA，不用动**。（这条我一开始手算成 4.15 是错的，alpha 合成时蓝通道用错了底色值。）

`--surface` vs `--bg` 的 1.09:1 记为 warn 不记 error：WCAG 公式在极低亮度区间
系统性低估人眼分辨力，暗色模式的已知副作用。但低视力用户 + 高亮度屏幕 + 反光
环境下卡片会糊成一片，这个风险是真的。

### 4.2 触控目标（WCAG 2.2 AA 2.5.8，最小 24×24，业界统一取 44×44）

| 元素 | 实测 | 判定 |
|---|---|---|
| `nav.tabbar button` | `min-height: 56px` | ✓ |
| `button.btn` | `min-height: 46px` | ✓ |
| `.opt` 选项按钮 | 13px padding + 23px 行高 ≈ 49–52px | ✓ |
| `label.check` 复选框行 | 45px（含 2px 边框） | ✓ 勉强 |
| `details.more > summary` | 6px padding + 21px 行高 ≈ **33px** | ✗ 全站几十处 |
| `button.btn.sm` | `min-height: 36px` | ✗ 「记一次执行」「拉取动作库」等 |
| `.shot .del` 删除照片 | **24×24px** | ✗ 最小的一个 |
| `label.btn.primary` 包 `input[hidden]` | **不可聚焦** | ✗ 键盘/读屏根本够不到相机 |
| `.searchbar input` | 自身行高 ≈ 26px（父容器够，input 不够） | ✗ |

`UX.enhance()` 注入的样式已把前 6 项补到 ≥ 44px；相机 label 补了 `role="button"`
+ `tabindex="0"` + 回车/空格触发。

### 4.3 缺陷清单

| # | 级别 | 位置 | 问题 | 修复方 |
|---|---|---|---|---|
| 1 | error | `#toast` | 纯 opacity 过渡，无 `role` 无 `aria-live`。读屏器**完全收不到**「已记录」「已复制」 | UX ✅ |
| 2 | error | `#tabbar` | 无 `role="tablist"`，按钮无 `role="tab"` / `aria-controls` | UX ✅ |
| 3 | error | `#tabbar button` | 无 roving tabindex，无方向键导航；Tab 键要在 4 个 tab 上逐个停 | UX ✅ |
| 4 | error | 切页后焦点 | 焦点留在 tab 按钮上，没有任何焦点管理；读屏用户不知道自己在哪一页 | UX ✅ |
| 5 | error | `#kitSearch` | 只有 `placeholder`，无 `<label>`；placeholder 会随输入消失，不能算可访问名 | UX ✅（补 aria-label） |
| 6 | error | `label.btn.primary` | 包着 `input[hidden]`，键盘与读屏用户**无法触发相机** | UX ✅ |
| 7 | error | `--text-faint` | 3.32–3.99:1，三种底色全部低于 AA | 需改 `app.css:12`（见 4.1） |
| 8 | error | `details summary` | ≈33px，全站几十处可点 summary 触控目标不足 | UX ✅ |
| 9 | error | `button.btn.sm` | 36px | UX ✅ |
| 10 | error | `.shot .del` | 24×24px | UX ✅ |
| 11 | error | `#bootFail` | 无 `role="alert"`，加载失败兜底页读屏器不播报 | 需改 `index.html` |
| 12 | warn | `--border` | 1.17:1，输入框/按钮边界不满足 3:1 | 需改 `app.css` |
| 13 | warn | `--surface` vs `--bg` | 1.09:1，卡片边界几乎不可见 | 需改 `app.css` |
| 14 | warn | `.opt` / `#reactOpts` | 单选组用 `aria-pressed` 模拟，读屏器念成「按钮 已按下」。标准做法是 `radiogroup` + `radio` + `aria-checked` | 需改 `app.js` 的 `mk()` / `bindReact()` |
| 15 | warn | `nav .ic` emoji | 没藏，会被念成「放大镜 器材」 | UX ✅ |
| 16 | warn | `.page` | 无 `role="tabpanel"` / `aria-labelledby` | UX ✅ |
| 17 | warn | 全局 CSS | `-webkit-tap-highlight-color: transparent` 且无任何 `:focus-visible` 样式 → 手机上点了没反馈，键盘焦点位置不可见 | UX ✅ |
| 18 | warn | `.page` fade 动画 | 无 `prefers-reduced-motion` 降级 | UX ✅ |
| 19 | warn | `index.html:5` | `maximum-scale=1` 禁用缩放，违反 WCAG 1.4.4 | 需改 `index.html` |
| 20 | warn | `#kitResults` | 搜索结果刷出来无 live 区，搜完不知道结果 | UX ✅ |

**20 项，其中 error 11 项 / warn 9 项。UX 模块可直接修掉 15 项，
剩下 5 项要动 `app.css` 或 `index.html`（本任务不允许）。**

---

## 5. Onboarding

```js
Onboarding.shouldShow()     // 没跳过过 && Log.load().goal 为空 && Log 存在
Onboarding.mount(container) // 不传 container 则自动插到 #page-kit 最前面
Onboarding.dismiss(reason)  // 'skip' | 'close' | 'start'
Onboarding.reopen()         // 清标记并重新打开
Onboarding.reset()          // 只清标记
Onboarding.isOpen()
Onboarding.STEPS            // 三步文案，可直接改
```

- 存储键：`fitcoach.onboard.v1`，值 `{dismissedAt, reason}`。localStorage 不可用时
  走内存兜底（无痕模式 iOS Safari 会直接抛 `SecurityError`，同 `log.js` 的处理）。
- **不遮挡**：不是全屏遮罩，不是 `position: fixed`，就是「器材」页顶上一张卡，
  下面的 `h2`、搜索框、图鉴全部照常可用。
- **随时能关**：右上角 × / 「跳过」 / 第三步「去定目标」三种出口，都会写标记。
- **关得掉也找得回**：关闭后在「器材」页最底部插一个虚线小按钮
  「新手引导 · 随时可以再看一遍（3 步，20 秒）」，`.onb-reopen`。
- 定过目标的老用户永远不会再看到（`shouldShow()` 里判 `st.goal`）。
- 第三步「去定目标」按钮直接 `click()` `#tabbar button[data-page="goal"]`，
  走的是 app.js 自己的 tab 逻辑，不新增事件通道。
- 样式由 `onboarding.js` 注入 `#onb-style`，全部类名带 `onb-` 前缀，
  零冲突，删掉那个 `<style>` 就完全回退。

---

## 6. Progress

```js
Progress.compute(state)   // { done, expected, ratio, headline, detail, sets, reps,
                          //   tone, settled, daysLeft, weekNo, phaseName, label, ariaLabel }
Progress.mountInto(el)    // 清空容器 + 渲染
Progress.renderInto(el)   // 只追加
```

`compute()` 四条分支的实测输出（目标 = 每周 3 次）：

| 本周 done | ratio | headline |
|---|---|---|
| 0 | 0 | `这周还没开始 —— 哪天来都行，今天来也算` |
| 1 | 0.33 | **`这周已经练了 1 次，这就算数`** |
| 3 | 1 | `这周 3 次，练够了` |
| 5 | 1（截断） | `这周 5 次，练够了` |
| 无目标 | 0 | `还没定目标 —— 先花 1 分钟选一个` |

`done=1` 的 detail：「你的目标是每周 3 次。剩下的 2 次不用赶 —— 周末去一次，
或者放到下周都行，**练得少不会白练**。」

**措辞护栏**（改文案前先读这段）：

- 全文没有「未达标 / 未完成 / 失败 / 欠缺 / 欠 / 差 / %」，已用脚本扫过，0 命中。
- `done > 0` 一律先说「这就算数」，目标次数只作为背景出现，不参与扣分。
- `done === 0` 说的是「哪天来都行」，不是「你今天没练」。
- `done >= expected` 直接宣布结束，并把话头引向恢复（散步/拉伸），**不引向加量**。
- 达标后 `.pg.settled` 会隐藏进度条 —— 满格的进度条会暗示「可以刷满」，对新手机械是负向暗示。
- 进度条用 `role="progressbar"` + `aria-valuetext="本周已练 1 次，你自己定的目标是每周 3 次"`，
  读屏器**不会念出百分比**。大数字 `34px` 那一块标了 `aria-hidden="true"`，避免重复念。

### 6.1 三处「本周」口径不一致（本次发现，未改）

| 位置 | 口径 |
|---|---|
| `Progress.compute` | 自然周 周一–周日（本模块） |
| `Log.stats().thisWeek`（`log.js:166`） | 滚动 7 天 |
| `Log.attendance()`（`log.js:172`） | 按 `createdAt` 推的自然周数 × `freq.days` |

`Progress` 选周一–周日，因为 `Goal.buildSchedule()` 的 `dow` 就是 0=周一，
和计划页的「本周安排」时间轴对得上；`Log.stats().thisWeek` 的滚动 7 天在周日会
比计划页多算一天。**反馈页「训练记录」卡上的「近 7 天 N 次」和计划页的
「本周 N 次」在周日会出现 1 的差**，不是 bug 但会让人以为记错了。
要统一的话建议改 `log.js`，不在本任务写范围内。

---

## 7. 验证记录

```
node --check app/ux.js          → 通过
node --check app/onboarding.js  → 通过
node --check app/progress.js    → 通过
```

`Progress.compute()` 用构造数据跑过 5 条分支，禁用词扫描 0 命中（见 6）。
对比度全部由 `UX.contrast()` 实算，数字见 4.1，脚本跑在 `node` 上，
输入是 `app.css` 里 `:root` 的原始色值，没有目测成分。

浏览器端的 DOM 相关检查（`UX.audit()` 实际扫描结果、`UX.enhance()` 的属性补全、
`MutationObserver` 的自愈）**尚未在真机上跑过** —— 这一部分需要打开页面执行
控制台命令 `UX.auditSummary()` 才能确认，上面的 4.2 / 4.3 表格是按 CSS 与
`index.html` 源码推出来的，不是运行时实测。触控目标一列尤其要用真机验证：
`getBoundingClientRect()` 在不同 DPR 和字体下会有 ±2px 差异。
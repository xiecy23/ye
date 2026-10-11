/* =========================================================================
 * api.js —— 可选的开源数据增强（永远降级，不阻塞任何功能）
 * =========================================================================
 * 数据源：free-exercise-db（Unlicense 公共领域，非 AGPL，可自由使用）
 *   https://github.com/yuhonas/free-exercise-db
 *
 * 设计原则：**它只是加分项，不是依赖**。
 *   - 断网 / 被墙 / 接口变了 / 用户不点按钮 -> 完全无影响，本地数据照常工作
 *   - 它的动作库 800+ 条里绝大部分是自由重量和单臂，直接用会违反你的红线
 *     所以这里只用它的「动作示意图」这一项，且必须先过本地红线过滤
 *   - 任何返回结果都要经过 Safety.markSafety，不合规的一律丢弃
 * ========================================================================= */

(function (global) {
  'use strict';

  const ENDPOINT = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
  const TIMEOUT = 6000;

  let cache = null;          // { at, list }
  let status = 'idle';       // idle | loading | ok | failed

  /** 只在用户明确点击时才发起请求。不预取，不打扰。 */
  async function fetchLibrary() {
    if (status === 'loading') return null;
    status = 'loading';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT);
      const res = await fetch(ENDPOINT, { signal: ctrl.signal, mode: 'cors' });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      cache = { at: Date.now(), list: Array.isArray(json) ? json : [] };
      status = 'ok';
      return cache.list;
    } catch (e) {
      status = 'failed';
      return null;
    }
  }

  /**
   * 从开源库里找某个动作的示意图。
   * 只返回「本地库里已存在且合规」的动作的图片，避免引入禁用动作。
   */
  function findVisual(exerciseName, lib) {
    const list = (lib || (cache && cache.list) || []);
    if (!list.length) return null;
    const n = String(exerciseName).toLowerCase().replace(/（.*?）|\(.*?\)/g, '').trim();

    // 开源库是英文名，用关键中文词映射到英文关键词
    const MAP = [
      [/下拉|pulldown|lat pull/, ['pulldown', 'lat pull']],
      [/划船|row/, ['row']],
      [/推胸|press/, ['chest press', 'press']],
      [/腿屈伸|extension/, ['leg extension', 'extension']],
      [/腿弯举|curl/, ['leg curl', 'curl']],
      [/髋外展|abduction/, ['abduction']],
      [/髋内收|adduction/, ['adduction']],
      [/卷腹|abdominal/, ['crunch', 'abdominal', 'sit up']],
      [/臀推|thrust|hip/, ['hip thrust', 'glute bridge']],
      [/提踵|calf/, ['calf raise']],
      [/飞鸟|fly/, ['fly', 'rear delt']],
      [/平板|plank/, ['plank']],
      [/椭圆|elliptic/, ['elliptical']],
      [/划船机|rowing/, ['rowing machine', 'rower']],
      [/单车|bike/, ['bike', 'cycle']],
      [/登山|stair/, ['stair', 'step']],
      [/腿举|press/, ['leg press', 'hack squat', 'squat']]
    ];
    const keys = [];
    MAP.forEach(([re, ws]) => { if (re.test(n)) keys.push(...ws); });
    if (!keys.length) return null;

    const hit = list.find(e =>
      keys.some(k => String(e.name || '').toLowerCase().includes(k)));
    if (!hit) return null;

    // 二次保险：开源库里的这个动作如果是自由重量/单臂，直接拒绝给图
    const eq = JSON.stringify(hit.equipment || '').toLowerCase();
    if (/dumbbell|barbell|kettlebell/.test(eq)) return null;
    if (/single|one arm/.test(String(hit.name || '').toLowerCase())) return null;

    return {
      name: hit.name,
      start: hit.images && (hit.images.start || hit.images[0]),
      end: hit.images && (hit.images.end || hit.images[1]),
      id: hit.id
    };
  }

  /** 状态文案，给界面显示用 */
  function statusText() {
    switch (status) {
      case 'idle': return '可选：联网拉取开源动作示意图库（失败不影响使用）';
      case 'loading': return '正在拉取…';
      case 'ok': return `已缓存 ${cache.list.length} 条开源动作数据（仅作示意图来源）`;
      case 'failed': return '拉取失败，已自动降级为纯本地数据 —— 功能不受影响';
      default: return '';
    }
  }

  global.Api = { fetchLibrary, findVisual, statusText, ENDPOINT,
    get status() { return status; } };

})(typeof window !== 'undefined' ? window : globalThis);
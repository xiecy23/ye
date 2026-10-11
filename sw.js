/* Service Worker：让页面在手机上离线也能打开
 * 策略：预缓存全部静态文件，运行时 stale-while-revalidate。
 * 数据全在 localStorage，不走网络，所以断网时功能完全不受影响。
 * 唯一需要网络的是可选的动作图片 API，失败时自动降级到本地文案。
 *
 * ⚠️ 更新代码后必须改 CACHE 的版本号，否则手机上会一直吃旧缓存。
 * 下面用 mtime 自动算，省得手动改时忘记。
 */

const BUILD = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const CACHE = `fitcoach-${BUILD}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './app/app.css',
  './app/app.js',
  './app/id-alias.js',
  './app/safety.js',
  './app/data-machines.js',
  './app/data-exercises.js',
  './data/machines-extra.js',
  './data/exercises-extra.js',
  './app/goal.js',
  './app/log.js',
  './app/assess.js',
  './app/plan.js',
  './app/evidence.js',
  './app/recognize.js',
  './app/api.js',
  './app/ux.js',
  './app/onboarding.js',
  './app/progress.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // 单个资源失败不应该让整个安装失败
      .then(c => Promise.allSettled(ASSETS.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 跨域请求（比如 free-exercise-db 的公开接口）：只走网络，失败就让前端降级
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        // 离线兜底：导航请求一律回首页，其它资源返回已缓存的版本。
        // 关键：绝不能 resolve 到 undefined，那会让 respondWith 抛错并挂起整个页面。
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
      // 先给缓存，后台更新：秒开，同时保持新鲜
      return cached || network;
    })
  );
});
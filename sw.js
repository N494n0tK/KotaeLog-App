// 初回のインストールでオフライン起動に必要な一式を保存する。
const scope = self.registration.scope;
const prefix = `kotaelog:${scope}:`;
const cacheName = prefix + "23";
const shell = [
  "index.html", "css/style.css?v=22", "js/data.js?v=3", "js/app.js?v=23",
  "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
].map(path => new URL(path, scope).href);
const index = shell[0];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(shell.map(url => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const path = url.origin + url.pathname;
  const key = request.mode === "navigate" && (path === scope || path === index) ? index : url.href;
  if (!shell.includes(key)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: "no-cache" });
      // 更新途中で通信が切れても、オフライン用の HTML と JS は同じ版で揃える。
      if (response.status >= 500) {
        return (await caches.match(key, { cacheName })) || response;
      }
      return response;
    } catch {
      return (await caches.match(key, { cacheName })) || Response.error();
    }
  })());
});

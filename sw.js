// ネットワーク優先・失敗時のみキャッシュ（単語データを追加したらすぐ反映されるように）
const CACHE = "kotaelog-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // 問題データ（GitHub API）は js/data.js が端末に保存するので、ここでは扱わない
  if (new URL(e.request.url).hostname === "api.github.com") return;
  // ブラウザの HTTP キャッシュも通さず、毎回サーバーに更新を確認する
  const req = e.request.mode === "navigate"
    ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(e.request, { cache: "no-cache" });
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (res.type === "basic" || res.type === "cors")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

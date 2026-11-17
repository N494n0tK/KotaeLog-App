/* ============================================================
   コタエログ (KotaeLog) — 問題データの読み込み
   ------------------------------------------------------------
   問題は非公開リポジトリ KotaeLog-Que にあり、GitHub API で読む。
   読むには KotaeLog-Que だけを読める読み取り専用トークンが要る。
   トークンは設定画面から端末ごとに入力し、その端末の中にだけ保存する。

   取得した問題は端末に保存しておき、次からはまずそれで起動する
   （オフラインでも使える）。起動後に裏で最新を取りに行き、変わっていたら反映する。
   ============================================================ */
(() => {
  "use strict";

  const REPO = "N494n0tK/KotaeLog-Que";
  const DATA_KEY = "kotaelog.data.v1";
  const TOKEN_KEY = "kotaelog.token";

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) {} },
  };

  let data = null;
  try { data = JSON.parse(ls.get(DATA_KEY)); } catch (_) {}
  if (!data || !Array.isArray(data.subjects)) data = null;

  // いまは最初の教科を使う（教科の切り替えは別途）
  const subject = data && data.subjects[0];
  window.WORDS = subject ? subject.items : [];

  const fail = (status, message) => Object.assign(new Error(message), { status });

  async function getFile(path, token) {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      });
    } catch (_) {
      throw fail(0, "通信できませんでした。電波の届くところでもう一度試してください。");
    }
    if (res.status === 401) throw fail(401, "トークンが正しくないか、期限が切れています。");
    if (res.status === 403) throw fail(403, "アクセスが拒否されました。少し時間をおいて試すか、トークンの権限を確認してください。");
    if (res.status === 404) throw fail(404, `トークンに ${REPO} を読む権限がないか、${path} がありません。`);
    if (!res.ok) throw fail(res.status, `読み込みに失敗しました（${res.status}）。`);
    try {
      return await res.json();
    } catch (_) {
      throw fail(-1, `${path} の書式が正しくありません（JSON として読めません）。`);
    }
  }

  async function fetchAll(token) {
    const index = await getFile("index.json", token);
    const list = Array.isArray(index && index.subjects) ? index.subjects : [];
    const subjects = await Promise.all(list.map(async (s) => {
      const f = await getFile(s.file, token);
      return { id: String(s.id), name: String(s.name || (f && f.name) || s.id), items: Array.isArray(f && f.items) ? f.items : [] };
    }));
    return { subjects, fetchedAt: Date.now() };
  }

  window.KOTAE_DATA = {
    repo: REPO,
    hasToken: () => !!ls.get(TOKEN_KEY),
    hasData: () => !!data,
    fetchedAt: () => (data ? data.fetchedAt : null),
    subjects: () => (data ? data.subjects : []),
    setToken: (token) => ls.set(TOKEN_KEY, token),
    clearToken: () => ls.del(TOKEN_KEY),
    // 最新の問題を取得して保存する。前回と中身が変わっていれば true
    async refresh(token = ls.get(TOKEN_KEY)) {
      if (!token) throw fail(0, "トークンが設定されていません。");
      const next = await fetchAll(token);
      const changed = !data || JSON.stringify(data.subjects) !== JSON.stringify(next.subjects);
      data = next;
      if (!ls.set(DATA_KEY, JSON.stringify(next))) throw fail(-1, "端末に保存できませんでした（プライベートブラウズでは保存できません）。");
      return changed;
    },
  };
})();

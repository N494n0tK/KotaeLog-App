/* ============================================================
   コタエログ (KotaeLog) — app
   ============================================================ */
(() => {
  "use strict";

  // ---------- データ（js/data.js が KotaeLog-Que から読み込んだもの） ----------
  const DATA = window.KOTAE_DATA;

  // 見出し語の文字数（.fit が1行に収まる文字サイズを計算するのに使う）
  const fitLen = (w) => `--len:${[...w.word].length}`;
  const noLabel = (w) => (w.no === null ? "" : `No.${w.no}`);

  // 1教科分の問題を整える（重複を除き、整理番号順に並べる）
  function normalize(items, subjectName) {
    const seen = new Set();
    const seenNo = new Set();
    const list = (Array.isArray(items) ? items : [])
      .filter((w) => w && w.word && w.meaning && !seen.has(w.word) && seen.add(w.word))
      .map((w) => ({
        no: w.no === undefined || w.no === null || w.no === "" ? null : w.no,
        word: String(w.word),
        reading: w.reading ? String(w.reading) : "",
        meaning: String(w.meaning),
        example: w.example ? String(w.example) : "",
        category: w.category ? String(w.category) : "その他",
        // どのテスト（定期考査）の問題か。書いていない問題は ""（テスト未設定）
        test: typeof w.test === "string" ? w.test.trim() : "",
        synonyms: Array.isArray(w.synonyms) ? w.synonyms : [],
        antonyms: Array.isArray(w.antonyms) ? w.antonyms : [],
      }));
    list.forEach((w) => {
      if (w.no === null) return;
      if (seenNo.has(String(w.no))) console.warn(`[${subjectName}] 整理番号 ${w.no} が重複しています（${w.word}）`);
      seenNo.add(String(w.no));
    });
    // 整理番号順に並べる（番号のない語は末尾、書いた順のまま）
    return list
      .map((w, i) => [w, i])
      .sort(([a, i], [b, j]) => {
        if (a.no === null || b.no === null) return a.no === null && b.no === null ? i - j : a.no === null ? 1 : -1;
        return String(a.no).localeCompare(String(b.no), "ja", { numeric: true }) || i - j;
      })
      .map(([w]) => w);
  }

  // 教科の色 [メイン, 相方]。index.json に color が無い教科はこの順に割り当てる
  const FALLBACK_COLORS = [
    ["#6250d6", "#b14cff"], ["#2a78d6", "#22b8e6"], ["#0e9688", "#5cc86e"],
    ["#d95926", "#f2a21b"], ["#9a7a00", "#d4a72c"], ["#c8467a", "#f07a8a"],
  ];
  const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c);
  // 教科の一覧（新しい問題を取得したら作り直す）
  // テストの並び：名前に数字があれば数字の順（第2回 → 第3回）、無ければ問題に出てきた順。最後がいちばん新しいテスト
  const testNo = (t) => {
    const m = /\d+/.exec(t.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)));
    return m ? Number(m[0]) : null;
  };
  const sortTests = (names) => names
    .map((t, i) => [t, i])
    .sort(([a, i], [b, j]) => {
      if (!a || !b) return a === b ? 0 : a ? 1 : -1; // テスト未設定は先頭（古い側）
      const x = testNo(a), y = testNo(b);
      return (x !== null && y !== null ? x - y : 0) || i - j;
    })
    .map(([t]) => t);

  let SUBJECTS = [];
  function loadSubjects() {
    SUBJECTS = DATA.subjects().filter(s => s?.id != null).map((s, i) => {
      const all = normalize(s.items, s.name);
      return {
        id: String(s.id),
        name: String(s.name || s.id),
        color: Array.isArray(s.color) && s.color.length === 2 && s.color.every(isHex) ? s.color : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        all, // 全テストの問題
        tests: sortTests([...new Set(all.map((w) => w.test))]),
        test: "", // 学習するテスト（applyTests で決める）
        words: all, // 学習するテストの問題
      };
    });
  }
  loadSubjects();
  const subjectById = (id) => SUBJECTS.find((s) => s.id === id) || null;
  const subjStyle = (s) => `--c1:${s.color[0]};--c2:${s.color[1]}`;
  const subjInitial = (s) => [...s.name][0] || "?";

  // いま選んでいる教科（切り替えるとまとめて差し替わる）
  let SUBJ = null;
  let SID = "";
  let WORDS = [];
  let CATEGORIES = [];
  let BY_WORD = new Map();

  // ---------- 保存 ----------
  // 学習の進み具合は教科ごと（progress[教科ID][見出し語]）。解答の履歴は log に全教科まとめて持つ
  const STORE_KEY = "kotaelog.store.v1";
  const OLD_KEY = "gendaibun-words.v1"; // 現代文単語アプリ時代の保存キー（現代国語として引き継ぐ）
  const MAX_LOG = 8000;
  const NEW = 0, LEARNING = 1, MASTERED = 2;
  const STATUS_LABEL = ["未学習", "学習中", "覚えた"];
  const STATUS_CLASS = ["c-new", "c-learning", "c-mastered"];

  let store = { progress: {}, log: [], settings: { quizCount: 10, quizMode: "mix", cardMode: "w2m", cardFilter: "all", cardShuffle: true, subject: "", units: {} } };
  try {
    let saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved) {
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old && typeof old === "object") saved = { progress: { gendaibun: old.progress || {} }, settings: old.settings || {} };
    }
    if (saved && typeof saved === "object") {
      store.progress = saved.progress && typeof saved.progress === "object" ? saved.progress : {};
      store.log = Array.isArray(saved.log) ? saved.log : [];
      store.settings = Object.assign(store.settings, saved.settings || {});
    }
  } catch (_) { /* 保存領域が使えない環境ではメモリのみ */ }

  let reportedSaveFailure = false;
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (_) {
      // 短縮した履歴を書き込めた場合だけ、メモリ内の履歴も短くする。
      if (store.log.length > 500) {
        const log = store.log.slice(-Math.floor(store.log.length / 2));
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify({ ...store, log }));
          store.log = log;
          return true;
        } catch (_) { /* メモリ内の記録で続ける */ }
      }
      if (!reportedSaveFailure) toast("端末に保存できません。今回の変更は画面を閉じると失われます");
      reportedSaveFailure = true;
      return false;
    }
    reportedSaveFailure = false;
    return true;
  };
  const progMap = (sid = SID) => store.progress[sid] || (store.progress[sid] = {});
  const progIn = (sid, word) => progMap(sid)[word] || { s: NEW, ok: 0, ng: 0, streak: 0, star: false };
  const prog = (word) => progIn(SID, word);
  const setProg = (word, patch) => {
    progMap()[word] = Object.assign({}, prog(word), patch, { t: Date.now() });
    save();
  };
  const statusOf = (word) => prog(word).s || NEW;
  const isWeak = (word) => {
    const p = prog(word);
    return p.star || (p.ng > 0 && p.s !== MASTERED);
  };
  const masteredIn = (s) => s.words.filter((w) => (progIn(s.id, w.word).s || NEW) === MASTERED).length;

  // 解答を1件記録する（カード = c / クイズ = q）。直近10回の結果は語ごとにも持っておく
  function logAnswer(word, ok, mode, patch) {
    const h = ((prog(word).h || "") + (ok ? "1" : "0")).slice(-10);
    const entry = { t: Date.now(), s: SID, w: word, ok: ok ? 1 : 0, m: mode };
    store.log.push(entry);
    if (store.log.length > MAX_LOG) store.log.splice(0, store.log.length - MAX_LOG);
    setProg(word, Object.assign({ h }, patch));
    return entry;
  }

  // ---------- 記録の集計 ----------
  const dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  const logOf = (sid) => (sid ? store.log.filter((e) => e.s === sid) : store.log);
  const rate = (ok, n) => (n ? Math.round((ok / n) * 100) : 0);

  // 解答数・正答率・今日の分・連続学習日数（sid を省くと全教科）
  function summary(sid) {
    const today = dayKey(Date.now());
    const days = new Set();
    let n = 0, ok = 0, tn = 0, tok = 0;
    for (const e of logOf(sid)) {
      n++;
      ok += e.ok;
      const k = dayKey(e.t);
      days.add(k);
      if (k === today) { tn++; tok += e.ok; }
    }
    // 今日まだ解いていなければ、昨日から数える
    let streak = 0;
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    return { n, ok, tn, tok, streak };
  }

  // 直近 count 日の、日ごとの解答数と正解数
  function daily(sid, count = 14) {
    const map = new Map();
    for (const e of logOf(sid)) {
      const k = dayKey(e.t);
      const v = map.get(k) || { n: 0, ok: 0 };
      v.n++;
      v.ok += e.ok;
      map.set(k, v);
    }
    const out = [];
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (count - 1));
    for (let i = 0; i < count; i++) {
      const v = map.get(dayKey(d)) || { n: 0, ok: 0 };
      out.push({ m: d.getMonth() + 1, day: d.getDate(), n: v.n, ok: v.ok, today: i === count - 1 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  // 「3分前」「昨日 14:20」のような表示
  function relTime(t) {
    const diff = Date.now() - t;
    if (diff < 60e3) return "たった今";
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)}分前`;
    const d = new Date(t);
    const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (dayKey(t) === dayKey(Date.now())) return `今日 ${hm}`;
    if (dayKey(t) === dayKey(Date.now() - 864e5)) return `昨日 ${hm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  // ---------- テストの選択 ----------
  // 教科ごとに学習するテストを選ぶ（settings.tests[教科ID]）。選んでいなければ、問題がある中でいちばん新しいテスト
  const ALL_TESTS = "*";
  const hasTests = (s) => s.tests.some(Boolean);
  const latestTest = (s) => s.tests.at(-1) ?? "";
  function testOf(s) {
    const t = store.settings.tests?.[s.id];
    return t === ALL_TESTS || (typeof t === "string" && s.tests.includes(t)) ? t : latestTest(s);
  }
  function applyTests() {
    SUBJECTS.forEach((s) => {
      s.test = testOf(s);
      s.words = s.test === ALL_TESTS || s.tests.length < 2 ? s.all : s.all.filter((w) => w.test === s.test);
    });
  }
  const testName = (t) => (t === ALL_TESTS ? "すべてのテスト" : t || "テスト未設定");
  // 画面に出すテスト名（テストを書いていない教科では出さない）
  const testLabel = (s) => (s && hasTests(s) ? testName(s.test) : "");
  function setTest(sid, t) {
    const s = subjectById(sid);
    if (!s) return;
    const tests = Object.assign({}, store.settings.tests);
    // いちばん新しいテストを選んだときは「おまかせ」に戻す（新しいテストの問題が増えたら自動で移る）
    if (t === latestTest(s)) delete tests[sid];
    else tests[sid] = t;
    store.settings.tests = tests;
    save();
    applyTests();
    if (sid === SID) {
      useSubject(SID);
      deck = null;
      quiz = null;
      cardOpts.stage = "setup";
      listOpts.cat = "all";
    }
    renderChrome();
  }

  // ---------- 教科の選択 ----------
  function useSubject(id) {
    SUBJ = subjectById(id) || SUBJECTS.find((s) => s.words.length) || SUBJECTS[0] || null;
    SID = SUBJ ? SUBJ.id : "";
    WORDS = SUBJ ? SUBJ.words : [];
    CATEGORIES = [...new Set(WORDS.map((w) => w.category))];
    BY_WORD = new Map(WORDS.map((w) => [w.word, w]));
    // 教科の色をアプリ全体のアクセントにする（CSS 側でなめらかに移り変わる）
    if (SUBJ) {
      const root = document.documentElement.style;
      root.setProperty("--accent", SUBJ.color[0]);
      root.setProperty("--accent-2", SUBJ.color[1]);
    }
  }
  applyTests();
  useSubject(store.settings.subject);

  // ---------- ユーティリティ ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const counts = (list = WORDS) => {
    const c = [0, 0, 0];
    list.forEach((w) => c[statusOf(w.word)]++);
    return c;
  };

  const view = $("#view");
  const scroller = $("#scroller"); // 中身をスクロールする箱（ページ全体はスクロールしない）
  const titleEl = $("#viewTitle");
  const badgeEl = $("#topBadge");

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), Math.max(2200, Math.min(6000, msg.length * 110)));
  }

  // ---------- ガラスに触れたときの質感 ----------
  // 押す：指の位置に光が集まり、縁が光り、少し沈んで指の方へ引っぱられる
  // 離す：ぷるんと揺れて戻り、指の位置から波紋が広がる（＋対応端末では軽い触覚フィードバック）
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let pressed = null;

  // iOS 18 以降の Safari は、スイッチ型チェックボックスを切り替えると触覚フィードバックが出る
  const haptic = (() => {
    let label = null;
    return () => {
      if (navigator.vibrate) { navigator.vibrate(6); return; }
      try {
        if (!label) {
          const wrap = document.createElement("div");
          wrap.setAttribute("aria-hidden", "true");
          wrap.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;clip-path:inset(50%)";
          wrap.innerHTML = `<input type="checkbox" switch id="hapticSwitch" tabindex="-1"><label for="hapticSwitch"></label>`;
          document.body.appendChild(wrap);
          label = wrap.querySelector("label");
        }
        label.click();
      } catch (_) {}
    };
  })();

  const setLight = (el, x, y) => {
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
  };

  function ripple(el, x, y, size) {
    const d = Math.max(size.width, size.height) * 2.2;
    const r = document.createElement("span");
    r.className = "ripple";
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    el.appendChild(r);
    r.animate(
      [{ transform: "scale(1)", opacity: 1 }, { transform: `scale(${d / 10})`, opacity: 0 }],
      { duration: 650, easing: "cubic-bezier(.2,.7,.3,1)" }
    ).onfinish = () => r.remove();
  }

  // 離したときの揺れ。大きい要素ほど控えめにする
  function jelly(el, k) {
    el.animate(
      [
        { scale: `${1 - 0.04 * k}` },
        { scale: `${1 + 0.035 * k} ${1 - 0.025 * k}`, offset: 0.3 },
        { scale: `${1 - 0.012 * k} ${1 + 0.014 * k}`, offset: 0.58 },
        { scale: `${1 + 0.004 * k} ${1 - 0.004 * k}`, offset: 0.8 },
        { scale: "1" },
      ],
      { duration: 560, easing: "ease-out" }
    );
  }

  function release(tap) {
    if (!pressed) return;
    const { el, k, lx, ly, r } = pressed;
    pressed = null;
    el.classList.remove("is-pressed");
    el.style.setProperty("--pull-x", "0px");
    el.style.setProperty("--pull-y", "0px");
    if (!tap || !el.isConnected) return;
    haptic();
    if (motionPreference.matches) return;
    // カード本体はめくる動きがあるので、揺れと波紋はボタン類だけ
    if (!el.matches(".face")) {
      jelly(el, k);
      ripple(el, lx, ly, r);
    }
  }

  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".press");
    if (!e.isPrimary || !el || el.disabled || e.button !== 0) return;
    release(false);
    const r = el.getBoundingClientRect();
    const lx = e.clientX - r.left;
    const ly = e.clientY - r.top;
    // 小さいボタンはしっかり、大きいカードはわずかに沈む
    const k = Math.max(0.3, Math.min(1, 140 / Math.max(r.width, r.height)));
    el.style.setProperty("--press-scale", String(1 - 0.045 * k));
    setLight(el, lx, ly);
    el.classList.add("is-pressed");
    pressed = { el, id: e.pointerId, x0: e.clientX, y0: e.clientY, k, lx, ly, r };
  }, { passive: true });

  document.addEventListener("pointermove", (e) => {
    if (!pressed || e.pointerId !== pressed.id) return;
    const { el, r, x0, y0, k } = pressed;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    // 指を大きく動かしたら（スクロールなど）押下をやめる
    if (Math.hypot(dx, dy) > 14) return release(false);
    pressed.lx = e.clientX - r.left;
    pressed.ly = e.clientY - r.top;
    setLight(el, pressed.lx, pressed.ly);
    // 指の方へ液体のように少しだけ引っぱられる
    el.style.setProperty("--pull-x", `${(dx * 0.35 * k).toFixed(2)}px`);
    el.style.setProperty("--pull-y", `${(dy * 0.35 * k).toFixed(2)}px`);
  }, { passive: true });

  document.addEventListener("pointerup", (e) => { if (pressed && e.pointerId === pressed.id) release(true); }, { passive: true });
  document.addEventListener("pointercancel", e => { if (pressed?.id === e.pointerId) release(false); }, { passive: true });
  window.addEventListener("blur", () => release(false));

  // ---------- アイコン（線の太さ・角の丸みを揃えた自前のセット） ----------
  const ICON = {
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    cards: '<rect x="3.5" y="7" width="13" height="13.5" rx="2.5"/><path d="M8 4h9.5A2.5 2.5 0 0 1 20 6.5V16"/>',
    quiz: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.4v.6"/><path d="M12 16.6h.01"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.5 4.25L17 13H5.5"/>',
    chart: '<path d="M3.5 20.5h17"/><path d="M7 16.5v-5M12 16.5v-10M17 16.5v-7"/>',
    sliders: '<path d="M4 7.5h9M18 7.5h2M4 16.5h3M12 16.5h8"/><circle cx="15.5" cy="7.5" r="2.5"/><circle cx="9.5" cy="16.5" r="2.5"/>',
    star: '<path d="m12 3.6 2.55 5.2 5.7.83-4.13 4.02.98 5.68L12 16.65l-5.1 2.68.98-5.68-4.13-4.02 5.7-.83z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    swap: '<path d="M4.5 8h14l-3.5-3.5"/><path d="M19.5 16h-14L9 19.5"/>',
    shuffle: '<path d="M3.5 7.5h3c2 0 3.1.9 4.1 2.6l2.8 4.8c1 1.7 2.1 2.6 4.1 2.6h3"/><path d="M3.5 16.5h3c1.1 0 2-.3 2.7-.9M14.4 8.4c.7-.6 1.6-.9 2.6-.9h3.5"/><path d="m18 4.5 2.5 3-2.5 3M18 14.5l2.5 3-2.5 3"/>',
    trophy: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.6 4M16 6.5h2.5a2.5 2.5 0 0 1-2.6 4"/><path d="M12 13.5v3.5M8.5 20h7M10 17h4l.5 3h-5z"/>',
    sparkle: '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/><path d="M18.5 16.5c.25 1.5 1 2.25 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.25 2.25-1 2.5-2.5z"/>',
    book: '<path d="M5 5a1.5 1.5 0 0 1 1.5-1.5H19v14H6.5A1.5 1.5 0 0 0 5 19z"/><path d="M5 19a1.5 1.5 0 0 0 1.5 1.5H19"/><path d="M9 7.5h6"/>',
    key: '<circle cx="8" cy="15.5" r="4"/><path d="m11 12.5 8.5-8.5M16.5 7l2.5 2.5M14 9.5l2 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    flame: '<path d="M12 21c3.9 0 6.5-2.6 6.5-6.3 0-3-1.8-5.3-3.8-7-.3 1.8-1.2 3.1-2.6 3.8C12.4 8 10.9 5.3 8.5 3.3 8.6 6.6 5.5 8.9 5.5 14.4 5.5 18.4 8.1 21 12 21z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6"/>',
    layers: '<path d="m12 3.5 8.5 4.75L12 13 3.5 8.25z"/><path d="m3.5 12.25 8.5 4.75 8.5-4.75"/><path d="m3.5 16.25 8.5 4.75 8.5-4.75"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    chevR: '<path d="m9.5 6 6 6-6 6"/>',
    chevD: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    checkc: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.5 2.5 4.8-5.1"/>',
    undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  };
  const icon = (name, cls = "") =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;

  // ---------- 演出 ----------
  // 数字のカウントアップ（data-count="数値"。data-from があればその数から数える）
  function countUp(root = view) {
    $$("[data-count]", root).forEach((el) => {
      if (el.dataset.counted) return;
      el.dataset.counted = "1";
      const to = Number(el.dataset.count) || 0;
      const from = el.dataset.from === undefined ? to : Number(el.dataset.from) || 0;
      if (motionPreference.matches || to === from) { el.textContent = String(to); return; }
      const t0 = performance.now();
      const dur = 420;
      el.textContent = String(from);
      const tick = (now) => {
        if (!el.isConnected) return;
        const k = motionPreference.matches ? 1 : Math.min(1, (now - t0) / dur);
        el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  // 描き直す前の数字を data-k ごとに覚えておき、描き直したあとの数字の data-from に入れる
  const readCounts = (root) => Object.fromEntries($$("[data-k]", root).map((el) => [el.dataset.k, el.textContent]));
  const applyFrom = (root, prev) => $$("[data-k]", root).forEach((el) => { if (prev[el.dataset.k] !== undefined) el.dataset.from = prev[el.dataset.k]; });

  // .stagger の子を少しずつ遅らせて出す
  function stagger(root = view, base = 20, step = 24) {
    $$(".stagger", root).forEach((box) => [...box.children].forEach((c, i) => c.style.setProperty("--d", `${base + Math.min(i, 4) * step}ms`)));
  }

  // 正解したときに弾ける光の粒
  function burst(el, n = 14) {
    if (motionPreference.matches || !el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const colors = [SUBJ ? SUBJ.color[0] : "#6250d6", SUBJ ? SUBJ.color[1] : "#b14cff", "#3ee0ad", "#ffd54a"];
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      const size = 5 + Math.random() * 6;
      p.className = "spark";
      p.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;background:${colors[i % colors.length]};border-radius:${i % 3 ? "50%" : "2px"}`;
      document.body.appendChild(p);
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const d = 46 + Math.random() * 70;
      p.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${(Math.cos(a) * d).toFixed(1)}px), calc(-50% + ${(Math.sin(a) * d - 18).toFixed(1)}px)) rotate(${Math.round(Math.random() * 300)}deg) scale(0.2)`, opacity: 0 },
        ],
        { duration: 650 + Math.random() * 350, easing: "cubic-bezier(.15,.7,.3,1)" }
      ).onfinish = () => p.remove();
    }
  }

  // 教科を切り替えたとき、押した場所から新しい教科の色が広がる
  function themeWave(x, y) {
    if (motionPreference.matches || !SUBJ) return;
    $(".theme-wave")?.remove();
    const w = document.createElement("div");
    w.className = "theme-wave";
    w.style.setProperty("--w1", SUBJ.color[0]);
    w.style.setProperty("--w2", SUBJ.color[1]);
    w.style.setProperty("--x", `${x}px`);
    w.style.setProperty("--y", `${y}px`);
    document.body.appendChild(w);
    const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 40;
    w.animate(
      [
        { clipPath: `circle(0px at ${x}px ${y}px)`, opacity: 0.5 },
        { clipPath: `circle(${R}px at ${x}px ${y}px)`, opacity: 0.28, offset: 0.55 },
        { clipPath: `circle(${R}px at ${x}px ${y}px)`, opacity: 0 },
      ],
      { duration: 950, easing: "cubic-bezier(.3,.7,.2,1)" }
    ).onfinish = () => w.remove();
  }

  // ---------- ルーティング（履歴は使わない＝戻る操作でアプリを離れない） ----------
  let current = "home";
  const NAV = [
    ["home", "ホーム", "home"],
    ["cards", "暗記カード", "cards"],
    ["quiz", "4択クイズ", "quiz"],
    ["list", "一覧", "list"],
    ["weak", "苦手", "flag"],
    ["records", "記録", "chart"],
    ["settings", "設定", "sliders"],
  ];
  const TITLES = Object.fromEntries(NAV.map(([k, t]) => [k, t]));
  // 問題が無い教科でも開ける画面
  const OPEN_WHEN_EMPTY = ["home", "records", "settings"];

  function setTitle(text) {
    if (titleEl.textContent === text) return;
    titleEl.textContent = text;
    if (!motionPreference.matches) titleEl.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.22,.8,.24,1)" });
  }

  function go(name, params = {}) {
    if (pendingData && name === "home") applyNewData();
    if (!VIEWS[name]) name = "home";
    if (!WORDS.length && !OPEN_WHEN_EMPTY.includes(name)) name = "home";
    if (name !== "cards" || !params.setup) dropEmptyUnitSel();
    current = name;
    view.dataset.page = name;
    closeSheet();
    closeSubjMenu();
    setTitle(TITLES[name] || "");
    badgeEl.textContent = "";
    $$("#drawerNav button").forEach((b) => b.classList.toggle("on", b.dataset.nav === name));
    release(false);
    enterAnim();
    scroller.scrollTop = 0;
    VIEWS[name](params);
    stagger();
    countUp();
    updateDrawerSub();
  }
  // 同じ画面を描き直す（絞り込みの切り替えなど）
  function rerender() {
    VIEWS[current]();
    stagger();
    countUp();
  }

  // 画面を出すときの「ふわっと出る」演出。終わったら外す
  // （付けたままだと、あとから差し込んだ要素＝裏で用意した次のカードなどにも演出がかかってしまう）
  let enterTimer;
  function enterAnim() {
    clearTimeout(enterTimer);
    view.classList.toggle("enter", !motionPreference.matches);
    if (!motionPreference.matches) enterTimer = setTimeout(() => view.classList.remove("enter"), 460);
  }

  function updateDrawerSub() {
    const c = counts();
    $("#drawerSub").textContent = SUBJ ? `${SUBJ.name} ・ ${WORDS.length}語中 ${c[MASTERED]}語 習得` : "問題を読み込んでください";
  }

  // 教科の選択肢（右上のプルダウン・サイドバーのプルダウンで共通）
  const subjOpt = (s) => {
    const on = s.id === SID;
    const m = masteredIn(s);
    return `<button class="subj-opt press ${on ? "on" : ""}" data-subject="${esc(s.id)}" role="menuitemradio" aria-checked="${on}" style="${subjStyle(s)}">
      <span class="subj-ini sm">${esc(subjInitial(s))}</span>
      <span class="grow"><b>${esc(s.name)}</b><small>${s.words.length ? `${s.words.length}語 ・ 習得 ${rate(m, s.words.length)}%` : "準備中"}</small></span>
      <span class="subj-tick">${icon("check")}</span>
    </button>`;
  };

  // トップバーの教科ボタン・サイドバーの教科プルダウンを今の教科に合わせる
  function renderChrome() {
    const pill = $("#subjPill");
    pill.hidden = !SUBJ;
    if (SUBJ) {
      $("#subjName").textContent = SUBJ.name;
      $("#drawerSubjName").textContent = SUBJ.name;
      $("#drawerSubjIni").textContent = subjInitial(SUBJ);
      $("#drawerSubjBtn").setAttribute("style", subjStyle(SUBJ));
    }
    $("#drawerSubjWrap").hidden = !SUBJECTS.length;
    $("#drawerSubjects").innerHTML = SUBJECTS.map(subjOpt).join("");
    $("#subjMenu").innerHTML = `<div class="menu-title">教科</div>${SUBJECTS.map(subjOpt).join("")}`;
    updateDrawerSub();
  }

  // 右上の教科プルダウン
  const subjMenuOpen = () => document.body.classList.contains("menu-open");
  function openSubjMenu() {
    renderChrome();
    document.body.classList.add("menu-open");
    syncOverlayAccess();
    $("#subjPill").setAttribute("aria-expanded", "true");
    $("#subjMenu .on")?.focus({ preventScroll: true });
    $$("#subjMenu .subj-opt").forEach((b, i) => b.style.setProperty("--i", i));
  }
  function closeSubjMenu() {
    if (!subjMenuOpen()) return;
    document.body.classList.remove("menu-open");
    syncOverlayAccess();
    $("#subjPill").focus({ preventScroll: true });
    $("#subjPill").setAttribute("aria-expanded", "false");
  }
  // サイドバーの教科プルダウン（開くと下に選択肢が出る）
  function toggleDrawerSubj(open = !$("#drawerSubjWrap").classList.contains("open")) {
    $("#drawerSubjWrap").classList.toggle("open", open);
    $("#drawerSubjects").inert = !open;
    $("#drawerSubjBtn").setAttribute("aria-expanded", String(open));
  }

  // ---------- 部品 ----------
  const chipRow = (items, active, attr) =>
    `<div class="chips" data-noswipe>${items
      .map(([val, label]) => `<button class="chip glass press ${val === active ? "on" : ""}" data-${attr}="${esc(val)}"><span>${esc(label)}</span></button>`)
      .join("")}</div>`;

  const catChips = (active, attr = "cat") =>
    chipRow([["all", "すべて"], ...CATEGORIES.map((c) => [c, c])], active, attr);

  const relHtml = (w) => {
    let h = "";
    if (w.synonyms.length) h += `<div class="rel"><span class="lbl">類</span>${w.synonyms.map((s) => `<span class="pill">${esc(s)}</span>`).join("")}</div>`;
    if (w.antonyms.length) h += `<div class="rel"><span class="lbl">対</span>${w.antonyms.map((s) => `<span class="pill anti">${esc(s)}</span>`).join("")}</div>`;
    return h;
  };

  const starBtn = (word, on) =>
    `<button class="star ${on ? "on" : ""}" data-star="${esc(word)}" aria-label="チェック（苦手に入る）" aria-pressed="${on}">${icon("checkc")}</button>`;

  // 一覧の左端：真ん中の球が今の状態（直近の判定）、上が正解の回数、下が不正解の回数
  const tally = (p) => {
    const ok = p.ok || 0, ng = p.ng || 0, s = p.s || 0;
    const label = ok + ng ? `${STATUS_LABEL[s]}・正解${ok}回・不正解${ng}回` : STATUS_LABEL[s];
    return `<span class="tally${ok + ng ? "" : " none"}" role="img" aria-label="${label}">
      <b class="t-ok${ok ? "" : " zero"}">${ok}</b><i class="ball ${STATUS_CLASS[s]}"></i><b class="t-ng${ng ? "" : " zero"}">${ng}</b>
    </span>`;
  };

  const wordRow = (w) => {
    const p = prog(w.word);
    return `<div class="word-row glass">
      <button class="word-main press" data-word="${esc(w.word)}">
        ${tally(p)}
        <span class="grow">
          <span class="w">${w.no !== null ? `<span class="num">${esc(noLabel(w))}</span>` : ""}${esc(w.word)} <span class="r">${esc(w.reading)}</span></span>
          <span class="m">${esc(w.meaning)}</span>
        </span>
      </button>
      ${starBtn(w.word, p.star)}
    </div>`;
  };

  const popStar = (el) => { if (!motionPreference.matches) el.animate([{ transform: "scale(.6) rotate(-20deg)" }, { transform: "scale(1.25) rotate(8deg)", offset: 0.5 }, { transform: "none" }], { duration: 450, easing: "ease-out" }); };

  function bindWordRows(root, onChange) {
    root.addEventListener("click", (e) => {
      const star = e.target.closest("[data-star]");
      if (star) {
        e.stopPropagation();
        const word = star.dataset.star;
        const on = !prog(word).star;
        setProg(word, { star: on });
        star.classList.toggle("on", on);
        star.setAttribute("aria-pressed", String(on));
        if (on) popStar(star);
        toast(on ? "チェックをつけました（苦手に入ります）" : "チェックを外しました");
        onChange && onChange();
        return;
      }
      const row = e.target.closest("[data-word]");
      if (row) openWordSheet(row, onChange);
    });
  }

  // 直近の結果（○×）を小さな点で並べる
  const histDots = (h) => `<span class="hist">${[...h].map((c) => `<i class="${c === "1" ? "ok" : "ng"}"></i>`).join("")}</span>`;

  // ---------- 詳細シート ----------
  const sheetWrap = $("#sheetWrap");
  const sheet = $("#sheet");

  let sheetOpener = null;
  function openWordSheet(row, onChange) {
    const word = row.dataset.word;
    const w = BY_WORD.get(word);
    if (!w) return;
    sheetOpener = row;
    const render = () => {
      const scroll = sheetOpen() ? $(".sheet-body", sheet).scrollTop : 0;
      const p = prog(word);
      const n = (p.ok || 0) + (p.ng || 0);
      sheet.innerHTML = `
        <div class="grab-zone" aria-hidden="true"><div class="grabber"></div></div>
        <div class="sheet-body">
        <div class="sheet-tag">${w.no !== null ? `${esc(noLabel(w))} ・ ` : ""}${esc(w.category)}</div>
        <div class="back-word fit" style="margin-top:10px;${fitLen(w)}">${esc(w.word)}</div>
        <div class="back-reading">${esc(w.reading)}</div>
        <div class="back-meaning">${esc(w.meaning)}</div>
        ${w.example ? `<div class="back-example">${esc(w.example)}</div>` : ""}
        ${relHtml(w)}
        <div class="sheet-stats">
          <div><b>${n ? `${rate(p.ok || 0, n)}<small>%</small>` : "–"}</b><span>正答率</span></div>
          <div><b>${p.ok || 0}</b><span>正解</span></div>
          <div><b>${p.ng || 0}</b><span>不正解</span></div>
        </div>
        ${p.h ? `<div class="hist-row"><span>直近の結果</span>${histDots(p.h)}</div>` : ""}
        <div class="status-seg">${STATUS_LABEL.map((l, i) => `<button data-s="${i}" class="${(p.s || 0) === i ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="btn-row">
          <button class="btn small glass press" data-act="star"><span>${icon("checkc")}${p.star ? "チェックを外す" : "チェックをつける"}</span></button>
          <button class="btn small glass press" data-act="close"><span>閉じる</span></button>
        </div>
        </div>`;
      $(".sheet-body", sheet).scrollTop = scroll;
    };
    render();
    sheet.onclick = (e) => {
      const s = e.target.closest("[data-s]");
      if (s) {
        setProg(word, { s: Number(s.dataset.s), streak: 0 });
        render();
        $(`[data-s="${s.dataset.s}"]`, sheet).focus({ preventScroll: true });
        onChange && onChange();
        return;
      }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "star") {
        setProg(word, { star: !prog(word).star });
        render();
        $("[data-act=star]", sheet).focus({ preventScroll: true });
        onChange && onChange();
      } else closeSheet();
    };
    sheetWrap.classList.add("open");
    syncOverlayAccess();
    sheet.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheetOpen()) return;
    sd = null;
    sheetWrap.classList.remove("open", "dragging");
    sheet.style.transform = "";
    sheetWrap.style.removeProperty("--dim");
    syncOverlayAccess();
    const opener = sheetOpener?.isConnected ? sheetOpener :
      $$("[data-word]", view).find(row => row.dataset.word === sheetOpener?.dataset.word);
    (opener || $("#menuBtn")).focus({ preventScroll: true });
    sheetOpener = null;
  }
  sheetWrap.addEventListener("click", (e) => { if (e.target === sheetWrap) closeSheet(); });
  const sheetOpen = () => sheetWrap.classList.contains("open");

  // 上の掴み部分を下に引っ張って閉じる
  let sd = null;
  sheet.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0 || !e.target.closest(".grab-zone") || !sheetOpen()) return;
    const now = performance.now();
    sd = { id: e.pointerId, y0: e.clientY, y: e.clientY, py: e.clientY, pt: now, v: 0 };
    sheet.setPointerCapture(e.pointerId);
    sheetWrap.classList.add("dragging");
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!sd || e.pointerId !== sd.id) return;
    const now = performance.now();
    if (now > sd.pt) sd.v = (e.clientY - sd.py) / (now - sd.pt);
    sd.py = e.clientY;
    sd.pt = now;
    sd.y = e.clientY;
    const dy = sd.y - sd.y0;
    // 上方向は少しだけ動くゴムのような抵抗
    const shown = dy >= 0 ? dy : -Math.sqrt(-dy) * 2;
    sheet.style.transform = `translateY(${shown}px)`;
    sheetWrap.style.setProperty("--dim", String(Math.max(0, 1 - Math.max(0, dy) / sheet.offsetHeight)));
  });
  const endSheetDrag = (e) => {
    if (!sd || e.pointerId !== sd.id) return;
    const dy = sd.y - sd.y0;
    const v = sd.v;
    sd = null;
    sheetWrap.classList.remove("dragging");
    sheet.style.transform = "";
    sheetWrap.style.removeProperty("--dim");
    if (e.type === "pointerup" && (v > 0.5 || (dy > Math.min(120, sheet.offsetHeight * 0.3) && v > -0.2))) closeSheet();
  };
  sheet.addEventListener("pointerup", endSheetDrag);
  sheet.addEventListener("pointercancel", endSheetDrag);
  sheet.addEventListener("lostpointercapture", endSheetDrag);

  // ============================================================
  // 画面
  // ============================================================
  const VIEWS = {};

  // 中身が無いときの案内（アイコン・見出し・説明）
  const emptyCard = (ico, title, text, extra = "") => `
    <div class="glass result">
      <div class="badge-ico">${icon(ico)}</div>
      <div class="msg">${title}</div>
      <p class="note">${text}</p>
      ${extra}
    </div>`;

  // ---------- 単元の選び方（教科ごとに覚えておく。null = すべての単元） ----------
  const unitSel = () => {
    const u = store.settings.units && store.settings.units[SID];
    if (!Array.isArray(u)) return null;
    const f = u.filter((c) => CATEGORIES.includes(c));
    // 問題の更新で単元名が変わり、選んでいた単元がすべて無くなったときは「すべて」に戻す
    return u.length && !f.length ? null : f;
  };
  // 「すべて外す」（0 単元）は暗記カードの範囲の画面の中だけの状態。ほかの画面へ移るときは「すべて」に戻す
  function dropEmptyUnitSel() {
    const u = unitSel();
    if (!u || u.length) return;
    const units = Object.assign({}, store.settings.units);
    delete units[SID];
    store.settings.units = units;
    save();
  }
  function setUnitSel(arr) {
    const units = Object.assign({}, store.settings.units);
    if (!arr || arr.length >= CATEGORIES.length) delete units[SID];
    else units[SID] = arr;
    store.settings.units = units;
    save();
    deck = null;
  }
  const unitOn = (c) => { const u = unitSel(); return !u || u.includes(c); };
  const rangeWords = () => {
    const selected = unitSel();
    return selected ? WORDS.filter(w => selected.includes(w.category)) : WORDS;
  };
  const rangeLabel = () => {
    const u = unitSel();
    if (!u) return "すべての単元";
    if (!u.length) return "単元を選んでください";
    return u.length === 1 ? u[0] : `${u[0]} ほか${u.length - 1}単元`;
  };

  // 単元の帯（ホーム・クイズ）。タブと同じで、タップした単元だけにしぼる（いくつも選ぶのは暗記カードの範囲の画面で）
  // 選んでいるタブの下を色の板（glider）がすべって移動する。帯そのものは描き直さない
  const unitStrip = () => {
    if (CATEGORIES.length < 2) return "";
    const u = unitSel();
    const chip = (attr, label, n, on) =>
      `<button class="chip glass press ${on ? "on" : ""}" ${attr} aria-pressed="${on}"><span>${label} <span class="chip-n">${n}</span></span></button>`;
    return `<div class="chips unit-strip" data-noswipe><span class="unit-glider" aria-hidden="true"></span>
      ${chip("data-unit-all", "すべて", WORDS.length, !u)}
      ${CATEGORIES.map((c) => chip(`data-unit="${esc(c)}"`, esc(c), WORDS.filter((w) => w.category === c).length, !!u && u.includes(c))).join("")}
    </div>`;
  };

  // 色の板を、選んでいるタブ（1つだけのとき）の位置へ。animate=false ならその場に置く
  function placeGlider(strip, animate) {
    const glider = $(".unit-glider", strip);
    const on = $$(".chip.on", strip);
    const glide = !!glider && on.length === 1;
    strip.classList.toggle("glide", glide);
    if (!glide) return;
    const c = on[0];
    if (!animate || motionPreference.matches) strip.classList.remove("ready");
    glider.style.width = `${c.offsetWidth}px`;
    glider.style.height = `${c.offsetHeight}px`;
    glider.style.transform = `translate(${c.offsetLeft}px, ${c.offsetTop}px)`;
    if (!animate || motionPreference.matches) { void glider.offsetWidth; strip.classList.add("ready"); }
  }

  // 文字の読み込みや画面の回転でタブの幅が変わったら、板の位置を合わせ直す
  function alignStrips() {
    $$(".unit-strip", view).forEach(strip => placeGlider(strip, false));
  }
  window.addEventListener("resize", alignStrips);
  document.fonts?.addEventListener("loadingdone", alignStrips);
  function initStrips() {
    alignStrips();
    $$(".unit-strip", view).forEach(strip => {
      const currentChip = $(".on", strip);
      if (currentChip) revealChip(strip, currentChip, false);
    });
  }

  // 選んだタブが帯の外にはみ出していたら、見える位置までスクロールする
  function revealChip(strip, chip, animate = true) {
    const behavior = animate && !motionPreference.matches ? "smooth" : "auto";
    const pad = 28;
    const l = chip.offsetLeft;
    const r = l + chip.offsetWidth;
    if (l - pad < strip.scrollLeft) strip.scrollTo({ left: Math.max(0, l - pad), behavior });
    else if (r + pad > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: r + pad - strip.clientWidth, behavior });
  }

  // 帯のタップを処理したら true。onChange(dir) には、右のタブへ移ったら 1、左なら -1 が渡る
  function unitStripClick(e, onChange) {
    const btn = e.target.closest("[data-unit-all], [data-unit]");
    const strip = btn && btn.closest(".unit-strip");
    if (!strip) return false;
    const next = btn.hasAttribute("data-unit-all") ? null : [btn.dataset.unit];
    const cur = unitSel();
    if (JSON.stringify(cur) === JSON.stringify(next)) return true;
    const chips = $$(".chip", strip);
    const from = chips.findIndex((c) => c.classList.contains("on"));
    const to = chips.indexOf(btn);
    setUnitSel(next);
    const u = unitSel();
    chips.forEach((c) => {
      const on = c.hasAttribute("data-unit-all") ? !u : !!u && u.includes(c.dataset.unit);
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", String(on));
    });
    placeGlider(strip, true);
    revealChip(strip, btn);
    onChange(to >= from ? 1 : -1);
    return true;
  }

  // タブを切り替えたときに中身を横から差し替える演出（ガラスは自分自身にだけ透明度をかける）
  function slideEls(els, dir) {
    if (motionPreference.matches || !dir) return;
    els.forEach((el) => {
      el.animate(
        [{ transform: `translateX(${dir * 10}px)` }, { transform: "none" }],
        { duration: 320, easing: "cubic-bezier(.22,.8,.24,1)" }
      );
    });
  }

  // ---------- 教科の切り替え ----------
  function switchSubject(id, x = innerWidth / 2, y = 90) {
    if (!subjectById(id) || id === SID) return;
    useSubject(id);
    store.settings.subject = SID;
    save();
    deck = null;
    quiz = null;
    cardOpts.stage = "setup";
    listOpts.cat = "all";
    themeWave(x, y);
    renderChrome();
    go(current);
    toast(`${SUBJ.name}に切り替えました`);
  }

  // ---------- 新しい問題の反映 ----------
  // ページを読み込み直さず、その場で差し替える。
  // （iOS のホーム画面アプリでは、キーボードが出たまま読み込み直すと上のバーが下にずれたまま残るため）
  let pendingData = false;
  function applyNewData() {
    pendingData = false;
    loadSubjects();
    applyTests();
    useSubject(store.settings.subject || SID);
    deck = null;
    quiz = null;
    cardOpts.stage = "setup";
    listOpts.cat = "all";
    renderChrome();
  }

  // ---------- iOS：固定表示のずれを直す ----------
  // 中身は #scroller の中だけでスクロールするので、ページ全体（window）は常に一番上にあるはず。
  // キーボードを閉じたあとなどに iOS がページ全体をずらしたまま残すと、上のバーやドックがずれて見えるので、
  // 入力中でなければ一番上に戻す（キーボードが閉じきるまで少し待って、もう一度確かめる）
  const typing = () => !!document.activeElement?.matches?.("input, textarea, select");
  function resetWindowScroll() {
    if (!typing() && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
  }
  function resyncViewport() {
    resetWindowScroll();
    setTimeout(resetWindowScroll, 150);
    setTimeout(resetWindowScroll, 450);
  }
  window.addEventListener("scroll", resetWindowScroll, { passive: true });
  document.addEventListener("focusout", (e) => {
    if (e.target.matches && e.target.matches("input, textarea")) resyncViewport();
  });
  if (window.visualViewport) {
    let vvh = window.visualViewport.height;
    window.visualViewport.addEventListener("resize", () => {
      const h = window.visualViewport.height;
      if (h > vvh + 80) resyncViewport(); // キーボードが閉じた
      vvh = h;
    });
  }
  window.addEventListener("pageshow", resyncViewport);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resyncViewport(); });

  // ---------- ホーム ----------
  function homeHeading() {
    const date = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date());
    const day = `<span>${icon("calendar")}${esc(date)}</span>`;
    if (!SUBJ) return `<div class="page-heading"><h2>今日の学習</h2>${day}</div>`;
    // いま何の教科を学習しているかを、画面でいちばん大きな文字で出す
    return `<div class="page-heading subj-heading">
      <div class="grow"><small>${esc(testLabel(SUBJ) || "今日の学習")}</small><h2><span class="subj-dot"></span><span class="subj-name">${esc(SUBJ.name)}</span></h2></div>
      ${day}</div>`;
  }

  function glassDeck(front) {
    return `<div class="glass-deck" ${front ? "" : 'aria-hidden="true"'}>
      <div class="deck-leaf rear"></div><div class="deck-leaf middle"></div>
      <div class="deck-leaf front">${front || '<span class="deck-glyph">答</span>'}</div></div>`;
  }

  function homeMetrics(sm, streak = sm.streak) {
    const metric = (ico, label, key, value, unit) => `<div class="kpi glass">
      ${icon(ico)}<small>${label}</small>
      <b>${value === null ? "–" : `<span data-k="${key}" data-count="${value}">${value}</span><em>${unit}</em>`}</b></div>`;
    return `<div class="kpis stagger">
      ${metric("calendar", "今日の解答", "tn", sm.tn, "問")}
      ${metric("flame", "連続学習", "streak", streak, "日")}
      ${metric("target", "正答率", "rate", sm.n ? rate(sm.ok, sm.n) : null, "%")}
    </div>`;
  }

  function recordLink() {
    return `<button class="link-row glass press" data-go="records"><span class="tile-ico sm">${icon("chart")}</span><span class="grow"><b>記録を見る</b><small>解答の履歴・正答率・連続学習</small></span>${icon("chevR", "chev")}</button>`;
  }

  VIEWS.home = () => {
    view.onclick = (e) => {
      if (unitStripClick(e, renderHomeBody)) return;
      const t = e.target.closest("[data-go]");
      if (t) return go(t.dataset.go);
      const c2 = e.target.closest("[data-cat-go]");
      if (c2) { setUnitSel([c2.dataset.catGo]); go("cards", { setup: true }); }
    };

    if (!DATA.hasData() || !SUBJECTS.length) {
      view.innerHTML = `${homeHeading()}
        <section class="hero glass cover welcome">
          <div class="cover-copy">
            <h3 class="hero-greet">一問一答を、<br>はじめよう。</h3>
            <p>問題データを接続すると、暗記カードと<br class="wide-break">クイズで学習を始められます。</p>
            <button class="btn press cover-action" data-go="settings"><span>問題データを接続 ${icon("chevR")}</span></button>
          </div>
          ${glassDeck()}
        </section>
        <div class="section-title">学習の記録</div>
        ${homeMetrics(summary())}
        ${recordLink()}`;
      return;
    }
    if (!WORDS.length) {
      view.innerHTML = emptyCard("book", `${esc(SUBJ.name)}の問題はまだありません`,
        `KotaeLog-Que の <code>subjects/${esc(SID)}.json</code> に問題を追加すると、ここに出てきます。右上の教科ボタンからほかの教科に切り替えられます。`);
      return;
    }

    view.innerHTML = `${homeHeading()}${unitStrip()}<div class="tab-body" id="homeBody"></div>`;
    initStrips();
    renderHomeBody(0);
  };

  // ホームの中身（単元の帯の下）。dir があれば、タブを切り替えたときの差し替え（数字は前の値から動かす）
  function renderHomeBody(dir = 0) {
    const box = $("#homeBody", view);
    if (!box) return;
    const prev = dir ? readCounts(box) : null;
    const oldBar = dir ? $(".ring .arc", box) : null;
    const rw = rangeWords();
    const c = counts(rw);
    const total = rw.length || 1;
    const pct = Math.round((c[MASTERED] / total) * 100);
    const R = 48, L = 2 * Math.PI * R;
    const startOffset = oldBar ? getComputedStyle(oldBar).strokeDashoffset || L : L;
    const h = new Date().getHours();
    const greet = h < 5 ? "夜更かしの<br>ひと勉強" : h < 11 ? "おはよう。<br>朝の1セット" : h < 17 ? "すきま時間に<br>コツコツと" : "今日の仕上げに<br>もう一歩";
    const weak = WORDS.filter((w) => isWeak(w.word)).length;
    const sm = summary(SID);
    const streak = summary().streak;
    const tile = (go, ico, name, desc) =>
      `<button class="tile glass press" data-go="${go}"><span class="tile-ico">${icon(ico)}</span><span><div class="tile-name">${name}</div><div class="tile-desc">${desc}</div></span></button>`;
    const num = (k, v) => `<span data-k="${k}" data-count="${v}">${v}</span>`;

    box.innerHTML = `
      <section class="hero glass cover">
        ${glassDeck(`<div class="ring">
          <svg viewBox="0 0 112 112">
            <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
            <circle class="track" cx="56" cy="56" r="${R}" fill="none" stroke-width="10"/>
            <circle class="arc" cx="56" cy="56" r="${R}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${L} ${L * 2}" style="stroke-dashoffset:${startOffset}"/>
          </svg>
          <div class="ring-label"><div><b>${num("pct", pct)}<span style="font-size:15px">%</span></b><small>習得率</small></div></div>
        </div>`)}
        <div class="hero-stats">
          <div class="hero-subj"><span class="subj-dot"></span><span class="hero-range">${esc(SUBJ.name)} ・ ${esc(rangeLabel())}</span></div>
          <div class="hero-greet">${greet}</div>
        </div>
        <div class="stat-row">
            <span class="stat"><span class="dot c-mastered"></span>覚えた <b>${num("m", c[MASTERED])}</b></span>
            <span class="stat"><span class="dot c-learning"></span>学習中 <b>${num("l", c[LEARNING])}</b></span>
            <span class="stat"><span class="dot c-new"></span>未学習 <b>${num("n", c[NEW])}</b></span>
        </div>
      </section>

      ${homeMetrics(sm, streak)}

      <div class="section-title">学習する</div>
      <div class="tiles stagger">
        ${tile("cards", "cards", "暗記カード", `${rw.length}語をめくる`)}
        ${tile("quiz", "quiz", "4択クイズ", `${Math.min(store.settings.quizCount, rw.length)}問でチェック`)}
        ${tile("list", "list", "一覧", `${WORDS.length}語を検索`)}
        ${tile("weak", "flag", "苦手", `${weak}語を復習`)}
      </div>
      ${recordLink()}

      <div class="section-title">単元別</div>
      <div class="cat-list stagger">
        ${CATEGORIES.map((cat) => {
          const ws = WORDS.filter((w) => w.category === cat);
          const m = counts(ws)[MASTERED];
          return `<button class="cat-item glass press ${unitOn(cat) ? "" : "off"}" data-cat-go="${esc(cat)}">
            <div class="grow">
              <div class="row-top"><span class="cat-name">${esc(cat)}</span><span class="cat-count">${m} / ${ws.length}</span></div>
              <div class="mini-bar"><i class="grow-x" style="width:${(m / ws.length) * 100}%"></i></div>
            </div>
            ${icon("chevR", "chev")}
          </button>`;
        }).join("")}
      </div>`;

    if (dir) {
      applyFrom(box, prev);
      stagger(box);
      countUp(box);
      slideEls([$(".hero-stats", box)], dir);
    }
    const bar = $(".ring .arc", box);
    const setRing = () => { bar.style.strokeDashoffset = String(L * (1 - c[MASTERED] / total)); };
    if (motionPreference.matches) setRing();
    else requestAnimationFrame(() => requestAnimationFrame(setRing));
  }

  // ---------- 暗記カード ----------
  // 2 段階：範囲を決める画面（単元にチェック・出すカード・表の面・順番）→ めくる画面
  const cardOpts = { stage: "setup" };
  let deck = null;

  // 出すカード（学習状況で絞り込む）
  const CARD_FILTERS = [
    ["all", "すべて", () => true],
    ["new", "未学習", (p) => (p.s || NEW) === NEW],
    ["unmastered", "未習得", (p) => p.s !== MASTERED],
    ["missed", "ミスした", (p) => p.ng > 0 && p.s !== MASTERED],
    ["mastered", "覚えた", (p) => p.s === MASTERED],
    ["star", "チェック", (p) => !!p.star],
  ];
  const cardFilterFn = (key) => (CARD_FILTERS.find(([k]) => k === key) || CARD_FILTERS[0])[2];
  const setupWords = () => rangeWords().filter((w) => cardFilterFn(store.settings.cardFilter)(prog(w.word)));

  function buildDeck(words) {
    let ws = words || setupWords();
    if (store.settings.cardShuffle !== false) ws = shuffle(ws);
    deck = { list: ws, i: 0, known: 0, unknown: 0, missed: [], hist: [], custom: !!words, lastAnswerAt: -Infinity };
  }

  VIEWS.cards = (params = {}) => {
    if (params.words) { buildDeck(params.words); cardOpts.stage = "study"; }
    else if (params.setup || !deck) cardOpts.stage = "setup";
    renderCards();
  };

  const renderCards = () => (cardOpts.stage === "setup" ? renderCardSetup() : renderCardStudy());

  // ----- 範囲を決める画面 -----
  function renderCardSetup() {
    badgeEl.textContent = "";
    const st = store.settings;
    const rw = rangeWords();
    const n = setupWords().length;
    const allOn = !unitSel();
    view.innerHTML = `
      <div class="setup-head">
        <div class="section-title">単元</div>
        <button class="text-btn press" data-units="${allOn ? "none" : "all"}">${allOn ? "すべて外す" : "すべて選ぶ"}</button>
      </div>
      <div class="glass unit-list">
        ${CATEGORIES.map((cat) => {
          const ws = WORDS.filter((w) => w.category === cat);
          const m = counts(ws)[MASTERED];
          const on = unitOn(cat);
          return `<button class="unit-row press ${on ? "on" : ""}" data-unit-toggle="${esc(cat)}" role="checkbox" aria-checked="${on}">
            <span class="checkbox">${icon("check")}</span>
            <span class="grow">
              <span class="row-top"><b>${esc(cat)}</b><span class="cat-count">${m} / ${ws.length}</span></span>
              <span class="mini-bar"><i style="width:${(m / ws.length) * 100}%"></i></span>
            </span>
          </button>`;
        }).join("")}
      </div>

      <div class="section-title">出すカード</div>
      <div class="seg">${CARD_FILTERS.map(([k, label, fn]) => {
        const c = rw.filter((w) => fn(prog(w.word))).length;
        return `<button class="chip glass press ${st.cardFilter === k ? "on" : ""}" data-filter="${k}"><span>${k === "star" ? icon("checkc") : ""}${label} <span class="chip-n">${c}</span></span></button>`;
      }).join("")}</div>

      <div class="setup-grid">
        <div>
          <div class="section-title">表に出す面</div>
          <div class="seg-ctl">${[["w2m", "語"], ["m2w", "意味"]].map(([v, l]) => `<button class="${st.cardMode === v ? "on" : ""}" data-mode-card="${v}">${l}</button>`).join("")}</div>
        </div>
        <div>
          <div class="section-title">順番</div>
          <div class="seg-ctl">${[["1", "シャッフル"], ["0", "番号順"]].map(([v, l]) => `<button class="${(st.cardShuffle !== false ? "1" : "0") === v ? "on" : ""}" data-order="${v}">${l}</button>`).join("")}</div>
        </div>
      </div>

      <div class="start-bar">
        <button class="btn primary block press" data-act="start" ${n ? "" : "disabled"}><span>${icon("cards")}${n ? `${n}枚で始める` : "該当するカードがありません"}</span></button>
        ${deck && !deck.custom && deck.i > 0 && deck.i < deck.list.length ? `<button class="btn glass block press" data-act="resume"><span>続きから（${deck.i + 1} / ${deck.list.length}枚目）</span></button>` : ""}
      </div>`;
    stagger();

    // 押したところだけその場で書き換える（全体を描き直すと、チェック済みの印がすべて弾み直してしまう）
    view.onclick = (e) => {
      const u = e.target.closest("[data-unit-toggle]");
      if (u) {
        const cat = u.dataset.unitToggle;
        const cur = unitSel() || [...CATEGORIES];
        setUnitSel(cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat]);
        return syncCardSetup();
      }
      const all = e.target.closest("[data-units]");
      if (all) { setUnitSel(all.dataset.units === "all" ? null : []); return syncCardSetup(); }
      const f = e.target.closest("[data-filter]");
      if (f) { st.cardFilter = f.dataset.filter; save(); deck = null; return syncCardSetup(); }
      const md = e.target.closest("[data-mode-card]");
      if (md) { st.cardMode = md.dataset.modeCard; save(); return syncCardSetup(); }
      const od = e.target.closest("[data-order]");
      if (od) { st.cardShuffle = od.dataset.order === "1"; save(); deck = null; return syncCardSetup(); }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "start") { buildDeck(); cardOpts.stage = "study"; enterAnim(); renderCardStudy(); }
      else if (act.dataset.act === "resume") { cardOpts.stage = "study"; enterAnim(); renderCardStudy(); }
    };
  }

  // 範囲を決める画面を、今の設定に合わせてその場で書き換える
  function syncCardSetup() {
    const st = store.settings;
    const rw = rangeWords();
    const n = setupWords().length;
    const allOn = !unitSel();
    $$("[data-unit-toggle]", view).forEach((r) => {
      const on = unitOn(r.dataset.unitToggle);
      r.classList.toggle("on", on);
      r.setAttribute("aria-checked", String(on));
    });
    const ub = $("[data-units]", view);
    if (ub) { ub.dataset.units = allOn ? "none" : "all"; ub.textContent = allOn ? "すべて外す" : "すべて選ぶ"; }
    $$("[data-filter]", view).forEach((b) => {
      const k = b.dataset.filter;
      b.classList.toggle("on", st.cardFilter === k);
      const cn = $(".chip-n", b);
      if (cn) cn.textContent = rw.filter((w) => cardFilterFn(k)(prog(w.word))).length;
    });
    $$("[data-mode-card]", view).forEach((b) => b.classList.toggle("on", st.cardMode === b.dataset.modeCard));
    $$("[data-order]", view).forEach((b) => b.classList.toggle("on", (st.cardShuffle !== false ? "1" : "0") === b.dataset.order));
    const start = $("[data-act=start]", view);
    if (start) {
      start.disabled = !n;
      start.innerHTML = `<span>${icon("cards")}${n ? `${n}枚で始める` : "該当するカードがありません"}</span>`;
    }
    const resume = $("[data-act=resume]", view);
    if (resume && !(deck && !deck.custom && deck.i > 0 && deck.i < deck.list.length)) resume.remove();
  }

  // ----- めくる画面 -----
  function renderCardStudy() {
    scroller.scrollTop = 0;
    const total = deck.list.length;
    const head = `
      <div class="study-bar">
        <button class="chip glass press range-chip" data-act="setup"><span>${icon("sliders")}${deck.custom ? `苦手 ${total}枚` : esc(rangeLabel())}</span></button>
        <button class="icon-chip glass press" data-act="undo" aria-label="1枚戻る" ${deck.hist.length ? "" : "disabled"}>${icon("undo")}</button>
        <button class="icon-chip glass press" data-dir aria-label="表と裏を入れ替える">${icon("swap")}</button>
      </div>`;

    if (!total) {
      badgeEl.textContent = "";
      view.innerHTML = `${head}${emptyCard("sparkle", "該当するカードがありません", "範囲を変えてみてください。", `<button class="btn primary block press" data-act="setup"><span>範囲を変える</span></button>`)}`;
      bindCardStudy();
      return;
    }

    if (deck.i >= total) {
      badgeEl.textContent = "";
      enterAnim();
      view.innerHTML = `${head}
        <div class="glass result">
          <div class="badge-ico shine">${icon("trophy")}</div>
          <div class="msg">${total}枚 完了！</div>
          <p class="note">覚えた ${deck.known} ・ まだ ${deck.unknown}</p>
          ${deck.missed.length ? `<button class="btn primary block press" data-act="missed"><span>「まだ」の${deck.missed.length}枚をもう一度</span></button><div style="height:10px"></div>` : ""}
          <button class="btn ${deck.missed.length ? "glass" : "primary"} block press" data-act="again"><span>もう一度</span></button>
          <div class="btn-row">
            <button class="btn glass press" data-act="setup"><span>範囲を変える</span></button>
            <button class="btn glass press" data-act="quiz"><span>クイズで確認</span></button>
          </div>
        </div>`;
      bindCardStudy();
      if (!deck.unknown) burst($(".badge-ico", view), 18);
      return;
    }

    const w = deck.list[deck.i];
    badgeEl.textContent = `${deck.i + 1} / ${total}`;
    view.innerHTML = `${head}
      <div class="progress-line"><i style="width:${(deck.i / total) * 100}%"></i></div>
      <div class="flip-scene">
        ${flipHtml(w, "", "in")}
      </div>
      <div class="answer-row">
        <button class="btn glass press tint-bad" data-ans="0"><span>${icon("x")}まだ</span></button>
        <button class="btn glass press tint-good" data-ans="1"><span>${icon("check")}覚えた</span></button>
      </div>
      <div class="study-tally"><span><i class="dot c-mastered"></i>覚えた <b id="tallyK">${deck.known}</b></span><span><i class="dot c-learning"></i>まだ <b id="tallyU">${deck.unknown}</b></span></div>`;
    bindCardStudy();
    requestAnimationFrame(preloadNext);
  }

  // カード右上のチェック（苦手リストに入る印）
  const cardCheck = (w) => {
    const on = !!prog(w.word).star;
    return `<button class="card-check ${on ? "on" : ""}" data-check="${esc(w.word)}" aria-label="チェック" aria-pressed="${on}">${icon("checkc")}</button>`;
  };

  function cardFace(w, back, enter = "") {
    const s = statusOf(w.word);
    const tag = `<span class="tag"><i class="dot ${STATUS_CLASS[s]}"></i>${w.no !== null ? `${esc(noLabel(w))} ・ ` : ""}${esc(w.category)}</span>`;
    if (!back) {
      return `<div class="face glass press ${enter}" data-flip>
        ${tag}${cardCheck(w)}
        ${store.settings.cardMode === "m2w"
          ? `<div class="front-meaning">${esc(w.meaning)}</div>
        <div class="tap-hint">タップで語を表示</div>`
          : `<div class="big-word fit" style="${fitLen(w)}">${esc(w.word)}</div>
        <div class="tap-hint">タップで意味を表示</div>`}
      </div>`;
    }
    // 長い裏面は中の箱だけをスクロールする（カードごと動かすと、縁の光とチェックがずれて線が残る）
    return `<div class="face back glass press is-hidden" data-flip>
      ${tag}${cardCheck(w)}
      <div class="back-scroll">
        <div class="back-word fit" style="${fitLen(w)}">${esc(w.word)}</div>
        <div class="back-reading">${esc(w.reading)}</div>
        <div class="back-meaning">${esc(w.meaning)}</div>
        ${w.example ? `<div class="back-example">${esc(w.example)}</div>` : ""}
        ${relHtml(w)}
      </div>
    </div>`;
  }

  function flipCard() {
    const flip = $("#flip");
    if (!flip || flip.dataset.busy) return;
    const [front, back] = $$(".face", flip);
    const toBack = !flip.dataset.back;
    const swapFaces = () => {
      front.classList.remove("in", "next");
      front.classList.toggle("is-hidden", toBack);
      back.classList.toggle("is-hidden", !toBack);
      if (toBack) flip.dataset.back = "1"; else delete flip.dataset.back;
    };
    if (motionPreference.matches) return swapFaces();
    flip.dataset.busy = "1";
    const a = flip.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: 110, easing: "cubic-bezier(.4,0,.9,.6)", fill: "forwards" });
    a.onfinish = () => {
      if (!flip.isConnected || flip.inert) return;
      swapFaces();
      const b = flip.animate(
        [{ transform: "scaleX(0)" }, { transform: "scaleX(1.03)", offset: 0.7 }, { transform: "scaleX(1)" }],
        { duration: 300, easing: "cubic-bezier(.15,.8,.3,1)" }
      );
      a.cancel();
      b.onfinish = () => delete flip.dataset.busy;
    };
  }

  // 次のカード（opacity をほぼ 0 にして下に置いておく）。ガラスの描画を先に済ませておくため
  const flipHtml = (w, cls, enter = "") => `<div class="flip ${cls}"${cls ? " inert" : ' id="flip"'}>${cardFace(w, false, enter)}${cardFace(w, true)}</div>`;

  function preloadNext() {
    const scene = $(".flip-scene", view);
    if (!scene || !deck || $(".flip.queued", scene)) return;
    const next = deck.list[deck.i + 1];
    if (!next) return;
    scene.insertAdjacentHTML("afterbegin", flipHtml(next, "queued"));
  }

  // 同じボタンの素早い2度押し（ダブルタップ）で2枚まとめて判定しないように、直後の押下は無視する
  function answerCard(known, btn) {
    const flip = $("#flip");
    if (!flip) return;
    const now = performance.now();
    if (now - deck.lastAnswerAt < 200) return;
    deck.lastAnswerAt = now;
    const w = deck.list[deck.i];
    const p = prog(w.word);
    // 「1枚戻る」で元に戻せるように、記録する前の状態をとっておく
    const prev = progMap()[w.word];
    const evicted = store.log.length === MAX_LOG ? store.log[0] : null;
    let entry;
    if (known) {
      entry = logAnswer(w.word, true, "c", { s: MASTERED, ok: (p.ok || 0) + 1 });
      deck.known++;
      burst(btn, 10);
    } else {
      entry = logAnswer(w.word, false, "c", { s: LEARNING, ng: (p.ng || 0) + 1, streak: 0 });
      deck.unknown++;
      deck.missed.push(w);
    }

    deck.hist.push({ i: deck.i, word: w.word, prev, known, entry, evicted, firstRetained: store.log[0] });
    deck.i++;
    if (deck.i === deck.list.length) return renderCardStudy();

    flip.removeAttribute("id");
    flip.classList.add("leaving");
    flip.inert = true;
    flip.getAnimations().forEach(animation => animation.cancel());
    if (!motionPreference.matches) {
      const dir = known ? 1 : -1;
      flip.animate([
        { transform: "translateX(0) rotate(0deg)", opacity: 1 },
        { transform: `translateX(${dir * 110}%) rotate(${dir * 9}deg)`, opacity: 0 },
      ], { duration: 270, easing: "cubic-bezier(.24,.72,.34,1)" }).onfinish = () => flip.remove();
    }

    // 2) 用意しておいた次のカードを同じ瞬間に前へ出す
    let next = $(".flip.queued", view);
    if (next) {
      next.classList.remove("queued");
      next.id = "flip";
      next.inert = false;
    } else {
      flip.insertAdjacentHTML("beforebegin", flipHtml(deck.list[deck.i], "", "next"));
    }
    if (motionPreference.matches) flip.remove();
    badgeEl.textContent = `${deck.i + 1} / ${deck.list.length}`;
    const bar = $(".progress-line i", view);
    if (bar) bar.style.width = `${(deck.i / deck.list.length) * 100}%`;
    const tk = $("#tallyK"), tu = $("#tallyU");
    if (tk) tk.textContent = deck.known;
    if (tu) tu.textContent = deck.unknown;
    const undo = $("[data-act=undo]", view);
    if (undo) undo.disabled = false;

    // 3) 飛ばすアニメーションが走り出してから、さらに次のカードを裏で用意する
    requestAnimationFrame(() => requestAnimationFrame(preloadNext));
  }

  // 1枚戻る：直前の判定を取り消して、そのカードをもう一度出す
  function undoCard() {
    const h = deck?.hist.at(-1);
    if (!h) return;
    const index = store.log.lastIndexOf(h.entry);
    const newerAnswer = store.log.slice(index + 1).some(e => e.s === SID && e.w === h.word);
    if (index < 0 || newerAnswer || statusOf(h.word) !== (h.known ? MASTERED : LEARNING)) {
      return toast("その後に学習記録が変わったため、この判定は取り消せません");
    }
    deck.hist.pop();
    const star = !!prog(h.word).star;
    if (h.prev || star) progMap()[h.word] = { ...h.prev, star };
    else delete progMap()[h.word];
    store.log.splice(index, 1);
    if (h.evicted && h.firstRetained === store.log[0]) store.log.unshift(h.evicted);
    save();
    deck.lastAnswerAt = -Infinity;
    deck.i = h.i;
    if (h.known) deck.known--;
    else { deck.unknown--; deck.missed.pop(); }
    renderCardStudy();
    const face = $("#flip .face", view);
    if (face && !motionPreference.matches) face.animate([{ transform: `translateX(${h.known ? 40 : -40}%) rotate(${h.known ? 6 : -6}deg)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.2,.8,.3,1)" });
  }

  function toggleCheck(word) {
    const on = !prog(word).star;
    setProg(word, { star: on });
    $$(`[data-check]`, view).forEach((b) => {
      if (b.dataset.check !== word) return;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const b = $(`#flip [data-check]`, view);
    if (on && b) popStar(b);
    toast(on ? "チェックをつけました（苦手に入ります）" : "チェックを外しました");
  }

  function bindCardStudy() {
    view.onclick = (e) => {
      const chk = e.target.closest("[data-check]");
      if (chk) return toggleCheck(chk.dataset.check);
      if (e.target.closest("[data-dir]")) {
        store.settings.cardMode = store.settings.cardMode === "m2w" ? "w2m" : "m2w";
        save();
        toast(store.settings.cardMode === "m2w" ? "表：意味 → 裏：語" : "表：語 → 裏：意味");
        return renderCardStudy();
      }
      if (e.target.closest("[data-flip]")) return flipCard();
      const ans = e.target.closest("[data-ans]");
      if (ans) return answerCard(ans.dataset.ans === "1", ans);
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "undo") undoCard();
      else if (a === "setup") { if (deck.custom) deck = null; cardOpts.stage = "setup"; enterAnim(); renderCardSetup(); }
      else if (a === "again") { deck.custom ? buildDeck(deck.list) : buildDeck(); renderCardStudy(); }
      else if (a === "missed") { buildDeck(deck.missed); renderCardStudy(); }
      else if (a === "quiz") go("quiz");
    };
  }

  // パソコンのキーボードでも：スペースでめくる、→ 覚えた、← まだ、Backspace で1枚戻る
  document.addEventListener("keydown", (e) => {
    if (current !== "cards" || cardOpts.stage !== "study" || !deck || sheetOpen() || isOpen() || subjMenuOpen()) return;
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.isComposing || e.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if (e.key === " " || e.key === "Enter") {
      if (e.target.closest?.("button, a, [role=button]")) return;
      e.preventDefault();
      flipCard();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const known = e.key === "ArrowRight";
      answerCard(known, $(`[data-ans='${known ? 1 : 0}']`, view));
    } else if (e.key === "Backspace") { e.preventDefault(); undoCard(); }
  });

  // ---------- クイズ ----------
  let quiz = null;

  VIEWS.quiz = (params = {}) => {
    if (params.words) return startQuiz(params.words);
    quiz = null;
    renderQuizSetup();
  };

  function renderQuizSetup() {
    const st = store.settings;
    const pool = rangeWords();
    const hasAlternatives = WORDS.some(w => w.meaning.trim() !== WORDS[0].meaning.trim());
    view.innerHTML = `
      <div class="section-title" style="margin-top:4px">出題範囲</div>
      ${unitStrip()}
      <div class="count-note">${esc(rangeLabel())} ・ ${pool.length}語</div>
      <div class="section-title">問題数</div>
      <div class="seg">${[5, 10, 20, 30].map((n) => `<button class="chip glass press ${st.quizCount === n ? "on" : ""}" data-count-opt="${n}"><span>${n}問</span></button>`).join("")}</div>
      <div class="section-title">形式</div>
      <div class="seg">${[["mix", "ミックス"], ["w2m", "語 → 意味"], ["m2w", "意味 → 語"]].map(([v, l]) => `<button class="chip glass press ${st.quizMode === v ? "on" : ""}" data-mode="${v}"><span>${l}</span></button>`).join("")}</div>
      <div style="height:26px"></div>
      <button class="btn primary block press" data-act="start" ${!pool.length || !hasAlternatives ? "disabled" : ""}><span>スタート（${Math.min(st.quizCount, pool.length)}問）</span></button>
      ${hasAlternatives ? "" : '<p class="count-note">クイズには意味の異なる語が2つ以上必要です。</p>'}
      <div class="btn-row"><button class="btn glass press" data-act="weak"><span>${icon("flag")}苦手から出題</span></button></div>`;
    initStrips();

    // 範囲・問題数を変えたら、その場で語数とスタートボタンだけ書き換える（帯や画面は描き直さない）
    const refresh = (dir = 0) => {
      const p = rangeWords();
      const note = $(".count-note", view);
      note.textContent = `${rangeLabel()} ・ ${p.length}語`;
      const start = $("[data-act=start]", view);
      start.disabled = !p.length || !hasAlternatives;
      $("span", start).textContent = `スタート（${Math.min(st.quizCount, p.length)}問）`;
      slideEls([note], dir);
    };
    const pick = (btn, attr) => $$(`[${attr}]`, view).forEach((b) => b.classList.toggle("on", b === btn));

    view.onclick = (e) => {
      if (unitStripClick(e, refresh)) return;
      const cnt = e.target.closest("[data-count-opt]");
      if (cnt) { st.quizCount = Number(cnt.dataset.countOpt); save(); pick(cnt, "data-count-opt"); return refresh(); }
      const md = e.target.closest("[data-mode]");
      if (md) { st.quizMode = md.dataset.mode; save(); return pick(md, "data-mode"); }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "start") startQuiz(shuffle(rangeWords()).slice(0, st.quizCount));
      else {
        const weak = WORDS.filter((w) => isWeak(w.word));
        if (!weak.length) return toast("苦手な語はまだありません");
        startQuiz(shuffle(weak).slice(0, st.quizCount));
      }
    };
  }

  function makeQuestion(w) {
    const mode = store.settings.quizMode === "mix" ? (Math.random() < 0.5 ? "w2m" : "m2w") : store.settings.quizMode;
    const pool = WORDS.filter(x => x.meaning.trim() !== w.meaning.trim());
    const same = shuffle(pool.filter(x => x.category === w.category));
    const other = shuffle(pool.filter(x => x.category !== w.category));
    const options = [w];
    const labels = new Set();
    for (const item of [...same, ...other]) {
      const label = (mode === "w2m" ? item.meaning : item.word).trim();
      if (labels.has(label)) continue;
      labels.add(label);
      options.push(item);
      if (options.length === 4) break;
    }
    return { w, mode, options: shuffle(options), answered: null };
  }

  function startQuiz(words) {
    if (!words.length) return toast("出題できる語がありません");
    const qs = words.map(makeQuestion);
    if (qs[0].options.length < 2) {
      renderQuizSetup();
      return toast("クイズには意味の異なる語が2つ以上必要です");
    }
    quiz = { qs, i: 0, score: 0, combo: 0, best: 0, missed: [] };
    renderQuestion();
  }

  function renderQuestion(previousTap) {
    scroller.scrollTop = 0;
    if (quiz.i >= quiz.qs.length) return renderQuizResult();
    const q = quiz.qs[quiz.i];
    badgeEl.textContent = `Q ${quiz.i + 1} / ${quiz.qs.length}`;
    enterAnim();
    const isW2M = q.mode === "w2m";
    view.innerHTML = `
      <div class="progress-line"><i style="width:${(quiz.i / quiz.qs.length) * 100}%"></i></div>
      <div class="q-card glass">
        ${q.w.no !== null ? `<div class="q-no">${esc(noLabel(q.w))}</div>` : ""}
        <div class="q-kind">${isW2M ? "この語の意味は？" : "この意味を表す語は？"}</div>
        ${isW2M ? `<div class="q-word fit" style="${fitLen(q.w)}">${esc(q.w.word)}</div>` : `<div class="q-meaning">${esc(q.w.meaning)}</div>`}
      </div>
      <div class="options stagger">
        ${q.options.map((o, i) => `<button class="opt glass press ${isW2M ? "" : "serif"}" data-opt="${i}"><span class="no">${i + 1}</span><span>${esc(isW2M ? o.meaning : o.word)}</span></button>`).join("")}
      </div>
      <div id="fb"></div>`;
    stagger(view);
    // 「次へ」を素早く2回押したとき、2回目が次の問題の選択肢に当たって勝手に答えないようにする

    view.onclick = (e) => {
      const b = e.target.closest("[data-opt]");
      if (b && q.answered === null) {
        const repeatedTap = previousTap && e.detail > 0 && e.timeStamp - previousTap.timeStamp < 320 &&
          Math.hypot(e.clientX - previousTap.x, e.clientY - previousTap.y) < 16;
        if (!repeatedTap) answerQuiz(Number(b.dataset.opt));
      }
      if (e.target.closest("[data-act=next]")) {
        quiz.i++;
        renderQuestion(e.detail ? { timeStamp: e.timeStamp, x: e.clientX, y: e.clientY } : null);
      }
    };
  }

  function answerQuiz(idx) {
    const q = quiz.qs[quiz.i];
    q.answered = idx;
    const correct = q.options[idx] === q.w;
    const p = prog(q.w.word);
    if (correct) {
      quiz.score++;
      quiz.combo++;
      quiz.best = Math.max(quiz.best, quiz.combo);
      const streak = (p.streak || 0) + 1;
      logAnswer(q.w.word, true, "q", { ok: (p.ok || 0) + 1, streak, s: streak >= 2 ? MASTERED : Math.max(p.s || 0, LEARNING) });
    } else {
      quiz.combo = 0;
      quiz.missed.push(q.w);
      logAnswer(q.w.word, false, "q", { ng: (p.ng || 0) + 1, streak: 0, s: LEARNING });
    }
    $$(".opt", view).forEach((el, i) => {
      el.disabled = true;
      if (q.options[i] === q.w) el.classList.add("correct");
      else if (i === idx) el.classList.add("wrong");
      else el.classList.add("dim");
    });
    if (correct) burst($$(".opt", view)[idx], quiz.combo >= 3 ? 18 : 12);
    if (navigator.vibrate) navigator.vibrate(correct ? 12 : [20, 40, 20]);
    const last = quiz.i === quiz.qs.length - 1;
    $("#fb").innerHTML = `
      <div class="feedback glass">
        <div class="fb-head ${correct ? "ok" : "ng"}">${icon(correct ? "check" : "x")}${correct ? "正解！" : "不正解"}${correct && quiz.combo >= 2 ? `<span class="combo">${quiz.combo}連続</span>` : ""}</div>
        <div>${q.w.no !== null ? `<span class="fb-no">${esc(noLabel(q.w))}</span>` : ""}<b>${esc(q.w.word)}</b>${q.w.reading ? `（${esc(q.w.reading)}）` : ""}</div>
        <div style="margin-top:2px">${esc(q.w.meaning)}</div>
        ${q.w.example ? `<div style="margin-top:6px;color:var(--ink-2);font-family:var(--font-serif)">例）${esc(q.w.example)}</div>` : ""}
      </div>
      <div style="height:12px"></div>
      <button class="btn primary block press" data-act="next"><span>${last ? "結果を見る" : "次へ"}</span></button>`;
    $("#fb").scrollIntoView({ behavior: motionPreference.matches ? "auto" : "smooth", block: "nearest" });
  }

  function renderQuizResult() {
    badgeEl.textContent = "";
    enterAnim();
    const n = quiz.qs.length;
    const r = quiz.score / n;
    const msg = r === 1 ? "パーフェクト！" : r >= 0.8 ? "すばらしい！" : r >= 0.5 ? "いい調子。" : "復習してもう一度！";
    view.innerHTML = `
      <div class="glass result">
        <div class="badge-ico shine">${icon(r >= 0.8 ? "trophy" : "target")}</div>
        <div class="score"><span data-count="${quiz.score}">${quiz.score}</span><span style="font-size:28px"> / ${n}</span></div>
        <div class="msg">${msg}</div>
        <p class="note">正答率 ${Math.round(r * 100)}%${quiz.best >= 2 ? ` ・ 最高 ${quiz.best}連続正解` : ""}</p>
        <button class="btn primary block press" data-act="retry"><span>もう一度</span></button>
        ${quiz.missed.length ? `<div class="btn-row"><button class="btn glass press" data-act="miss"><span>間違えた${quiz.missed.length}問を解き直す</span></button></div>` : ""}
      </div>
      ${quiz.missed.length ? `<div class="section-title">間違えた語</div><div class="word-list" id="missList">${quiz.missed.map(wordRow).join("")}</div>` : ""}`;
    countUp();
    if (r >= 0.8) burst($(".badge-ico", view), 22);
    view.onclick = (e) => {
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "retry") renderQuizSetup();
      else startQuiz(shuffle(quiz.missed));
    };
    const ml = $("#missList");
    if (ml) bindWordRows(ml);
  }

  // ---------- 一覧 ----------
  const listOpts = { q: "", cat: "all", st: "all" };

  VIEWS.list = () => {
    view.innerHTML = `
      <label class="search glass">
        <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="q" type="search" placeholder="語・読み・意味・番号で検索" value="${esc(listOpts.q)}" autocomplete="off" enterkeyhint="search">
      </label>
      <div id="listCats">${catChips(listOpts.cat)}</div>
      <div id="listSt">${chipRow([["all", "すべて"], ["0", "未学習"], ["1", "学習中"], ["2", "覚えた"], ["star", "チェック"]], listOpts.st, "st")}</div>
      <div class="count-note" id="countNote"></div>
      <div class="word-list" id="wordList"></div>`;

    const listEl = $("#wordList");
    const renderList = () => {
      const q = listOpts.q.trim().toLowerCase();
      const ws = WORDS.filter((w) => {
        if (listOpts.cat !== "all" && w.category !== listOpts.cat) return false;
        const p = prog(w.word);
        if (listOpts.st === "star" && !p.star) return false;
        if (/^\d$/.test(listOpts.st) && (p.s || 0) !== Number(listOpts.st)) return false;
        if (q && String(w.no ?? "").toLowerCase() !== q.replace(/^no\.?\s*/, "") && !(w.word + w.reading + w.meaning + w.synonyms.join("") + w.antonyms.join("")).toLowerCase().includes(q)) return false;
        return true;
      });
      $("#countNote").textContent = `${ws.length}語 ・ 球の上が正解、下が不正解の回数`;
      listEl.innerHTML = ws.length ? ws.map(wordRow).join("") : `<div class="empty">見つかりませんでした</div>`;
    };
    renderList();
    bindWordRows(listEl, renderList);

    $("#q").addEventListener("input", (e) => { listOpts.q = e.target.value; renderList(); });
    view.onclick = (e) => {
      const cat = e.target.closest("[data-cat]");
      if (cat) {
        listOpts.cat = cat.dataset.cat;
        $$("[data-cat]", view).forEach((b) => b.classList.toggle("on", b === cat));
        return renderList();
      }
      const st = e.target.closest("[data-st]");
      if (st) {
        listOpts.st = st.dataset.st;
        $$("[data-st]", view).forEach((b) => b.classList.toggle("on", b === st));
        renderList();
      }
    };
  };

  // ---------- 苦手 ----------
  VIEWS.weak = () => {
    const render = () => {
      const ws = WORDS.filter((w) => isWeak(w.word));
      view.innerHTML = ws.length
        ? `<div class="glass setting">
            <h3>苦手な語 ${ws.length}語</h3>
            <p>カードやクイズで間違えた語と、チェックをつけた語がここに集まります。</p>
            <div class="btn-row" style="margin-top:0">
              <button class="btn glass press" data-act="cards"><span>${icon("cards")}カードで復習</span></button>
              <button class="btn primary press" data-act="quiz"><span>${icon("quiz")}クイズ</span></button>
            </div>
          </div>
          <div class="word-list" id="weakList">${ws.map(wordRow).join("")}</div>`
        : emptyCard("sparkle", "苦手な語はありません", "カードやクイズで間違えた語、チェックをつけた語がここに表示されます。");
      const wl = $("#weakList");
      if (wl) bindWordRows(wl, render);
      view.onclick = (e) => {
        const act = e.target.closest("[data-act]");
        if (!act) return;
        if (act.dataset.act === "cards") go("cards", { words: ws });
        else go("quiz", { words: shuffle(ws).slice(0, store.settings.quizCount) });
      };
    };
    render();
  };

  // ---------- 記録 ----------
  const recOpts = { scope: "subject" };

  VIEWS.records = () => {
    const sid = recOpts.scope === "subject" && SUBJ ? SID : null;
    const sm = summary(sid);
    const days = daily(sid, 14);
    const max = Math.max(1, ...days.map((d) => d.n));
    const tipText = (d) => `${d.today ? "今日" : `${d.m}/${d.day}`}　${d.n}問${d.n ? ` ・ 正答率 ${rate(d.ok, d.n)}%` : ""}`;
    const kpi = (ico, val, unit, label) =>
      `<div class="kpi glass">${icon(ico)}<b>${val === null ? "–" : `<span data-count="${val}">${val}</span><em>${unit}</em>`}</b><small>${label}</small></div>`;
    const recent = logOf(sid).slice(-40).reverse();

    // 教科別（全教科のとき）／単元別（教科を選んでいるとき）
    let breakdown = "";
    if (!sid) {
      breakdown = `<div class="section-title">教科別</div><div class="cat-list stagger">${SUBJECTS.map((s) => {
        const l = logOf(s.id);
        const ok = l.reduce((a, e) => a + e.ok, 0);
        const m = masteredIn(s);
        const pct = rate(m, s.words.length);
        return `<button class="cat-item glass press" data-subject="${esc(s.id)}" style="${subjStyle(s)}">
          <span class="subj-ini sm">${esc(subjInitial(s))}</span>
          <div class="grow">
            <div class="row-top"><span class="cat-name">${esc(s.name)}</span><span class="cat-count">${s.words.length ? `習得 ${pct}%` : "準備中"}</span></div>
            <div class="mini-bar subj"><i class="grow-x" style="width:${pct}%"></i></div>
            <div class="row-sub">${l.length ? `正答率 ${rate(ok, l.length)}% ・ ${l.length}問` : "まだ解いていません"}</div>
          </div>
        </button>`;
      }).join("")}</div>`;
    } else if (WORDS.length) {
      const catOf = new Map(WORDS.map((w) => [w.word, w.category]));
      const byCat = new Map();
      for (const e of logOf(SID)) {
        const c = catOf.get(e.w);
        if (!c) continue;
        const v = byCat.get(c) || { n: 0, ok: 0 };
        v.n++;
        v.ok += e.ok;
        byCat.set(c, v);
      }
      breakdown = `<div class="section-title">単元別</div><div class="cat-list stagger">${CATEGORIES.map((cat) => {
        const ws = WORDS.filter((w) => w.category === cat);
        const m = counts(ws)[MASTERED];
        const v = byCat.get(cat) || { n: 0, ok: 0 };
        return `<div class="cat-item glass">
          <div class="grow">
            <div class="row-top"><span class="cat-name">${esc(cat)}</span><span class="cat-count">習得 ${m} / ${ws.length}</span></div>
            <div class="mini-bar"><i class="grow-x" style="width:${(m / ws.length) * 100}%"></i></div>
            <div class="row-sub">${v.n ? `正答率 ${rate(v.ok, v.n)}% ・ ${v.n}問` : "まだ解いていません"}</div>
          </div>
        </div>`;
      }).join("")}</div>`;
    }

    view.innerHTML = `
      ${SUBJ ? `<div class="seg-ctl" role="tablist">${[["subject", SUBJ.name], ["all", "全教科"]].map(([v, l]) => `<button role="tab" aria-selected="${recOpts.scope === v}" class="${recOpts.scope === v ? "on" : ""}" data-scope="${v}">${esc(l)}</button>`).join("")}</div>` : ""}
      <div class="kpi-grid stagger">
        ${kpi("calendar", sm.tn, "問", "今日の解答")}
        ${kpi("flame", sm.streak, "日", "連続学習")}
        ${kpi("layers", sm.n, "問", "これまでの解答")}
        ${kpi("target", sm.n ? rate(sm.ok, sm.n) : null, "%", "正答率")}
      </div>

      <div class="glass chart-card">
        <div class="chart-head"><h3>直近14日の解答数</h3><span class="chart-tip" id="chartTip">${esc(tipText(days[days.length - 1]))}</span></div>
        <div class="bars">
          <span class="bars-max"><span>${max}問</span></span>
          ${days.map((d, i) => `<button class="bar-col ${d.today ? "today sel" : ""}" data-i="${i}" aria-label="${esc(tipText(d))}"><i class="bar" style="height:${d.n ? Math.max(3, (d.n / max) * 100) : 0}%;--i:${i}"></i></button>`).join("")}
        </div>
        <div class="bars-x">${days.map((d, i) => `<span>${d.today ? "今日" : i === 0 || i === 7 ? `${d.m}/${d.day}` : ""}</span>`).join("")}</div>
      </div>

      ${breakdown}

      <div class="section-title">最近の解答</div>
      ${recent.length
        ? `<div class="glass log-card">${recent.map((e) => {
            const s = subjectById(e.s);
            const open = e.s === SID && BY_WORD.has(e.w);
            return `<${open ? "button" : "div"} class="log-row ${e.ok ? "ok" : "ng"} ${open ? "press" : ""}" ${open ? `data-word="${esc(e.w)}"` : ""}>
              <span class="log-mark">${icon(e.ok ? "check" : "x")}</span>
              <div class="grow"><div class="log-w">${esc(e.w)}</div><div class="log-sub">${!sid && s ? `${esc(s.name)} ・ ` : ""}${e.m === "q" ? "クイズ" : "カード"} ・ ${e.ok ? "正解" : "不正解"}</div></div>
              <span class="log-t">${esc(relTime(e.t))}</span>
            </${open ? "button" : "div"}>`;
          }).join("")}</div>`
        : emptyCard("chart", "まだ記録がありません", "暗記カードや4択クイズで解くと、ここに履歴と正答率がたまっていきます。")}`;

    const tip = $("#chartTip");
    const pick = (col) => {
      if (!col) return;
      $$(".bar-col", view).forEach((b) => b.classList.toggle("sel", b === col));
      tip.textContent = tipText(days[Number(col.dataset.i)]);
    };
    $$(".bar-col", view).forEach((b) => b.addEventListener("pointerenter", () => pick(b)));
    view.onclick = (e) => {
      const sc = e.target.closest("[data-scope]");
      if (sc) { recOpts.scope = sc.dataset.scope; return rerender(); }
      const col = e.target.closest(".bar-col");
      if (col) return pick(col);
      const s = e.target.closest("[data-subject]");
      if (s) {
        recOpts.scope = "subject";
        if (s.dataset.subject === SID) return go("records");
        return switchSubject(s.dataset.subject, e.clientX, e.clientY);
      }
      const row = e.target.closest("[data-word]");
      if (row) openWordSheet(row);
    };
  };

  // 起動時の更新と設定からの更新を一つの要求にまとめる。
  let questionUpdate = null;
  function showUpdateState() {
    if (current !== "settings") return;
    $$("[data-act=refresh], [data-act=save], #tokenIn", view).forEach(el => { el.disabled = !!questionUpdate; });
    const message = $("#dataMsg", view);
    if (message && questionUpdate) { message.hidden = false; message.textContent = "読み込み中…"; }
  }

  async function refreshQuestions(token, manual = false) {
    if (questionUpdate) return;
    const controller = new AbortController();
    questionUpdate = controller;
    showUpdateState();
    try {
      const changed = await DATA.refresh(token, controller.signal);
      if (controller.signal.aborted) return;
      const tokenSaved = !token || DATA.setToken(token);
      if (changed) {
        if (OPEN_WHEN_EMPTY.includes(current) && !view.inert && !body.classList.contains("dragging")) {
          applyNewData();
          go(token && current === "settings" ? "home" : current);
          if (manual) toast("問題を読み込みました");
        } else {
          pendingData = true;
          toast("新しい問題を取得しました。ホームに戻ると反映されます");
        }
      } else if (manual) {
        if (current === "settings") rerender();
        toast("最新です");
      }
      if (!tokenSaved) toast("問題は保存しました。トークンは端末に保存できませんでした");
    } catch (error) {
      if (!controller.signal.aborted && (manual || current === "settings")) {
        const message = $("#dataMsg", view);
        if (message) { message.hidden = false; message.textContent = error.message; }
        else toast(error.message);
      }
    } finally {
      if (questionUpdate === controller) {
        questionUpdate = null;
        showUpdateState();
        const message = $("#dataMsg", view);
        if (message?.textContent === "読み込み中…") message.hidden = true;
      }
    }
  }

  // ---------- 設定 ----------
  VIEWS.settings = () => {
    const at = DATA.fetchedAt();
    const atLabel = at ? new Date(at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const tested = SUBJECTS.filter(hasTests);
    const empty = SUBJECTS.filter((s) => !s.all.length);
    const testChip = (s, t, n) => {
      const on = s.test === t;
      return `<button class="chip glass press ${on ? "on" : ""}" data-test-subj="${esc(s.id)}" data-test="${esc(t)}" aria-pressed="${on}"><span>${esc(testName(t))}<span class="chip-n">${n}</span></span></button>`;
    };
    view.innerHTML = `
      ${tested.length ? `<div class="glass setting">
        <h3>${icon("calendar")}テスト</h3>
        <p>教科ごとに、学習するテストを選びます。選んだテストの問題だけがホーム・カード・クイズ・一覧に出ます。ふだんは問題がある中でいちばん新しいテストになります。</p>
        <div class="test-list">
          ${tested.map((s) => `<div class="test-row" style="--accent:${s.color[0]};--accent-2:${s.color[1]}">
            <div class="test-subj"><span class="subj-dot"></span>${esc(s.name)}</div>
            <div class="test-chips">
              ${s.tests.map((t) => testChip(s, t, s.all.filter((w) => w.test === t).length)).join("")}
              ${s.tests.length > 1 ? testChip(s, ALL_TESTS, s.all.length) : ""}
            </div>
          </div>`).join("")}
        </div>
        ${empty.length ? `<p class="test-note">${empty.map((s) => esc(s.name)).join("・")}はまだ問題がありません。</p>` : ""}
      </div>` : ""}
      <div class="glass setting">
        <h3>${icon("refresh")}問題データ</h3>
        <p>${DATA.hasData()
          ? `${SUBJECTS.map((s) => `${esc(s.name)}（${s.all.length}）`).join(" / ")}<br>最終取得：${esc(atLabel)}`
          : "まだ読み込んでいません。"}</p>
        ${DATA.hasToken()
          ? `<div class="btn-row">
               <button class="btn press primary" data-act="refresh"><span>今すぐ更新</span></button>
               <button class="btn glass press" data-act="forget"><span>トークンを削除</span></button>
             </div>`
          : `<label class="search glass">
               <input aria-label="GitHub 読み取り用トークン" id="tokenIn" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
             </label>
             <button class="btn press primary block" data-act="save" style="margin-top:10px"><span>保存して読み込む</span></button>
             <p style="margin-top:12px">トークンの作り方：GitHub の <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token の作成画面</a> で、Repository access を「Only select repositories → ${esc(DATA.repo.split("/")[1])}」、Permissions の Contents を「Read-only」にして作成します。トークンはこの端末の中にだけ保存されます。</p>`}
        <p id="dataMsg" role="status" style="margin:10px 0 0" hidden></p>
      </div>
      ${WORDS.length ? `<div class="glass setting">
        <h3>${icon("book")}${esc(SUBJ.name)}の収録データ</h3>
        <p>${testLabel(SUBJ) ? `${esc(testLabel(SUBJ))} ・ ` : ""}${WORDS.length}語 ・ ${CATEGORIES.length}単元<br>${CATEGORIES.map(esc).join(" / ")}</p>
      </div>` : ""}
      <div class="glass setting">
        <h3>${icon("layers")}問題の追加</h3>
        <p><code>${esc(DATA.repo)}</code> の <code>subjects/</code> にある JSON に問題を足して push すると、次にアプリを開いたとき（または「今すぐ更新」）に反映されます。</p>
      </div>
      <div class="glass setting">
        <h3>${icon("home")}ホーム画面に追加</h3>
        <p>共有メニューから「ホーム画面に追加」すると、全画面のアプリとして使えます（ブラウザの「戻る」も出ません）。</p>
      </div>
      <div class="glass setting">
        <h3>${icon("x")}学習記録をリセット</h3>
        <p>進み具合・チェック・解答の履歴をこの端末から消去します。</p>
        <div class="btn-row" style="margin-top:0">
          ${SUBJ ? `<button class="btn glass press tint-bad" data-act="reset-subj"><span>${esc(SUBJ.name)}だけ</span></button>` : ""}
          <button class="btn glass press tint-bad" data-act="reset-all"><span>すべて</span></button>
        </div>
      </div>`;
    showUpdateState();
    view.onclick = (e) => {
      const chip = e.target.closest("[data-test]");
      if (chip) {
        const s = subjectById(chip.dataset.testSubj);
        if (!s || s.test === chip.dataset.test) return;
        setTest(s.id, chip.dataset.test);
        updateDrawerSub();
        const y = scroller.scrollTop;
        rerender();
        scroller.scrollTop = y;
        $(`[data-test-subj="${CSS.escape(s.id)}"][data-test="${CSS.escape(chip.dataset.test)}"]`, view)?.focus({ preventScroll: true });
        return toast(`${s.name}：${testName(s.test)}に切り替えました`);
      }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "save") {
        const token = $("#tokenIn").value.trim();
        if (!token) {
          const message = $("#dataMsg", view);
          message.hidden = false;
          message.textContent = "トークンを貼り付けてください。";
          return $("#tokenIn").focus();
        }
        $("#tokenIn").blur();
        return refreshQuestions(token, true);
      }
      if (a === "refresh") return refreshQuestions(undefined, true);
      if (a === "forget") {
        if (!confirm("この端末からトークンを削除しますか？（読み込み済みの問題と学習記録は残ります）")) return;
        questionUpdate?.abort();
        questionUpdate = null;
        DATA.clearToken();
        toast("トークンを削除しました");
        return rerender();
      }
      if (a === "reset-subj") {
        if (!confirm(`${SUBJ.name}の学習記録と解答履歴を消去しますか？`)) return;
        delete store.progress[SID];
        store.log = store.log.filter((x) => x.s !== SID);
      } else if (a === "reset-all") {
        if (!confirm("すべての教科の学習記録と解答履歴を消去しますか？")) return;
        store.progress = {};
        store.log = [];
      } else return;
      save();
      deck = null;
      toast("リセットしました");
      updateDrawerSub();
    };
  };

  // ============================================================
  // サイドバー（左→右スワイプ）＋ 戻る操作の抑止
  // ============================================================
  const body = document.body;
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  const isOpen = () => body.classList.contains("drawer-open");

  function syncOverlayAccess() {
    const drawerOpen = isOpen();
    const blocked = drawerOpen || sheetOpen() || subjMenuOpen();
    view.inert = blocked;
    $("#topbar").inert = blocked;
    drawer.inert = !drawerOpen;
    sheetWrap.inert = !sheetOpen();
    $("#subjMenu").inert = !subjMenuOpen();
  }

  function openDrawer() {
    toggleDrawerSubj(false);
    closeSubjMenu();
    body.classList.add("drawer-open");
    drawer.setAttribute("aria-hidden", "false");
    $("#menuBtn").setAttribute("aria-expanded", "true");
    syncOverlayAccess();
    $("#drawerNav .on")?.focus({ preventScroll: true });
    drawer.style.transform = "";
    scrim.style.opacity = "";
  }
  function closeDrawer() {
    body.classList.remove("drawer-open");
    syncOverlayAccess();
    $("#menuBtn").setAttribute("aria-expanded", "false");
    $("#menuBtn").focus({ preventScroll: true });
    drawer.setAttribute("aria-hidden", "true");
    drawer.style.transform = "";
    scrim.style.opacity = "";
  }

  $("#menuBtn").addEventListener("click", () => (isOpen() ? closeDrawer() : openDrawer()));
  scrim.addEventListener("click", closeDrawer);
  drawer.addEventListener("click", (e) => {
    if (e.target.closest("#drawerSubjBtn")) return toggleDrawerSubj();
    const s = e.target.closest("[data-subject]");
    if (s) {
      toggleDrawerSubj(false);
      closeDrawer();
      switchSubject(s.dataset.subject, e.clientX, e.clientY);
      return;
    }
    const b = e.target.closest("[data-nav]");
    if (!b) return;
    closeDrawer();
    go(b.dataset.nav);
  });

  // ホーム画面アプリ（全画面）かどうか。ブラウザの「戻る」スワイプ対策はブラウザで開いたときだけ要る
  const standalone = navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;

  const EDGE = 24; // iOS Safari の「戻る」スワイプが反応する左端の幅
  let g = null;

  function clearDrawerDrag() {
    g = null;
    body.classList.remove("dragging");
    drawer.style.transform = "";
    scrim.style.opacity = "";
    scrim.style.pointerEvents = "";
  }
  document.addEventListener("touchstart", (e) => {
    if (g) clearDrawerDrag();
    if (e.touches.length !== 1) {
      release(false);
      return;
    }
    if (sheetOpen() || subjMenuOpen() || e.target.closest("[data-noswipe], input, textarea, select")) return;
    const t = e.touches[0];
    // 端からの戻るだけを抑止する。ボタンのタップや単元の横スクロールはネイティブに任せる。
    const edge = !standalone && t.clientX < EDGE && !e.target.closest("button, a, [data-flip]");
    if (edge && e.cancelable) e.preventDefault();
    g = { x0: t.clientX, y0: t.clientY, x: t.clientX, t0: performance.now(),
      edge, mode: null, open: isOpen(), w: drawer.offsetWidth + 24 };
  }, { passive: false });

  document.addEventListener("touchmove", (e) => {
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    g.x = t.clientX;

    if (g.mode === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
      if (horizontal && (g.open ? dx < 0 : dx > 0)) {
        g.mode = "drawer";
        body.classList.add("dragging");
      } else {
        g.mode = "none";
      }
    }

    if (g.mode === "drawer") {
      if (e.cancelable) e.preventDefault();
      let p = g.open ? 1 + dx / g.w : dx / g.w;
      p = Math.max(0, Math.min(1, p));
      // 端まで引いたときのゴムのような抵抗
      const over = g.open ? 0 : Math.max(0, dx - g.w);
      drawer.style.transform = `translateX(${-(1 - p) * g.w + Math.sqrt(over) * 2}px)`;
      scrim.style.opacity = String(p);
      scrim.style.pointerEvents = "none";
      g.p = p;
    } else if (g.mode === "none" && g.edge && e.cancelable && Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("touchend", (e) => {
    if (!g) return;
    const gg = g;
    g = null;
    scrim.style.pointerEvents = "";

    if (gg.mode === "drawer") {
      body.classList.remove("dragging");
      const dt = Math.max(1, performance.now() - gg.t0);
      const v = (gg.x - gg.x0) / dt; // px/ms
      const shouldOpen = v > 0.35 ? true : v < -0.35 ? false : gg.p > 0.5;
      shouldOpen ? openDrawer() : closeDrawer();
      return;
    }

    // 端で止めたタッチがタップだった場合はクリックを補う
    if (gg.edge && gg.mode === null) {
      const t = e.changedTouches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
    }
  }, { passive: true });

  document.addEventListener("touchcancel", clearDrawerDrag);
  window.addEventListener("pagehide", clearDrawerDrag);

  // 履歴ガード：戻る操作が起きてもページを離れず、サイドバーの開閉に置き換える
  // ホーム画面アプリでは履歴が無ければスワイプで戻れないので、履歴を一切作らない
  // （ガード用の履歴を積むと、それ自体が「戻る」先になってしまう）
  const GUARD = { kotaelogGuard: true };
  const armGuard = () => {
    if (standalone) return;
    if (!(history.state && history.state.kotaelogGuard)) history.pushState(GUARD, "");
  };
  if (!standalone && !history.state?.kotaelogGuard) {
    history.replaceState({ ...history.state, kotaelogBase: true }, "");
    armGuard();
  }
  window.addEventListener("popstate", () => {
    armGuard();
    if (sheetOpen()) closeSheet();
    else if (subjMenuOpen()) closeSubjMenu();
    else if (isOpen()) closeDrawer();
    else openDrawer();
  });
  // ユーザー操作があるたびにガードを確認（操作なしの pushState を無視するブラウザ対策）
  ["click", "touchend", "keydown"].forEach((ev) => document.addEventListener(ev, armGuard, { passive: true }));

  // デスクトップ用：Esc で閉じる
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (subjMenuOpen()) closeSubjMenu();
    else if (sheetOpen()) closeSheet();
    else if (isOpen()) closeDrawer();
  });

  // ---------- 起動 ----------
  $("#drawerNav").innerHTML = NAV.map(([k, t, ic], i) => `<li style="--i:${i}"><button data-nav="${k}"><span class="ni">${icon(ic)}</span>${t}</button></li>`).join("");
  $("#subjPill").addEventListener("click", (e) => { e.stopPropagation(); subjMenuOpen() ? closeSubjMenu() : openSubjMenu(); });
  $("#menuScrim").addEventListener("click", closeSubjMenu);
  $("#subjMenu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-subject]");
    if (!b) return;
    closeSubjMenu();
    switchSubject(b.dataset.subject, e.clientX, e.clientY);
  });
  $("#subjMenu").addEventListener("keydown", event => {
    const options = $$(".subj-opt", event.currentTarget);
    const index = options.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "ArrowDown") next = (index + 1) % options.length;
    else if (event.key === "ArrowUp") next = (index + options.length - 1) % options.length;
    else return;
    event.preventDefault();
    options[next].focus();
  });
  syncOverlayAccess();
  renderChrome();

  // 現代文単語アプリ時代の記録を引き継いだら、新しいキーに保存して古いキーは消す
  try {
    if (localStorage.getItem(OLD_KEY) !== null && save()) {
      localStorage.removeItem(OLD_KEY);
    }
  } catch (_) {}

  go("home");

  if (DATA.hasToken()) refreshQuestions();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();

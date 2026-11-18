import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const words = [
  ["風", "空気の流れ", "自然"], ["月", "地球の衛星", "自然"],
  ["星", "夜空に光る天体", "自然"], ["ことば", "言葉", "文化"], ["言語", "言葉", "文化"],
];
const items = words.map(([word, meaning, category], i) => ({ no: i + 1, word, meaning, category }));
const subjects = [
  { id: "jp", name: "現代国語", items },
  { id: "art", name: "美術", items: items.slice(1) },
];

async function openHome(page, historySize = 0, url = "/") {
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "" }));
  await page.addInitScript(({ subjects, historySize }) => {
    if (localStorage.getItem("kotaelog.data.v1")) return;
    localStorage.setItem("kotaelog.data.v1", JSON.stringify({ subjects, fetchedAt: Date.now() }));
    const log = Array.from({ length: historySize }, (_, i) =>
      ({ s: "art", w: "月", t: i, m: "q", ok: 1 }));
    localStorage.setItem("kotaelog.store.v1", JSON.stringify({ log, settings: { cardShuffle: false } }));
  }, { subjects, historySize });
  await page.goto(url);
  await expect(page.locator(".hero-range")).toContainText("現代国語");
}

test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map(error => error.message)).toEqual([]);
});

test("初回ホームから接続設定と空の記録を開ける", async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "" }));
  await page.goto("/");
  await page.getByRole("button", { name: "問題データを接続" }).tap();
  await page.getByRole("button", { name: "保存して読み込む" }).tap();
  await expect(page.locator("#dataMsg")).toHaveText("トークンを貼り付けてください。");
  await page.locator('#dock [data-nav="records"]').tap();
  await expect(page.locator(".result")).toContainText("まだ記録がありません");
});

test("細い画面でドックが折り返さず、連打後も選択レンズと画面が一致する", async ({ page }) => {
  await openHome(page);
  for (const width of [320, 375, 430, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    for (const name of ["settings", "home", "records"]) {
      await page.locator(`#dock [data-nav="${name}"]`).dispatchEvent("click");
    }
    await expect(page.locator("#view")).toHaveAttribute("data-page", "records");
    await expect(page.locator("#dock [aria-current=page]")).toHaveAttribute("data-nav", "records");
    const buttons = await page.locator("#dock button").evaluateAll(tabs => tabs.map(tab => {
      const range = document.createRange();
      range.selectNodeContents(tab.querySelector("span"));
      const rect = tab.getBoundingClientRect();
      return range.getClientRects().length === 1 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth;
    }));
    expect(buttons).toEqual([true, true, true]);
    await expect.poll(() => page.locator("#dock").evaluate(dock => {
      const lens = dock.querySelector(".dock-lens").getBoundingClientRect();
      const selected = dock.querySelector("[aria-current]").getBoundingClientRect();
      return Math.max(Math.abs(lens.left - selected.left), Math.abs(lens.right - selected.right));
    })).toBeLessThan(1);
  }
});

test("全教科の記録から現在の教科を選び直せる", async ({ page }) => {
  await openHome(page);
  await page.locator('#dock [data-nav="records"]').tap();
  await page.locator('[data-scope="all"]').tap();
  await page.locator('#view [data-subject="jp"]').tap();
  await expect(page.locator('[data-scope="subject"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("単元別", { exact: true })).toBeVisible();
});

test("カード判定を連打しても1件だけ記録し、履歴上限でも取り消せる", async ({ page }) => {
  await openHome(page, 8000);
  await page.locator('[data-go="cards"]').tap();
  await page.locator('[data-act="start"]').tap();
  const answer = page.locator('[data-ans="1"]');
  await answer.evaluate(button => { button.click(); button.click(); });
  await expect(page.locator("#topBadge")).toHaveText("2 / 5");
  await page.locator('[data-act="undo"]').tap();
  await expect(page.locator("#topBadge")).toHaveText("1 / 5");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kotaelog.store.v1")));
  expect(saved.log.length).toBe(8000);
  expect(saved.log.some(entry => entry.s === "jp")).toBe(false);
  expect(saved.log[0].t).toBe(0);
  expect(saved.progress.jp["風"]?.s || 0).toBe(0);
});

test("教科メニューの操作中とキー長押しで裏のカードが採点されない", async ({ page }) => {
  await openHome(page);
  await page.locator('[data-go="cards"]').tap();
  await page.locator('[data-act="start"]').tap();
  await page.locator("#subjPill").tap();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#topBadge")).toHaveText("1 / 5");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: true, bubbles: true })));
  await expect(page.locator("#topBadge")).toHaveText("1 / 5");
});

test("次カードの準備前に単元を切り替えても例外が出ない", async ({ page }) => {
  await openHome(page);
  await page.locator('[data-go="cards"]').tap();
  // 同じフレームのうちに画面とデッキが破棄される場合。
  await page.evaluate(() => {
    for (const selector of ['[data-act="start"]', "#menuBtn", '#drawer [data-nav="home"]', '[data-unit="自然"]']) {
      document.querySelector(selector).click();
    }
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator(".hero-range")).toContainText("自然");
});

test("動きを減らす設定ではカードをすぐ裏返せる", async ({ page }) => {
  await openHome(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-go="cards"]').tap();
  await page.locator('[data-act="start"]').tap();
  const result = await page.locator("#flip").evaluate(flip => {
    flip.querySelector("[data-flip]").click();
    return { back: flip.dataset.back, animations: flip.getAnimations().length };
  });
  expect(result).toEqual({ back: "1", animations: 0 });
});

test("ドックのドラッグは指を離した場所で確定し、中断すると元に戻る", async ({ page }) => {
  await openHome(page);
  const home = await page.locator('#dock [data-nav="home"]').boundingBox();
  const settings = await page.locator('#dock [data-nav="settings"]').boundingBox();
  const y = home.y + home.height / 2;
  await page.mouse.move(home.x + home.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(settings.x + settings.width / 2, y, { steps: 8 });
  await expect(page.locator("#dock")).toHaveClass(/scrubbing/);
  await expect(page.locator("#view")).toHaveAttribute("data-page", "home");
  await page.mouse.up();
  await expect(page.locator("#view")).toHaveAttribute("data-page", "settings");
  await page.mouse.down();
  await page.mouse.move(home.x + home.width / 2, y, { steps: 6 });
  await page.locator("#dock button").evaluateAll(buttons => {
    const owner = buttons.find(button => button.hasPointerCapture(1));
    if (owner) owner.releasePointerCapture(1);
  });
  await page.mouse.move(home.x + 3, y);
  await page.mouse.up();
  await expect(page.locator("#dock")).not.toHaveClass(/scrubbing/);
  await expect(page.locator("#dock [aria-current]")).toHaveAttribute("data-nav", "settings");
});

test("横スクロールや途中で中断したスワイプでドロワーが残らない", async ({ page }) => {
  await openHome(page);
  const state = await page.evaluate(() => {
    function touch(target, type, points) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { touches: points.map(x => ({ clientX: x, clientY: 180 })) });
      target.dispatchEvent(event);
    }
    const strip = document.querySelector(".unit-strip");
    touch(strip, "touchstart", [70]);
    touch(strip, "touchmove", [150]);
    const stripDrag = document.body.classList.contains("dragging");
    touch(strip, "touchcancel", []);
    touch(document.body, "touchstart", [60]);
    touch(document.body, "touchmove", [230]);
    const started = document.body.classList.contains("dragging");
    touch(document.body, "touchstart", [230, 250]);
    return { stripDrag, started, dragging: document.body.classList.contains("dragging"),
      transform: document.querySelector("#drawer").style.transform };
  });
  expect(state).toEqual({ stripDrag: false, started: true, dragging: false, transform: "" });
  await page.locator("#menuBtn").tap();
  await expect(page.locator("#menuBtn")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#menuBtn")).toBeFocused();
});

test("一覧から詳細をキーボードで開き、状態変更後も元の語に戻れる", async ({ page }) => {
  await openHome(page);
  await page.locator('[data-go="list"]').tap();
  await page.locator("#q").fill("風");
  const row = page.locator('#view [data-word="風"]');
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.locator('#sheet [data-s="2"]').tap();
  await expect(page.locator('#sheet [data-s="2"]')).toHaveClass("on");
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await expect(page.locator("#view")).toHaveJSProperty("inert", false);
});

test("クイズは同じ意味を誤答にせず、最初のタップを受け付ける", async ({ page }) => {
  await openHome(page);
  await page.locator('[data-go="quiz"]').tap();
  await page.locator('[data-unit="文化"]').tap();
  await page.locator('[data-mode="w2m"]').tap();
  const options = await page.evaluate(() => {
    document.querySelector('[data-act="start"]').click();
    const choices = Array.from(document.querySelectorAll(".opt"));
    const labels = choices.map(button => button.lastElementChild.textContent);
    choices[labels.indexOf("言葉")].click();
    return labels;
  });
  expect(new Set(options).size).toBe(options.length);
  await expect(page.locator("#fb")).toContainText("正解！");
  await page.locator('[data-act="next"]').tap();
  await expect(page.locator("#topBadge")).toHaveText("Q 2 / 2");
  await page.locator(".opt").filter({ hasText: "言葉" }).tap();
  await page.locator('[data-act="next"]').tap();
  await expect(page.locator(".result .note")).toContainText("正答率 100%");
});

test("読み込み中に画面を離れても学習を中断せず、更新は一度だけ反映する", async ({ page }) => {
  await openHome(page);
  let releaseIndex;
  const hold = new Promise(resolve => { releaseIndex = resolve; });
  let requests = 0;
  await page.route("https://api.github.com/**", async route => {
    if (route.request().url().endsWith("/index.json")) {
      requests++;
      await hold;
      await route.fulfill({ json: { subjects: [{ id: "jp", name: "新しい国語", file: "jp.json" }] } });
    } else await route.fulfill({ json: { items } });
  });
  await page.locator('#dock [data-nav="settings"]').tap();
  await page.locator("#tokenIn").fill("local-test-only");
  await page.locator('[data-act="save"]').evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('[data-act="save"]')).toBeDisabled();
  await page.locator('#dock [data-nav="home"]').tap();
  await page.locator('[data-go="cards"]').tap();
  await page.locator('[data-act="start"]').tap();
  releaseIndex();
  await expect(page.locator("#toast")).toContainText("ホームに戻ると反映");
  await expect(page.locator("#topBadge")).toHaveText("1 / 5");
  await page.locator("#menuBtn").tap();
  await page.locator('#drawer [data-nav="home"]').tap();
  await expect(page.locator(".hero-range")).toContainText("新しい国語");
  expect(requests).toBe(1);
});

test("問題を保存できないときは元のデータを保ち、同じ設定で再試行できる", async ({ page }) => {
  await openHome(page);
  await page.route("https://api.github.com/**", route => route.fulfill({
    json: route.request().url().endsWith("/index.json")
      ? { subjects: [{ id: "jp", name: "新しい国語", file: "jp.json" }] } : { items },
  }));
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "kotaelog.data.v1") {
        Storage.prototype.setItem = write;
        throw new DOMException("容量不足", "QuotaExceededError");
      }
      return write.call(this, key, value);
    };
  });
  await page.locator('#dock [data-nav="settings"]').tap();
  await page.locator("#tokenIn").fill("local-test-only");
  await page.locator('[data-act="save"]').tap();
  await expect(page.locator("#dataMsg")).toContainText("保存できません");
  expect(await page.evaluate(() => window.KOTAE_DATA.subjects()[0].name)).toBe("現代国語");
  expect(await page.evaluate(() => localStorage.getItem("kotaelog.token"))).toBeNull();
  await page.locator('[data-act="save"]').tap();
  await expect(page.locator(".hero-range")).toContainText("新しい国語");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kotaelog.data.v1")).subjects[0].name)).toBe("新しい国語");
});

test("再読み込みを繰り返しても戻るための履歴が増えない", async ({ page }) => {
  await openHome(page);
  const initial = await page.evaluate(() => history.length);
  await page.reload();
  await expect(page.locator(".hero-range")).toBeVisible();
  await page.reload();
  await expect(page.locator(".hero-range")).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(initial);
});

test.describe("オフライン起動", () => {
  test.use({ serviceWorkers: "allow" });
  test("初回のインストール後にオフラインで開き直せる", async ({ page }) => {
    // テスト専用の配信元を停止し、両エンジンで実際の接続失敗を発生させる。
    const server = spawn("python3", ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1"], {
      cwd: new URL("../", import.meta.url), stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      const [banner] = await once(server.stdout, "data");
      const port = /port (\d+)/.exec(banner.toString())[1];
      const origin = `http://127.0.0.1:${port}`;
      await page.goto(origin + "/manifest.webmanifest");
      await page.evaluate(() => caches.open("another-app"));
      await openHome(page, 0, origin);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
        }
      });
      expect(await page.evaluate(() => caches.has("another-app"))).toBe(true);
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
      const response = await page.goto(origin + "/?offline");
      expect(response.fromServiceWorker()).toBe(true);
      await expect(page.locator(".hero-range")).toContainText("現代国語");
      await page.locator('#dock [data-nav="records"]').tap();
      await expect(page.locator(".chart-head")).toContainText("直近14日");
    } finally {
      if (!server.killed) server.kill();
    }
  });
});

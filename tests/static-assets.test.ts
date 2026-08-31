import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { VK_ASSET_ALIASES } from "../src/static-assets";

const root = path.resolve(__dirname, "..");

describe("VK asset aliases", () => {
  it("каждый алиас указывает на существующий канонический файл", () => {
    for (const relativeFile of Object.values(VK_ASSET_ALIASES)) {
      expect(fs.existsSync(path.join(root, "public", relativeFile))).toBe(true);
    }
  });

  it("game.html использует версионированные алиасы", () => {
    const html = fs.readFileSync(path.join(root, "public", "game.html"), "utf8");
    for (const route of ["/js/tg-bridge-vk.js", "/js/catclick-vk.js"]) {
      expect(html).toMatch(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=\\d+`));
    }
    expect(html).toContain("!new URLSearchParams(location.search).has('vk_app_id')");
  });

  it("голуби и гонки загружаются лениво, а не вместе со стартовым экраном", () => {
    const html = fs.readFileSync(path.join(root, "public", "game.html"), "utf8");
    const clicker = fs.readFileSync(path.join(root, "public", "js", "catclick.js"), "utf8");
    expect(html).not.toContain("catdove-v57.js");
    expect(html).not.toContain("catdrag-v28.js");
    expect(clicker).toContain("loadGameScript('/js/catdove-v57.js', 'CatDove')");
    expect(clicker).toContain("loadGameScript('/js/catdrag-v28.js', 'CatDrag')");
    expect(clicker).toContain("window.ckLoadCatDrag = ensureDragModule");
  });

  it("VK bridge сохраняет исходную launch-строку для всех API-запросов", () => {
    const bridge = fs.readFileSync(path.join(root, "public", "js", "tg-bridge.js"), "utf8");
    expect(bridge).toContain("const _vkLaunchParams = IS_VK ? location.search.slice(1) : '';");
    expect(bridge).toContain("Authorization: 'vk ' + _vkLaunchParams");
    expect(bridge).toContain("h['x-vk-user'] = encodeURIComponent(JSON.stringify(");
    expect(bridge).not.toContain("Authorization: 'vk ' + location.search.slice(1)");
  });

  it("первичная загрузка профиля повторяется после временного сетевого сбоя", () => {
    const clicker = fs.readFileSync(path.join(root, "public", "js", "catclick.js"), "utf8");
    expect(clicker).toContain("async function loadInitialServerState(path)");
    expect(clicker).toContain("for (let attempt = 0; attempt < 3; attempt++)");
    expect(clicker).toContain("loadInitialServerState('/api/clicker' + q)");
  });

  it("объясняет связку VK и Telegram прямо в игровом интерфейсе", () => {
    const clicker = fs.readFileSync(path.join(root, "public", "js", "catclick.js"), "utf8");
    expect(clicker).toContain("Один аккаунт в VK и Telegram");
    expect(clicker).toContain("Один прогресс в VK и Telegram");
    expect(clicker).toContain("/api/account-link/status");
  });

  it("не возвращает тяжёлый полный рендер в цикл тапов", () => {
    const clicker = fs.readFileSync(path.join(root, "public", "js", "catclick.js"), "utf8");
    expect(clicker).toContain("performance.now() - lastFullRenderAt >= 1000");
    expect(clicker).toContain("const LOOP_FRAME_BUDGET = 1 / 20");
    expect(clicker).toContain("/api/clicker/tasks-overview");
    expect(clicker).toContain("void maybePurchaseBonus(); }, 3500");
    expect(clicker).toContain("if (!s) return false;");
  });

  it("не возвращает Дом Василия и старые мини-игры", () => {
    const html = fs.readFileSync(path.join(root, "public", "game.html"), "utf8");
    const clicker = fs.readFileSync(path.join(root, "public", "js", "catclick.js"), "utf8");
    expect(html).not.toMatch(/cat(?:pet|feed|game)\.js/);
    expect(clicker).not.toContain('data-goto="home"');
    expect(clicker).not.toContain("catPetOpen");
    for (const removed of [
      "/api/clicker/game",
      "/api/clicker/rain",
      "/api/clicker/cipher",
      "renderGames",
      "openGamesHub",
      "QUIZ_KIDS",
      "ck-rain",
      "ck-quiz",
      "ck-mem",
      "ck-tower",
      "ck-gems",
    ]) expect(clicker).not.toContain(removed);
  });

  it("закрывает устаревшие игровые API и не запрашивает их прогресс при старте", () => {
    const routes = fs.readFileSync(path.join(root, "src", "routes", "clicker.ts"), "utf8");
    const clicker = fs.readFileSync(path.join(root, "src", "clicker.ts"), "utf8");
    for (const route of ["/api/clicker/game-attempt", "/api/clicker/rain", "/api/clicker/game", "/api/clicker/cipher"]) {
      expect(routes).toContain(route);
    }
    expect(routes).toContain('res.status(410).json({ error: "removed" })');
    const initialLoad = clicker.slice(clicker.indexOf("export async function getClicker"), clicker.indexOf("export async function tapClicker"));
    expect(initialLoad).not.toContain("gamesDoneToday");
  });

  it("разделяет игровой URL, фоновые задачи и защищает синхронизацию блокировкой", () => {
    const index = fs.readFileSync(path.join(root, "src", "index.ts"), "utf8");
    const purchases = fs.readFileSync(path.join(root, "src", "purchase1c.ts"), "utf8");
    expect(index).toContain("process.env.GAME_PUBLIC_URL ?? MINI_APP_URL");
    expect(index).toContain("process.env.PURCHASE_SYNC_WORKER ?? \"true\"");
    expect(purchases).toContain("pg_try_advisory_lock(71031, 2611)");
    expect(purchases).toContain("pg_advisory_unlock(71031, 2611)");
  });
});

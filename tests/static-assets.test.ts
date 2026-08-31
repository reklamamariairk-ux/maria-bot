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
    for (const route of Object.keys(VK_ASSET_ALIASES)) {
      expect(html).toMatch(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=\\d+`));
    }
  });

  it("VK bridge сохраняет исходную launch-строку для всех API-запросов", () => {
    const bridge = fs.readFileSync(path.join(root, "public", "js", "tg-bridge.js"), "utf8");
    expect(bridge).toContain("const _vkLaunchParams = IS_VK ? location.search.slice(1) : '';");
    expect(bridge).toContain("Authorization: 'vk ' + _vkLaunchParams");
    expect(bridge).not.toContain("Authorization: 'vk ' + location.search.slice(1)");
  });

  it("первичная загрузка профиля повторяется после временного сетевого сбоя", () => {
    const clicker = fs.readFileSync(path.join(root, "public", "js", "catclick.js"), "utf8");
    expect(clicker).toContain("async function loadInitialServerState(path)");
    expect(clicker).toContain("for (let attempt = 0; attempt < 3; attempt++)");
    expect(clicker).toContain("loadInitialServerState('/api/clicker' + q)");
  });
});

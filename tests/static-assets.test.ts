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
});

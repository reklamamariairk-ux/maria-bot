import type { Express } from "express";
import path from "path";

/**
 * VK WebView агрессивно держит старые JS-бандлы. game.html использует отдельные
 * URL-алиасы, а сервер отдаёт по ним канонические файлы. Так алиасы не нужно
 * создавать вручную на каждом сервере и они не расходятся с исходниками.
 */
export const VK_ASSET_ALIASES = {
  "/js/tg-bridge-vk.js": "js/tg-bridge.js",
  "/js/catclick-vk.js": "js/catclick.js",
  // Тяжёлые механики грузятся только при первом открытии соответствующего
  // раздела. Имя URL содержит версию, поэтому WebView может хранить файл год.
  "/js/catdove-v57.js": "js/catdove.js",
  "/js/catdrag-v28.js": "js/catdrag.js",
} as const;

export function registerVkAssetAliases(app: Express, publicDir: string): void {
  for (const [route, relativeFile] of Object.entries(VK_ASSET_ALIASES)) {
    app.get(route, (_req, res) => {
      // URL меняется через ?v=N в game.html, поэтому конкретную версию можно
      // безопасно кэшировать надолго даже внутри упрямого VK WebView.
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(path.join(publicDir, relativeFile));
    });
  }
}

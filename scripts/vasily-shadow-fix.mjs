// Фикс белёсых теней под котами: светло-серая «тень на белом фоне» из исходника
// конвертируется в тёмную полупрозрачную (unmultiply: серый L на белом ≡ чёрный с альфой 255−L).
// Захват — flood-fill от прозрачных пикселей ТОЛЬКО в нижней полосе холста (пол),
// по нейтрально-серым светлым пикселям; цветные лапы и одежда выше полосы не задеваются.
// Запуск: node scripts/vasily-shadow-fix.mjs [--write]  (без --write пишет превью в scratchpad)
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const CAT_DIR = "public/assets/images/cat";
const PREVIEW_DIR = "C:/Users/user/AppData/Local/Temp/claude/C--Users-user/3de7e9c1-6cc3-42de-bbb4-37d54bbfc4e2/scratchpad/shadow-fix";
const WRITE = process.argv.includes("--write");
const BAND_Y = 515;          // полоса пола: только здесь ищем/правим тень
const FEATHER = 40;          // сила эффекта 0→1 на первых 40px полосы (защита кромок одежды)
const GRAY_DIFF = 45, GRAY_MIN = 118;  // слабонасыщенный светлый = тень (бывает тёплой)
const SHADOW_RGB = [28, 20, 16];       // тёплый тёмный, под палитру сцен
const ALPHA_CAP = 150;

if (!WRITE) fs.mkdirSync(PREVIEW_DIR, { recursive: true });

for (const file of fs.readdirSync(CAT_DIR).filter((f) => /^vasily-stage\d+\.webp$/.test(f))) {
  const { data, info } = await sharp(fs.readFileSync(path.join(CAT_DIR, file))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const isGray = (i) => {
    const o = i * C, r = data[o], g = data[o + 1], b = data[o + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mx - mn <= GRAY_DIFF && mn >= GRAY_MIN;
  };
  const mark = new Uint8Array(W * H);
  const q = [];
  for (let y = BAND_Y; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (data[i * C + 3] <= 20) { mark[i] = 1; q.push(i); }
  }
  let hit = 0, minY = H;
  while (q.length) {
    const i = q.pop(); const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < BAND_Y || ny >= H) continue;
      const j = ny * W + nx;
      if (mark[j]) continue;
      if (data[j * C + 3] > 20 && isGray(j)) {
        mark[j] = 2; q.push(j); hit++;
        if (ny < minY) minY = ny;
      } else if (data[j * C + 3] <= 20) { mark[j] = 1; q.push(j); }
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (mark[i] !== 2) continue;
    const o = i * C, y = (i / W) | 0;
    const w = Math.min(1, (y - BAND_Y) / FEATHER);  // 0 у верха полосы → 1 к полу
    const L = (data[o] + data[o + 1] + data[o + 2]) / 3;
    const a2 = Math.min(ALPHA_CAP, Math.round((255 - L) * 1.15));
    const target = Math.round(Math.min(data[o + 3], a2) * (data[o + 3] / 255));
    // смешение: при w<1 частично сохраняем исходный цвет/альфу
    data[o]     = Math.round(data[o]     + (SHADOW_RGB[0] - data[o])     * w);
    data[o + 1] = Math.round(data[o + 1] + (SHADOW_RGB[1] - data[o + 1]) * w);
    data[o + 2] = Math.round(data[o + 2] + (SHADOW_RGB[2] - data[o + 2]) * w);
    data[o + 3] = Math.round(data[o + 3] + (target - data[o + 3]) * w);
  }
  const out = WRITE ? path.join(CAT_DIR, file) : path.join(PREVIEW_DIR, file);
  const tmp = out + ".tmp.webp";
  await sharp(data, { raw: { width: W, height: H, channels: C } }).webp({ quality: 90 }).toFile(tmp);
  fs.renameSync(tmp, out);
  console.log(`${file}: shadow px=${hit}, minY=${minY === H ? "-" : minY}${WRITE ? " [written]" : ""}`);
}
console.log(WRITE ? "written to prod dir" : `previews in ${PREVIEW_DIR}`);

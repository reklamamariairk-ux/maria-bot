// Реген-хвост арт-комплекта: 3 кота (stage7/9/16) + 4 фона (career-13..16)
// из scratchpad/flow-regen → сразу в прод-папки (webp).
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const SRC = "C:/Users/user/AppData/Local/Temp/claude/C--Users-user/3de7e9c1-6cc3-42de-bbb4-37d54bbfc4e2/scratchpad/flow-regen";
const CAT_OUT = "public/assets/images/cat";
const SCENE_OUT = "public/assets/images/scene";
const CANVAS_W = 640, CANVAS_H = 600, CONTENT_H = 560, MAX_W = 636, BOTTOM_PAD = 10;

async function cutoutCat(file) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const N = W * H;
  const bg = new Uint8Array(N);
  const isBg = (i) => { const o = i * C, r = data[o], g = data[o + 1], b = data[o + 2]; return Math.min(r, g, b) >= 226 && Math.max(r, g, b) - Math.min(r, g, b) <= 18; };
  const q = new Int32Array(N); let qt = 0;
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (isBg(i) && !bg[i]) { bg[i] = 1; q[qt++] = i; } }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (isBg(i) && !bg[i]) { bg[i] = 1; q[qt++] = i; } }
  let qh = 0;
  while (qh < qt) {
    const i = q[qh++]; const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      if (!bg[j] && isBg(j)) { bg[j] = 1; q[qt++] = j; }
    }
  }
  for (let i = 0; i < N; i++) if (bg[i]) data[i * C + 3] = 0;
  for (let i = 0; i < N; i++) {
    if (bg[i] || data[i * C + 3] === 0) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && bg[ny * W + nx]) { data[i * C + 3] = Math.min(data[i * C + 3], 140); break; }
    }
  }
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * C + 3] > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const cropped = await sharp(data, { raw: { width: W, height: H, channels: C } }).extract({ left: minX, top: minY, width: cw, height: ch }).png().toBuffer();
  const scale = Math.min(CONTENT_H / ch, MAX_W / cw);
  const nw = Math.round(cw * scale), nh = Math.round(ch * scale);
  const resized = await sharp(cropped).resize(nw, nh).png().toBuffer();
  const left = Math.round((CANVAS_W - nw) / 2), top = CANVAS_H - BOTTOM_PAD - nh;
  const out = file.replace(".png", ".webp");
  await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left, top }])
    .webp({ quality: 90 })
    .toFile(path.join(CAT_OUT, out));
  return `${out}: content ${cw}x${ch} -> ${nw}x${nh}`;
}

const files = fs.readdirSync(SRC);
for (const f of files.filter((x) => x.startsWith("vasily-stage"))) console.log(await cutoutCat(f));
for (const f of files.filter((x) => x.startsWith("career-"))) {
  const out = f.replace(".png", ".webp");
  await sharp(path.join(SRC, f)).resize({ width: 720 }).webp({ quality: 80 }).toFile(path.join(SCENE_OUT, out));
  console.log(f + " -> " + out);
}
console.log("done");

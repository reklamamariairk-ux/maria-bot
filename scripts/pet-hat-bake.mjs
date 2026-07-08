// Впекание шляп в кадры кота «Дома кота» (catpet).
// Меряет якорь головы по альфе каждого кадра, сажает шляпу с пер-шляпными
// параметрами {k: ширина от ширины головы, overlap: насколько шляпа налезает
// на голову долей своей высоты}, пишет <frame>-<hatId>.png рядом с исходниками.
// Запуск: node scripts/pet-hat-bake.mjs [--only idle,happy] [--debug]
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const DIR = path.resolve("public/assets/images/cat");

// Кадры и ручные поправки к автоякорю (доли ширины/высоты ГОЛОВЫ): dx>0 — вправо, dy>0 — вниз.
const FRAMES = {
  "idle.png":  { dx: 0.00, dy: 0.00 },
  "happy.png": { dx: 0.00, dy: 0.00 },
  "full.png":  { dx: 0.00, dy: 0.00 },
  "walk1.png": { dx: 0.00, dy: 0.00 },
  "walk2.png": { dx: 0.00, dy: 0.00 },
  "walk3.png": { dx: 0.00, dy: 0.00 },
  "walk4.png": { dx: 0.00, dy: 0.00 },
};

// k — ширина шляпы от измеренной ширины головы; overlap — доля высоты шляпы,
// заходящая НИЖЕ верхушки головы (0 = стоит на макушке).
const HATS = {
  detective: { img: "hat-detective.png", k: 1.25, overlap: 0.55 },
  pirate:    { img: "hat-pirate.png",    k: 1.40, overlap: 0.45 },
  wizard:    { img: "hat-wizard.png",    k: 1.05, overlap: 0.35 },
  crown:     { img: "hat-crown.png",     k: 0.90, overlap: 0.32 },
};

// Якорь головы: топ альфа-контента + центр/ширина альфы на срезе чуть ниже макушки.
async function headAnchor(file) {
  const img = sharp(path.join(DIR, file)).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const alphaAt = (x, y) => data[(y * W + x) * C + 3];
  let top = -1, bottom = -1;
  for (let y = 0; y < H && top < 0; y++) for (let x = 0; x < W; x++) if (alphaAt(x, y) > 40) { top = y; break; }
  for (let y = H - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < W; x++) if (alphaAt(x, y) > 40) { bottom = y; break; }
  const contentH = bottom - top;
  // Срез на 12% высоты контента ниже макушки — уровень «лба» (ниже кончиков ушей).
  const yScan = Math.min(H - 1, Math.round(top + contentH * 0.12));
  let L = -1, R = -1;
  for (let x = 0; x < W; x++) if (alphaAt(x, yScan) > 40) { if (L < 0) L = x; R = x; }
  if (L < 0) throw new Error(`no alpha at scan row for ${file}`);
  return { W, H, top, contentH, headCx: (L + R) / 2, headW: R - L };
}

const only = (process.argv.find((a) => a.startsWith("--only")) || "").split("=")[1];
const frames = Object.keys(FRAMES).filter((f) => !only || only.split(",").some((o) => f.startsWith(o)));

for (const frame of frames) {
  const a = await headAnchor(frame);
  const t = FRAMES[frame];
  for (const [hatId, h] of Object.entries(HATS)) {
    const hatMeta = await sharp(path.join(DIR, h.img)).metadata();
    const hw = Math.round(a.headW * h.k);
    const hh = Math.round(hatMeta.height * (hw / hatMeta.width));
    const hat = await sharp(path.join(DIR, h.img)).resize({ width: hw }).toBuffer();
    const left = Math.round(a.headCx + t.dx * a.headW - hw / 2);
    const topPx = Math.round(a.top + t.dy * a.headW - hh * (1 - h.overlap));
    // ЕДИНЫЙ запас сверху 25% высоты холста у ВСЕХ шляпных вариантов — рантайм
    // компенсирует одной константой HAT_PAD=1.25 (иначе кот менял бы масштаб).
    const padTop = Math.round(a.H * 0.25);
    if (topPx + padTop < 0) console.warn(`⚠ ${frame}+${hatId}: шляпа выше запаса на ${-(topPx + padTop)}px — будет подрезана`);
    const out = path.join(DIR, frame.replace(".png", `-${hatId}.webp`));
    await sharp(path.join(DIR, frame))
      .extend({ top: padTop, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .composite([{ input: hat, left: Math.max(0, Math.min(a.W - hw, left)), top: Math.max(0, topPx + padTop) }])
      .webp({ quality: 90, alphaQuality: 90 })
      .toFile(out);
    console.log(`${path.basename(out)}: canvas ${a.W}x${a.H + padTop}, hat ${hw}px at (${left},${topPx + padTop}), headW=${a.headW}, top=${a.top}`);
  }
}
console.log("done");

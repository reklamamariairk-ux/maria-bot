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
// scanFrac — на какой доле высоты контента мерить ширину/центр головы;
// topFrac — где (долей высоты контента) находится МАКУШКА (0 = верх контента;
// нужно для поз, где выше головы торчат лапы/хвост).
const FRAMES = {
  "idle.png":  { dx: 0.00, dy: 0.00, scanFrac: 0.12, topFrac: 0.00, region: [0, 1] },
  "happy.png": { dx: 0.00, dy: 0.00, scanFrac: 0.13, topFrac: 0.00, region: [0.25, 0.75] },
  "full.png":  { dx: -0.06, dy: 0.20, scanFrac: 0.14, topFrac: 0.00, region: [0, 0.45] },
  // Четвероногий профиль: хвост поднят выше головы, голова в правой части кадра —
  // top и скан меряем только в правой трети (region по X, доли ширины холста).
  "walk1.png": { dx: 0.00, dy: 0.00, scanFrac: 0.14, topFrac: 0.00, region: [0.6, 1] },
  "walk2.png": { dx: 0.00, dy: 0.00, scanFrac: 0.14, topFrac: 0.00, region: [0.6, 1] },
  "walk3.png": { dx: 0.00, dy: 0.00, scanFrac: 0.14, topFrac: 0.00, region: [0.6, 1] },
  "walk4.png": { dx: 0.00, dy: 0.00, scanFrac: 0.14, topFrac: 0.00, region: [0.6, 1] },
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
async function headAnchor(file, t) {
  const img = sharp(path.join(DIR, file)).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const alphaAt = (x, y) => data[(y * W + x) * C + 3];
  const [xa, xb] = t.region || [0, 1];
  const X0 = Math.round(W * xa), X1 = Math.round(W * xb);
  let top = -1, bottom = -1;
  for (let y = 0; y < H && top < 0; y++) for (let x = X0; x < X1; x++) if (alphaAt(x, y) > 40) { top = y; break; }
  for (let y = H - 1; y >= 0 && bottom < 0; y--) for (let x = X0; x < X1; x++) if (alphaAt(x, y) > 40) { bottom = y; break; }
  const contentH = bottom - top;
  // Срез на scanFrac высоты контента ниже верха — уровень «лба» (ниже кончиков ушей/лап).
  const yScan = Math.min(H - 1, Math.round(top + contentH * t.scanFrac));
  let L = -1, R = -1;
  for (let x = X0; x < X1; x++) if (alphaAt(x, yScan) > 40) { if (L < 0) L = x; R = x; }
  if (L < 0) throw new Error(`no alpha at scan row for ${file}`);
  // Макушка головы: верх контента + topFrac (для поз с лапами выше головы).
  const headTop = Math.round(top + contentH * t.topFrac);
  return { W, H, top: headTop, contentH, headCx: (L + R) / 2, headW: R - L };
}

const only = (process.argv.find((a) => a.startsWith("--only")) || "").split("=")[1];
const frames = Object.keys(FRAMES).filter((f) => !only || only.split(",").some((o) => f.startsWith(o)));

for (const frame of frames) {
  const t = FRAMES[frame];
  const a = await headAnchor(frame, t);
  for (const [hatId, h] of Object.entries(HATS)) {
    const hatMeta = await sharp(path.join(DIR, h.img)).metadata();
    const hw = Math.min(a.W, Math.round(a.headW * h.k));
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

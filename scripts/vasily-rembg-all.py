# Пере-вырез всех 19 котов через rembg (ML-matting, без белой каймы цветового
# flood-fill) + синтетическая тень-эллипс (одинаковая у всех, тёмная под сцены).
# Исходники: scratchpad/flow-assets + поверх flow-regen (7/9/13/16 — реген без «М»).
# Выход: public/assets/images/cat/vasily-stageN.webp (640x600, рост 560, низ -10).
import os
from rembg import remove, new_session
from PIL import Image, ImageDraw, ImageFilter

SP = r"C:/Users/user/AppData/Local/Temp/claude/C--Users-user/3de7e9c1-6cc3-42de-bbb4-37d54bbfc4e2/scratchpad"
OUT = "public/assets/images/cat"
CANVAS_W, CANVAS_H, CONTENT_H, MAX_W, BOTTOM_PAD = 640, 600, 560, 636, 10

session = new_session("u2net")

for n in range(1, 20):
    f = f"vasily-stage{n}.png"
    src = os.path.join(SP, "flow-regen", f)
    if not os.path.exists(src):
        src = os.path.join(SP, "flow-assets", f)
    img = Image.open(src).convert("RGBA")
    cut = remove(img, session=session)

    bbox = cut.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox()
    cut = cut.crop(bbox)
    cw, ch = cut.size
    scale = min(CONTENT_H / ch, MAX_W / cw)
    nw, nh = round(cw * scale), round(ch * scale)
    cut = cut.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    left, top = (CANVAS_W - nw) // 2, CANVAS_H - BOTTOM_PAD - nh

    # синтетическая тень: мягкий тёмный эллипс под котом
    sh = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    rx = int(nw * 0.44)
    cx, cy = CANVAS_W // 2, CANVAS_H - 8
    d.ellipse([cx - rx, cy - 13, cx + rx, cy + 13], fill=(28, 20, 16, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(7))
    canvas.alpha_composite(sh)

    canvas.alpha_composite(cut, (left, top))
    canvas.save(os.path.join(OUT, f"vasily-stage{n}.webp"), "WEBP", quality=90)
    print(f"stage{n}: {cw}x{ch} -> {nw}x{nh} src={os.path.basename(os.path.dirname(src))}")

print("done")

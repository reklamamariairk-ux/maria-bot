# Вырезка 17 пород голубей из белого фона в прозрачные 512x512 webp (in place).
# rembg u2net + alpha-matting; у полупрозрачных краевых пикселей убираем примесь белого
# (decontaminate), объект bbox-кропится и прижимается к низу — единая базовая линия
# для трассы драг-заезда и карточек голубятни.
# Запуск из корня репо: python scripts/pigeon-art/cutout-all.py
import glob
import os

import numpy as np
from PIL import Image
from rembg import new_session, remove

DIR = "public/img/pigeons"
S, PAD, BOTTOM = 512, 0.06, 0.04
session = new_session("u2net")

for fp in sorted(glob.glob(os.path.join(DIR, "*.webp"))):
    img = Image.open(fp).convert("RGBA")
    cut = remove(
        img, session=session, alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=15,
        alpha_matting_erode_size=10,
    )
    a = np.asarray(cut).astype(np.float32)
    alpha = a[..., 3:4] / 255.0
    edge = (alpha > 0) & (alpha < 1)
    decont = np.clip((a[..., :3] - 255.0 * (1 - alpha)) / np.maximum(alpha, 0.04), 0, 255)
    a[..., :3] = np.where(edge, decont, a[..., :3])
    cut = Image.fromarray(a.astype(np.uint8))
    bbox = cut.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
    if not bbox:
        print(fp, "SKIP: пустая альфа")
        continue
    cut = cut.crop(bbox)
    box = int(S * (1 - 2 * PAD))
    scale = min(box / cut.width, box / cut.height)
    cut = cut.resize((round(cut.width * scale), round(cut.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.alpha_composite(cut, ((S - cut.width) // 2, S - int(S * BOTTOM) - cut.height))
    canvas.save(fp, "WEBP", quality=90)
    print(fp, "ok")

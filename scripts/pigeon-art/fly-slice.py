# Нарезка спрайт-листов полёта (2x5 от Gemini) в полосы кадров для катдрага.
# Вход:  <src>/<breed>.png — лист 2 ряда x 5 колонок, белый фон.
# Выход: public/img/pigeons/fly/<breed>.webp — горизонтальная полоса квадратных кадров
#        (192x192), кадры отсортированы по положению крыльев (вверх -> вниз), клиент
#        играет пинг-понгом. Правый нижний кадр листа отбрасывается (спаркл-вотермарка
#        Gemini сидит на птице). Кадры вырезаются rembg + decontaminate как в cutout-all.
# Запуск из корня репо: python scripts/pigeon-art/fly-slice.py <папка с листами> [breed ...]
import glob
import os
import sys

import numpy as np
from PIL import Image
from rembg import new_session, remove

SRC = sys.argv[1]
ONLY = set(sys.argv[2:])
OUT_DIR = "public/img/pigeons/fly"
CELL = 192
os.makedirs(OUT_DIR, exist_ok=True)
session = new_session("u2net")


def bands(mask, axis):
    """Полосы подряд идущих строк/колонок, где есть не-белое (для сетки листа)."""
    proj = mask.any(axis=axis)
    out, start = [], None
    for i, v in enumerate(proj):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i)); start = None
    if start is not None:
        out.append((start, len(proj)))
    return [(a, b) for a, b in out if b - a > 24]  # мусор/точки отсекаем


def cutout(img):
    cut = remove(img, session=session, alpha_matting=True,
                 alpha_matting_foreground_threshold=240,
                 alpha_matting_background_threshold=15, alpha_matting_erode_size=10)
    a = np.asarray(cut).astype(np.float32)
    alpha = a[..., 3:4] / 255.0
    edge = (alpha > 0) & (alpha < 1)
    decont = np.clip((a[..., :3] - 255.0 * (1 - alpha)) / np.maximum(alpha, 0.04), 0, 255)
    a[..., :3] = np.where(edge, decont, a[..., :3])
    return Image.fromarray(a.astype(np.uint8))


for fp in sorted(glob.glob(os.path.join(SRC, "*.png"))):
    breed = os.path.splitext(os.path.basename(fp))[0]
    if ONLY and breed not in ONLY:
        continue
    sheet = Image.open(fp).convert("RGB")
    arr = np.asarray(sheet)
    nonwhite = arr.min(axis=2) < 238
    rows = bands(nonwhite, axis=1)
    cells = []
    for (y0, y1) in rows:
        for (x0, x1) in bands(nonwhite[y0:y1], axis=0):
            cells.append((x0, y0, x1, y1))
    if len(cells) < 6:
        print(breed, f"SKIP: найдено ячеек {len(cells)} (<6) — лист битый"); continue
    # правый-нижний кадр (вотермарка на птице) — вон
    br = max(cells, key=lambda c: (c[3], c[2]))
    cells = [c for c in cells if c != br]

    frames = []
    for (x0, y0, x1, y1) in cells:
        pad = 6
        crop = sheet.crop((max(0, x0 - pad), max(0, y0 - pad), min(sheet.width, x1 + pad), min(sheet.height, y1 + pad)))
        cut = cutout(crop.convert("RGBA"))
        al = np.asarray(cut.getchannel("A")).astype(np.float32)
        bbox = cut.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
        if not bbox:
            continue
        ys, xs = np.nonzero(al > 20)
        cx, cy = float(xs.mean()), float(ys.mean())
        top, bot = cy - bbox[1], bbox[3] - cy
        score = (top - bot) / max(1.0, bbox[3] - bbox[1])  # >0 — крылья вверх
        frames.append({"img": cut.crop(bbox), "cx": cx - bbox[0], "cy": cy - bbox[1], "score": score})
    if len(frames) < 5:
        print(breed, f"SKIP: живых кадров {len(frames)} (<5)"); continue

    frames.sort(key=lambda f: -f["score"])  # крылья сверху -> снизу; клиент играет пинг-понг
    # Ручной выброс бракованных кадров (индексы ПОСЛЕ сортировки). Списки живут ровно
    # одну партию листов: после перегенерации 30.07.2026 старые индексы обнулены —
    # чистка новых листов делается отдельным проходом по контактному листу.
    DROP = {}
    frames = [f for i, f in enumerate(frames) if i not in DROP.get(breed, [])]
    # общий масштаб на все кадры (относительные размеры поз сохраняются)
    max_dim = max(max(f["img"].width, f["img"].height) for f in frames)
    scale = (CELL * 0.94) / max_dim
    strip = Image.new("RGBA", (CELL * len(frames), CELL), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        w, h = round(f["img"].width * scale), round(f["img"].height * scale)
        im = f["img"].resize((max(1, w), max(1, h)), Image.LANCZOS)
        # центрируем по центроиду альфы — тело стоит на месте, машут только крылья
        px = i * CELL + round(CELL / 2 - f["cx"] * scale)
        py = round(CELL / 2 - f["cy"] * scale)
        px = min(max(px, i * CELL), i * CELL + CELL - im.width)
        py = min(max(py, 0), CELL - im.height)
        strip.alpha_composite(im, (px, py))
    out = os.path.join(OUT_DIR, breed + ".webp")
    strip.save(out, "WEBP", quality=84)
    print(breed, f"ok: {len(frames)} кадров ->", out)

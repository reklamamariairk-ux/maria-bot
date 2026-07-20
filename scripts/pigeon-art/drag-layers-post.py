# Пост-обработка сгенерённых слоёв драг-трассы (scratchpad/drag-layers/{sky,city}.png):
# sky  — кроп центральной полосы (срезаем зеркальные поля Gemini и спаркл-вотермарку) → RGB webp.
# city — кроп (спаркл справа-снизу, лишний белый верх) + white-key в альфу:
#        линейная альфа по дистанции от белого (точный decontaminate тонких линий-проводов)
#        + принудительная непрозрачность внутри силуэта (эрозия жёсткой маски MinFilter —
#        окна остаются плотными, 1-2px провода — полупрозрачными тёмными).
# Бесшовность горизонтального тайла делает КЛИЕНТ (mirror-tile при pre-render в catdrag.js).
# Запуск из корня репо: python scripts/pigeon-art/drag-layers-post.py <папка с sky.png и city.png>
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = "public/img/drag"
os.makedirs(OUT, exist_ok=True)

# ── sky: центральная полоса без зеркальных полей (с запасом от граничной линии) ──
sky = Image.open(os.path.join(SRC, "sky.png")).convert("RGB")
sky = sky.crop((142, 0, 882, sky.height))
sky.save(os.path.join(OUT, "sky.webp"), "WEBP", quality=78)
print("sky.webp", sky.size)

# ── city: кроп + white-key ──
city = Image.open(os.path.join(SRC, "city.png")).convert("RGB")
city = city.crop((0, 80, 918, city.height))
a = np.asarray(city).astype(np.float32)
dist = 255.0 - a.min(axis=2)          # 0 = чистый белый, ~229 = сплошной силуэт
SOLID = 229.0
alpha = np.clip(dist / (SOLID * 0.9), 0.0, 1.0)  # линейная оценка настоящей доли переднего плана
# жёсткая маска (силуэт + окна + провода) → эрозия 5x5 выбивает тонкие провода,
# оставляя тело силуэта и окна; там альфа принудительно 1 (окна не должны сквозить)
hard = Image.fromarray(((dist > 60) * 255).astype(np.uint8))
interior = np.asarray(hard.filter(ImageFilter.MinFilter(5))).astype(np.float32) / 255.0
alpha = np.maximum(alpha * (dist > 6), interior)
al3 = alpha[..., None]
rgb = np.where((al3 > 0.02) & (al3 < 0.98),
               np.clip((a - 255.0 * (1 - al3)) / np.maximum(al3, 0.04), 0, 255), a)
out = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
Image.fromarray(out, "RGBA").save(os.path.join(OUT, "city.webp"), "WEBP", quality=82)
print("city.webp", city.size)

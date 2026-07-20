# Редизайн визуала «Драг-заезда» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сцена драг-заезда голубей перестаёт выглядеть дёшево: прозрачные спрайты вместо белых квадратов (по всей голубятне), закатный город с параллаксом, ощущение скорости, полноэкранная сцена, финиш и результат в кадре.

**Architecture:** Только клиент (`public/js/catdrag.js` + ассеты). Два арт-слоя (небо/город) pre-render'ятся в offscreen-тайлы и стримятся параллаксом; при отсутствии файлов — процедурный fallback тех же слоёв. Голуби — rembg-вырезки с альфой по прежним путям `/img/pigeons/` с бампом `?v=2`. Сервер и API не трогаем.

**Tech Stack:** Canvas 2D, rembg 2.0.76 (Python 3.11, u2net), sharp (Node), Gemini app по CDP (`scripts/pigeon-art/gemini-nbp-driver.mjs`), harness `public/_drag_harness.html` + CDP-скрины.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-07-20-drag-race-visual-redesign-design.md`.
- Сервер (`src/drag.ts`), API-контракты, замер реакции — НЕ менять.
- Кэш-бастеры: `/img/pigeons/*.webp?v=1 → ?v=2` во всех потребителях одновременно; `catdrag.js?v=1 → ?v=2` в `game.html` И `index.html` синхронно.
- Слои: `public/img/drag/sky.webp` (×0.2), `public/img/drag/city.webp` (×0.5), суммарно ≤300 КБ, бесшовный горизонтальный тайл (mirror-tile).
- 60fps: слои pre-rendered, частицы из пула ≤80, `shadowBlur` только у своего голубя. `prefers-reduced-motion` → без частиц/спидлайнов/встряски.
- Вывеска на городе — «МАРИЯ» кириллицей (или без текста, если генерация коверкает буквы).
- Проверка каждой визуальной задачи — harness-скрины (сервер на 8765, Chrome headless CDP 9222, скрипт `scratchpad/cdp-drag-shots.mjs`).

---

### Task 1: Прозрачные вырезки 17 голубей + бамп v=2

**Files:**
- Create: `scripts/pigeon-art/cutout-all.py`
- Modify: `public/img/pigeons/*.webp` (17 файлов, те же имена)
- Modify: `public/js/catdrag.js:47` (artSrc v=2), `public/js/catdove.js` (все `/img/pigeons/...v=1`), `public/js/catclick.js:1917`

**Interfaces:**
- Produces: webp 512² RGBA, объект bbox-кропнут (порог альфы 20), вписан с полем 6%, прижат к низу с отступом 4% — единая базовая линия для трассы.

- [ ] **Step 1: Бэкап исходников** в scratchpad сессии (`cp public/img/pigeons/*.webp <scratchpad>/pigeons-orig/`).
- [ ] **Step 2: Написать `scripts/pigeon-art/cutout-all.py`** по паттерну `scripts/vasily-rembg-all.py`:

```python
# Вырезка 17 пород голубей из белого фона в прозрачные 512x512 webp (in place).
# Правка краёв от белого ореола: у полупрозрачных краевых пикселей убираем примесь белого.
import os, glob
import numpy as np
from rembg import remove, new_session
from PIL import Image

DIR = "public/img/pigeons"
S, PAD, BOTTOM = 512, 0.06, 0.04
session = new_session("u2net")

for fp in sorted(glob.glob(os.path.join(DIR, "*.webp"))):
    img = Image.open(fp).convert("RGBA")
    cut = remove(img, session=session, alpha_matting=True,
                 alpha_matting_foreground_threshold=240,
                 alpha_matting_background_threshold=15, alpha_matting_erode_size=10)
    a = np.asarray(cut).astype(np.float32)
    alpha = a[..., 3:4] / 255.0
    edge = (alpha > 0) & (alpha < 1)
    a[..., :3] = np.where(edge, np.clip((a[..., :3] - 255.0 * (1 - alpha)) / np.maximum(alpha, 0.04), 0, 255), a[..., :3])
    cut = Image.fromarray(a.astype(np.uint8))
    bbox = cut.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
    cut = cut.crop(bbox)
    box = int(S * (1 - 2 * PAD))
    scale = min(box / cut.width, box / cut.height)
    cut = cut.resize((round(cut.width * scale), round(cut.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    canvas.alpha_composite(cut, ((S - cut.width) // 2, S - int(S * BOTTOM) - cut.height))
    canvas.save(fp, "WEBP", quality=90)
    print(fp, "ok")
```

- [ ] **Step 3: Прогнать**, собрать контактный лист (маленький html: 17 img на тёмном и светлом фоне) и посмотреть глазами: нет отъеденных лап/белой каймы. Брак породы → подбор параметров matting для неё.
- [ ] **Step 4: Бамп v=2**: во всех ссылках `/img/pigeons/*.webp?v=1`. Проверка: `grep -rn "img/pigeons" public/ | grep v=1` → пусто.
- [ ] **Step 5: Harness-скрин сетапа** — карточки уже без белых квадратов (подложки — Task 6).
- [ ] **Step 6: Commit** `feat: прозрачные вырезки голубей (rembg) + v=2 во всех потребителях`.

### Task 2: Фоновые слои sky/city (генерация + mirror-tile)

**Files:**
- Create: `public/img/drag/sky.webp`, `public/img/drag/city.webp`
- Create: `scripts/pigeon-art/drag-layers-tile.mjs` (пост-обработка sharp)

**Interfaces:**
- Produces: sky ~1024×512 (непрозрачный), city ~2048×400 (альфа, низ силуэта непрозрачный) — оба бесшовно тайлятся по X.

- [ ] **Step 1: Генерация** через `gemini-nbp-driver.mjs` (грабли CDP из памяти: фокус-эмуляция, клик по aria-кнопке, blob→canvas). Промпты: закатное небо с тёплыми облаками в палитре золото/карамель, без земли; лента силуэта вечернего города (крыши/трубы/провода с птичками, тёплые окна, вывеска «МАРИЯ»), стиль мягкой 3D-иллюстрации как арт голубей.
- [ ] **Step 2: Пост-обработка `drag-layers-tile.mjs`**: кроп полезной полосы, mirror-tile (кадр + flop встык), resize до целевых размеров, webp q80, у city — вырезать небо в альфу (по верхней границе силуэта, если генерация дала фон — flood-similar сверху либо градиентная маска). Проверить суммарный вес ≤300 КБ.
- [ ] **Step 3: Тайл-проверка**: маленький html с `background-repeat:repeat-x` обоих слоёв — шва не видно.
- [ ] **Step 4: Commit** `feat: закатные параллакс-слои трассы драг-заезда`.
- Fallback (генерация недоступна): пропустить задачу, сцена работает на процедурных слоях (Task 3); вернуться позже.

### Task 3: Сцена — полноэкранный канвас, параллакс-слои, дорога

**Files:**
- Modify: `public/js/catdrag.js` (setupCanvasSize, drawScene, drawClouds/drawSkyline → слои, CSS `.cd-drag-canvas`/`.cd-drag-race`)

**Interfaces:**
- Produces: `layers = {sky, city}` — `{img, tile: OffscreenCanvas|Canvas, ok}`; `drawLayer(name, scrollX)` рисует тайл со сдвигом, при `ok===false` — процедурный fallback (богатый закатный градиент + двухслойный силуэт с золотыми окнами). `groundTop = round(H*0.40)`.

- [ ] **Step 1:** Канвас на всю высоту: `.cd-drag-race{flex:1;min-height:0}`, `.cd-drag-canvas{height:100%}`; `setupCanvasSize()` берёт `wrap.clientHeight` (fallback 420), дорожки занимают `H-groundTop`, лейны считаются от фактической высоты (убрать фикс 58px/лейн — лейны растягиваются, спрайт ≤ min(laneH*0.82, 64)).
- [ ] **Step 2:** Загрузка слоёв `/img/drag/sky.webp`, `/img/drag/city.webp` при open() (кэш-модуль как artCache); pre-render в canvas-тайл шириной кратной экрану. Отрисовка: sky ×0.2 (fill сверху до groundTop+небольшой перехлёст), city ×0.5 (низ ленты на groundTop). onerror → процедурный fallback слоя.
- [ ] **Step 3:** Дорога: тёплый асфальт с вертикальным градиентом глубины, золотая пунктирная разметка (как была), лёгкая виньетка (radial rgba поверх, дёшево — pre-render в тайл-канвас виньетки один раз на resize).
- [ ] **Step 4:** Harness-скрины: сетап/заезд — сцена на весь экран, город/небо едут с разной скоростью, чёрной пустоты нет.
- [ ] **Step 5: Commit** `feat: полноэкранная сцена драга с закатными параллакс-слоями`.

### Task 4: Голуби — наклон, взмах, частицы, спидлайны

**Files:**
- Modify: `public/js/catdrag.js` (drawPigeon, tick, пул частиц)

**Interfaces:**
- Produces: `spawnDust(x,y,strong)`, `stepParticles(dt)`, `drawParticles()` — пул ≤80, объекты переиспользуются (индекс свободных); `reducedMotion` — модульный флаг `matchMedia('(prefers-reduced-motion: reduce)')`.

- [ ] **Step 1:** drawPigeon: `ctx.rotate(-tilt)` где tilt = до ~0.17 рад пропорционально текущей скорости (производная frac), squash-stretch: `scaleY = 1 + 0.04*sin(ts/90*2)` в противофазе бобу; спрайт рисуется через save/translate/rotate/scale. Флип по направлению арта (проверить на первом скрине: голуби должны «смотреть» вправо; если арт влево — `scale(-1,1)`).
- [ ] **Step 2:** Частицы пыли/пёрышек за бегущими (2-3/кадр у быстрых, сильнее у своего), физика: x дрейф назад со скоростью мира, y лёгкий подъём, fade 400-700мс, размер 2-4px, цвета песочно-золотые rgba.
- [ ] **Step 3:** Спидлайны: 8-12 штрихов, `globalAlpha~0.1`, скорость ×1.4 камеры, длина 40-90px, только в фазе animating.
- [ ] **Step 4:** `reducedMotion` → шаги 2-3 и встряска (Task 5) выключены, наклон/боб остаются.
- [ ] **Step 5:** Harness-скрин середины заезда: наклонённые голуби, шлейф пыли, спидлайны. FPS-прикидка: в CDP `Runtime.evaluate` счётчик rAF за 2с ≥ ~55.
- [ ] **Step 6: Commit** `feat: скорость в кадре — наклон/взмах голубей, пыль, спидлайны`.

### Task 5: Старт-ёлка, встряска, прогресс-бар позиций, бейджи мест

**Files:**
- Modify: `public/js/catdrag.js` (runCountdown/armTap DOM-плашка, tick/drawScene, CSS ёлки)

**Interfaces:**
- Produces: DOM `.cd-drag-tree` (3 красных + зелёный огонь, класс `on` по шагам отсчёта); `shake = {t0, amp}` — смещение камеры ±3px 250мс на GO; `drawProgressBar(fracs, list)` — линия сверху канваса с точками (мой — золотой, крупнее); `finishBadges[i]` — место, зафиксированное при frac==1, рисуется над голубем.

- [ ] **Step 1:** runCountdown: плашка = столбик светофора (3 красных огня загораются на 3/2/1, зелёный на СТАРТ) + крупная цифра рядом (существующие классы cd-drag-cd остаются). Тайминги/armTap/onTap НЕ менять.
- [ ] **Step 2:** Встряска: на «СТАРТ!» `shake.t0=ts`; в drawScene смещение `dx,dy = amp*sin(...)*(1-t/250ms)` через ctx.translate до отрисовки мира (после — restore). При reducedMotion — нет.
- [ ] **Step 3:** Прогресс-бар: тонкая полоска (2-3px) с флажком финиша справа, точки-позиции всех участников по fracs; отрисовка каждый кадр поверх сцены.
- [ ] **Step 4:** Бейджи мест: при достижении frac 1 у racers[i] запомнить порядок пересечения (или взять r.place с сервера — он уже есть) и рисовать кружок с цифрой над голубем; мой — золотой.
- [ ] **Step 5:** Harness-скрины отсчёта и финиша. **Step 6: Commit** `feat: старт-ёлка, встряска, прогресс позиций и бейджи мест`.

### Task 6: Финиш-арка, конфетти, финальная камера, подиум результата, карточки сетапа

**Files:**
- Modify: `public/js/catdrag.js` (drawFinish → арка, камера в конце, renderResult подиум, cardHtml/CSS подложки)

**Interfaces:**
- Produces: камера в финале кламптся так, что арка на ~72% ширины и все racers в кадре у линии; `podiumHtml(racers)` — топ-3 на пьедесталах 2-1-3.

- [ ] **Step 1:** Арка: две стойки + перекладина в шашечку через ширину дорожек, рисуется на x финиша (×1.0 мира).
- [ ] **Step 2:** Камера: `camX = min(camX, worldL - W*0.72... )` — в конце анимации мир останавливается так, что финиш на 72% ширины; racers при frac=1 стоят у линии (x = finishX - небольшой разброс по месту), не за экраном.
- [ ] **Step 3:** Конфетти при myPlace==1: 40-60 частиц сверху, 1.5с, цвета бренд-золото/крем/бордо (в reducedMotion — нет).
- [ ] **Step 4:** renderResult: подиум топ-3 (спрайты, высоты 2-1-3, номера), крупно место и `±монеты`, кнопки как были.
- [ ] **Step 5:** Карточки сетапа: `.cd-drag-card__art` и `.cd-drag-my__art` — радиальный градиент по редкости (common серый / rare бронза / epic фиолет / legendary золото, тона существующих рамок), белый фон убран.
- [ ] **Step 6:** Harness полный цикл скринов: сетап → отсчёт → середина → финиш → результат; глазами. **Step 7: Commit** `feat: финиш-арка, подиум, карточки без белых квадратов`.

### Task 7: Регрессы, версии, деплой, прод-чек

**Files:**
- Modify: `public/game.html`, `public/index.html` (catdrag.js?v=2)

- [ ] **Step 1:** Бамп `catdrag.js?v=1 → ?v=2` в game.html (preload + script) И index.html.
- [ ] **Step 2:** `npm i --no-save playwright` (если нет) → `node scripts/game-page-smoke.js` и `node scripts/vk_port_smoke.js` — зелёные. `npx vitest run` — зелёные.
- [ ] **Step 3:** Убедиться что `public/_drag_harness.html` НЕ закоммичен (untracked). Commit финальный + push (dual-push по правилам репо).
- [ ] **Step 4:** Деплой: `ssh -i ~/.ssh/maria_prod root@145.223.121.47 'cd /opt/maria/maria-bot && git pull && cd .. && docker compose up -d --build maria-bot'`.
- [ ] **Step 5:** `bash scripts/smoke.sh` (8 проверок) + curl нового арта: `curl -sk -o NUL -w '%{http_code} %{size_download}' https://bot.145-223-121-47.sslip.io/img/pigeons/sizar.webp?v=2` — размер отличается от старого; `/img/drag/sky.webp` 200.
- [ ] **Step 6:** Обновить память (memo maria-bot + session_log).

# Тюнинг голубя + дивизионы гонки — дизайн

Дата: 2026-07-15. Статус: дизайн одобрен устно. Расширяет Гонку стаи (`PIGEON_RACE_ENABLED`, уже в проде) из спеки `2026-07-14-pigeon-market-design.md`.

## Цель

Дать игрокам прокачивать гоночного голубя за игровые монеты и осмысленно соревноваться, при этом не дать «китам» навечно забетонировать топ. Гонка становится состязанием вложений с защитой через лиги-дивизионы и потолки характеристик.

Решения (зафиксированы с пользователем):
- Прокачка = **3 характеристики за игровые монеты** (не таймеры, не мини-игра, не предметы).
- Гонка **почти детерминированная**: вложение решает, случай — небольшой азарт в близких дуэлях.
- Анти-кит = **лиги-дивизионы + потолки уровней** (не недельный сброс формы).
- Прокачка **не сбрасывается** — это прогресс. Реальных наград нет (как и у всей голубятни v1).

## Механика

### Три характеристики (на пару игрок+порода)

Тюнинг привязан к `(chat_id, breed)` — вкладываешь в конкретного гонщика. Три характеристики, каждая 0..`TUNE_MAX`(=10) уровней:
- **Скорость** (`tune_speed`) — плоская прибавка к очкам.
- **Выносливость** (`tune_stamina`) — плоская прибавка к очкам.
- **Удача** (`tune_luck`) — расширяет верхнюю границу случайного рывка (стратегия: грубая сила vs разброс).

Цена следующего уровня: `TUNE_BASE_COST × TUNE_COST_MULT^currentLevel` = `500 × 1.7^level` монет (как бизнес-карты кликера). Округление вниз. Списывается из баланса кликера в транзакции; при потолке — отказ `max_level`.

### Формула гонки (почти детерминированная)

```
score = RARITY_BASE[rarity]        // 10/16/22/28 — как сейчас, второстепенно
      + 4 × (stars − 1)            // звёзды из дублей
      + 6 × tune_speed             // до +60
      + 6 × tune_stamina           // до +60
      + floor(r × (3 + 2×tune_luck))   // рывок 0..3 (без удачи) .. 0..23 (удача 10)
```
где `r ∈ [0,1)` = `Math.random()` со стороны вызывающего (чистота ради тестов). `6×speed`/`6×stamina` доминируют над рывком → вложение решает; на потолке (10/10/10) детерминированная часть у всех равна, решают звёзды и рывок. Хорошо прокачанный common МОЖЕТ обойти непрокачанного legendary — редкость не гейтит победу.

`enterRace` фиксирует очки в момент заявки по текущим характеристикам (снапшот), птица не тратится, 1 заявка/неделю (PK week+chat_id — как сейчас).

### Дивизионы

Рейтинг силы `powerRating = tune_speed + tune_stamina + tune_luck` (0..30). Дивизион заявки:
- 🥉 **Бронза**: powerRating 0–8
- 🥈 **Серебро**: 9–17
- 🥇 **Золото**: 18–30

Дивизион вычисляется при заявке и сохраняется в строке заявки (снапшот, как score) — чтобы поздняя прокачка после заявки не перекидывала между лигами задним числом.

### Призы по дивизионам (топ-3 каждой лиги)

| Место | Бронза | Серебро | Золото |
|---|---|---|---|
| 1 | 5000 | 15000 | 50000 + порода **«Чемпион»** |
| 2 | 2500 | 8000 | 25000 |
| 3 | 1000 | 4000 | 10000 |

Чемпион выдаётся ТОЛЬКО победителю Золота — остаётся редким. Если в дивизионе меньше 3 участников — начисляются только занятые места.

## Данные

```sql
ALTER TABLE pigeon_inventory ADD COLUMN IF NOT EXISTS tune_speed   SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE pigeon_inventory ADD COLUMN IF NOT EXISTS tune_stamina SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE pigeon_inventory ADD COLUMN IF NOT EXISTS tune_luck    SMALLINT NOT NULL DEFAULT 0;
-- заявка гонки получает снапшот дивизиона (score уже есть):
ALTER TABLE pigeon_race_entries ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'bronze';
```
Всё через ALTER IF NOT EXISTS в `initPigeonSchema` (совместимо с живой БД, как album_bonus).

## Чистые функции (тестируемые vitest без БД)

- `raceScore(breedId, stars, speed, stamina, luck, r): number` — новая сигнатура (было `raceScore(breedId, stars, r)`); существующие тесты в `tests/pigeons.test.ts` обновляются под новую формулу.
- `tuneCost(level): number` — `Math.floor(500 * 1.7**level)`; при `level >= TUNE_MAX` вернуть `null`.
- `raceDivision(powerRating): "bronze" | "silver" | "gold"`.
- Константы: `TUNE_MAX=10`, `TUNE_BASE_COST=500`, `TUNE_COST_MULT=1.7`, `TUNE_STATS=["speed","stamina","luck"]`, `DIVISION_PRIZES` (карта дивизион→массив призов), `RACE_DIVISIONS` (пороги).

## Серверные операции (pigeons.ts)

- `getTuning(chatId, breed)`: `{ owned, speed, stamina, luck, powerRating, division, nextCost: {speed,stamina,luck} }` (nextCost=null у характеристики на потолке).
- `upgradeTune(chatId, breed, stat)`: транзакция — проверка владения (count>0), уровня (<TUNE_MAX), баланса (≥ cost), затем `UPDATE pigeon_inventory SET tune_<stat>=+1` + списание монет через существующий путь. Возврат `{ ok, level?, spent?, reason? }` (reason: `not_owned|bad_stat|max_level|not_enough_coins`).
- `enterRace` — переписать: читать speed/stamina/luck, считать score новой формулой, division через raceDivision, писать оба в заявку.
- `closeRaceWeek` — переписать: за прошлую неделю выбрать заявки, **сгруппировать по division**, в каждом дивизионе топ-3 по score DESC/entered_at ASC, начислить `DIVISION_PRIZES[div]`, Чемпиона — только `gold` место 1; `results` JSONB = `{ bronze:[...], silver:[...], gold:[...] }` (каждый элемент place/chat/breed/score/prize). Мьютекс-строка недели — как сейчас (идемпотентность).
- `getRace` — добавить в ответ `myDivision`, `myPower`; `lastResults` теперь объект по дивизионам.

## HTTP (routes/pigeons.ts)

| Метод | Путь | Вызов | rateLimit |
|---|---|---|---|
| GET | /api/pigeons/tune?breed= | getTuning | 60 |
| POST | /api/pigeons/tune | upgradeTune(chatId, body.breed, body.stat) | 20 |

Существующие race-роуты не меняются по сигнатуре.

## Клиент (catdove.js, bump ?v)

- Панель тюнинга в шите действий карточки (для владеемой породы): 3 строки Скорость/Выносливость/Удача с полоской уровня 0/10 и кнопкой «Прокачать за N» (N из nextCost; кнопка disabled на потолке или при нехватке монет). Бейдж дивизиона рядом. Reason-коды в тосты: `not_enough_coins`→«Не хватает монет», `max_level`→«Максимальный уровень».
- Секция гонки: показывать свой дивизион и powerRating; `lastResults` рендерить тремя блоками (🥉/🥈/🥇) с местами.

## Приёмка

1. tuneCost: 0→500, 1→850, 2→1445; на уровне 10 → null. (vitest)
2. raceDivision: 8→bronze, 9→silver, 17→silver, 18→gold. (vitest)
3. raceScore: прокачанный common (speed10,stamina10) обходит непрокачанного legendary при r=0; на потолке разница только в звёздах+рывке. (vitest)
4. upgradeTune: списывает монеты, поднимает уровень; без монет→not_enough_coins; на потолке→max_level; не владеешь→not_owned. (E2E на VPS)
5. enterRace пишет score и division снапшотом; поздняя прокачка не меняет division заявки. (E2E)
6. closeRaceWeek: три дивизиона, топ-3 каждого, призы по таблице, Чемпион только gold#1, идемпотентность (второй прогон closed=false, второго Чемпиона нет). (E2E)
7. tsc + vitest зелёные; смоук прода (`scripts/smoke.sh`) зелёный после деплоя.

## Чего сознательно НЕТ

Камень-ножницы/погода трассы, мини-игра на скилл, снаряжение-предметы, недельный сброс формы, реальные награды. Только характеристики + дивизионы.

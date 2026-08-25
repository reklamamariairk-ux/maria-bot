"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LUCK_TIGHTEN = exports.TAP_SPEED_BOOST = exports.TAP_W = exports.TAP_TARGET_PER = exports.TAP_TARGET_BASE = exports.TAP_WINDOW_MS = exports.TRAIN_SKILL_HI = exports.TRAIN_SKILL_LO = exports.COMP_SKILL_HI = exports.COMP_SKILL_LO = exports.LUCK_SPREAD_V2 = exports.SKILL_SPREAD = exports.REACT_SPAN = exports.REV_HALF = exports.PAYOUT = exports.STAKE_PRESETS = exports.POWER_BAND = exports.LUCK_SPREAD = exports.BET_POWER_GAP = exports.COMP_REACT_HI = exports.COMP_REACT_LO = exports.REACT_WEIGHT = exports.REACT_MAX = exports.REACT_MIN = exports.SPEED_PER_POWER = exports.BASE_SPEED = exports.TRACK_LEN = exports.DUEL_STAKE_MAX = exports.DRAG_ENERGY_COST = void 0;
exports.revAccuracy = revAccuracy;
exports.reactAccuracy = reactAccuracy;
exports.launchSkill = launchSkill;
exports.dragFinishTimeV2 = dragFinishTimeV2;
exports.resolveRaceV2 = resolveRaceV2;
exports.competitiveSkill = competitiveSkill;
exports.dragPower = dragPower;
exports.cruisePower = cruisePower;
exports.dragMatchPowerV3 = dragMatchPowerV3;
exports.tapTarget = tapTarget;
exports.tapAccuracy = tapAccuracy;
exports.clampTapCount = clampTapCount;
exports.tapSkill = tapSkill;
exports.luckSpread = luckSpread;
exports.dragFinishTimeV3 = dragFinishTimeV3;
exports.resolveRaceV3 = resolveRaceV3;
exports.hardenBetFieldV3 = hardenBetFieldV3;
exports.trainingOpponentSkill = trainingOpponentSkill;
exports.assignFieldSkillV3 = assignFieldSkillV3;
exports.dragFinishTime = dragFinishTime;
exports.resolveRace = resolveRace;
exports.competitiveReaction = competitiveReaction;
exports.makeBot = makeBot;
exports.makeBotForCruise = makeBotForCruise;
exports.hardenBetFieldV2 = hardenBetFieldV2;
exports.assignFieldSkill = assignFieldSkill;
exports.hardenBetField = hardenBetField;
exports.pickOpponents = pickOpponents;
exports.pickOpponentsV3 = pickOpponentsV3;
exports.pickFriendOpponents = pickFriendOpponents;
exports.normalizeDuelStake = normalizeDuelStake;
exports.listFriendDuels = listFriendDuels;
exports.createFriendDuel = createFriendDuel;
exports.declineFriendDuel = declineFriendDuel;
exports.cancelFriendDuel = cancelFriendDuel;
exports.acceptFriendDuel = acceptFriendDuel;
exports.cacheOpponents = cacheOpponents;
exports.takeCachedOpponents = takeCachedOpponents;
exports.dragTargetPower = dragTargetPower;
exports.dragTargetProfile = dragTargetProfile;
exports.runRace = runRace;
const db_1 = require("./db");
const pigeons_1 = require("./pigeons");
const DUEL_MUTATION_LOCK_KEY = "pigeon-duels-mutation-v1";
async function lockDuelMutations(db) {
    // Дуэль затрагивает две строки кошелька и одну строку вызова. Единый короткий
    // advisory-lock исключает циклические локи встречных дуэлей и гонку со
    // сбросом/удалением профиля, не сериализуя обычные заезды и тапы.
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [DUEL_MUTATION_LOCK_KEY]);
}
exports.DRAG_ENERGY_COST = 250;
exports.DUEL_STAKE_MAX = 1000000;
exports.TRACK_LEN = 2000;
exports.BASE_SPEED = 220;
exports.SPEED_PER_POWER = 5; // мощность доминирует: разрыв power перевешивает реакцию
exports.REACT_MIN = 200, exports.REACT_MAX = 3000; // floor 200мс: быстрее — предугадывание/скрипт, преимущества не даёт
exports.REACT_WEIGHT = 0.25; // реакция решает близкие дуэли (≲15 power), но не перебивает большой разрыв мощности
// Конкурентный диапазон реакций поля в режиме «Ставка» (раздаёт сервер, см. hardenBetField).
// Подобран Монте-Карло (спека 2026-07-30-drag-bet-ev-fix): EV идеального скрипта ≈ −3.7%,
// честного быстрого ≈ −20%, при этом реакция остаётся значимым навыком.
exports.COMP_REACT_LO = 205, exports.COMP_REACT_HI = 325;
exports.BET_POWER_GAP = 10; // «Ставка»: соперник слабее target−GAP заменяется ботом ≈target
exports.LUCK_SPREAD = 0.15; // маленький рандом (сек)
exports.POWER_BAND = 25; // коридор подбора соперников по мощности
exports.STAKE_PRESETS = [500, 2000, 10000];
exports.PAYOUT = { 1: 2, 2: 1, 3: 0, 4: 0 }; // множитель к ставке (2=+ставка, 1=возврат, 0=потеря)
// ── Механика v2 «Идеальный запуск» (спека 2026-07-30-drag-launch-mechanic-v2) ──
// Три навыковых инпута до старта: прогрев + форсаж (отступ стрелки от центра золотой
// зоны, мс) и реакция на зелёный. Константы подобраны Монте-Карло (tests/drag.test.ts):
// дом-эдж поля из 4 равных = −25%; перфект-скрипт получает лишь лёгкий буст (EV < 0).
exports.REV_HALF = 300; // окно точности свипа: |отступ| ≥ 300мс → 0
exports.REACT_SPAN = 600; // реакция 200мс → 1.0, ≥800мс → 0
exports.SKILL_SPREAD = 0.14; // сек штрафа между запуском 1.0 и 0.0
exports.LUCK_SPREAD_V2 = 0.15; // сек случайного разброса (правит близкие дуэли)
exports.COMP_SKILL_LO = 0.75, exports.COMP_SKILL_HI = 1.0; // поле «Ставки»
exports.TRAIN_SKILL_LO = 0.25, exports.TRAIN_SKILL_HI = 0.70; // поле «Тренировки»: соперники не получают скрытый идеальный разгон
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function revAccuracy(offsetMs) {
    const off = Math.abs(Number(offsetMs));
    if (!Number.isFinite(off))
        return 0;
    return clamp01(1 - off / exports.REV_HALF);
}
function reactAccuracy(ms) {
    return clamp01(1 - (clampReact(ms) - exports.REACT_MIN) / exports.REACT_SPAN);
}
function launchSkill(inp) {
    return 0.5 * revAccuracy(inp.rev1) + 0.5 * reactAccuracy(inp.reactionMs);
}
function dragFinishTimeV2(power, skill, r) {
    const speed = exports.BASE_SPEED + power * exports.SPEED_PER_POWER;
    return exports.TRACK_LEN / speed + (1 - clamp01(skill)) * exports.SKILL_SPREAD + r * exports.LUCK_SPREAD_V2;
}
function resolveRaceV2(racers) {
    const times = racers.map((x, i) => ({ i, t: dragFinishTimeV2(x.power, x.skill, x.r) }));
    times.sort((a, b) => a.t - b.t || a.i - b.i);
    const places = new Array(racers.length);
    times.forEach((x, rank) => { places[x.i] = rank + 1; });
    return places;
}
function competitiveSkill(lo = exports.COMP_SKILL_LO, hi = exports.COMP_SKILL_HI, rng = Math.random) {
    return lo + rng() * (hi - lo);
}
const RARITY_BASE = { common: 10, rare: 16, epic: 22, legendary: 28 };
function dragPower(rarity, stars, speed, stamina) {
    return RARITY_BASE[rarity] + (stars - 1) * 4 + 6 * speed + 6 * stamina;
}
// ── Механика v3 «Тап-заезд» (спека 2026-08-04-drag-tap-race-design) ──────────
// Исход зависит от числа тапов ПЕРЕД стартом. Три характеристики разведены:
// скорость → крейсер (пол результата), выносливость → эффективность тапов (меньше
// тапов до максимума), удача → сжатие случайного разброса. Тап-навык ∈ [0,1] встаёт
// в тот же слот, что launch-skill v2, и дополнительно даёт стартовый буст к скорости.
exports.TAP_WINDOW_MS = 5000; // окно тап-зоны (клиент по умолчанию)
exports.TAP_TARGET_BASE = 48; // тапов до максимума при стамине 0
exports.TAP_TARGET_PER = 2; // −2 тапа к цели за пункт стамины (48 → 28 при 10)
exports.TAP_W = 0.7; // доля тапов в tap-навыке (реакция = 1−TAP_W)
exports.TAP_SPEED_BOOST = 18; // полный разгон перед стартом заметно добавляет крейсер
exports.LUCK_TIGHTEN = 0.5; // удача 10 → случайный разброс вдвое уже
// Крейсер: только скорость (в отличие от matchPower/dragPower, куда входит и стамина) —
// так скорость и выносливость перестают быть взаимозаменяемыми.
function cruisePower(rarity, stars, speed) {
    return RARITY_BASE[rarity] + (stars - 1) * 4 + 6 * speed;
}
function dragMatchPowerV3(rarity, stars, speed) {
    return cruisePower(rarity, stars, speed);
}
// Цель тапов до полного tap-навыка: падает со стаминой (выносливее голубь — меньше тапать).
function tapTarget(stamina) {
    const s = Math.min(pigeons_1.TUNE_MAX, Math.max(0, Number(stamina) || 0));
    return exports.TAP_TARGET_BASE - exports.TAP_TARGET_PER * s;
}
function tapAccuracy(count, stamina) {
    const target = tapTarget(stamina);
    if (target <= 0)
        return 1;
    return clamp01((Number(count) || 0) / target);
}
// Клиент ограничивает разгон тремя одновременными пальцами; сервер здесь только
// нормализует untrusted count. Отрицательное/NaN → 0.
function clampTapCount(count, durationMs) {
    void durationMs;
    return Math.max(0, Math.floor(Number(count) || 0));
}
// Тап-навык: 0.7 тапы + 0.3 реакция. Всё untrusted — клампы внутри.
function tapSkill(tap, stamina) {
    const count = clampTapCount(tap.count, tap.durationMs);
    return exports.TAP_W * tapAccuracy(count, stamina) + (1 - exports.TAP_W) * reactAccuracy(tap.reactionMs);
}
// Удача сжимает случайный разброс времени (оживает в драге — раньше не влияла).
function luckSpread(luck) {
    const l = Math.min(pigeons_1.TUNE_MAX, Math.max(0, Number(luck) || 0));
    return exports.LUCK_SPREAD_V2 * (1 - exports.LUCK_TIGHTEN * (l / pigeons_1.TUNE_MAX));
}
function dragFinishTimeV3(cruise, skill, luck, r, tapSpeedBoost = 0) {
    const effectiveCruise = cruise + clamp01(skill) * Math.max(0, Number(tapSpeedBoost) || 0);
    const speed = exports.BASE_SPEED + effectiveCruise * exports.SPEED_PER_POWER;
    return exports.TRACK_LEN / speed + (1 - clamp01(skill)) * exports.SKILL_SPREAD + r * luckSpread(luck);
}
function resolveRaceV3(racers) {
    const times = racers.map((x, i) => ({ i, t: dragFinishTimeV3(x.cruise, x.skill, x.luck, x.r, x.tapSpeedBoost) }));
    times.sort((a, b) => a.t - b.t || a.i - b.i);
    const places = new Array(racers.length);
    times.forEach((x, rank) => { places[x.i] = rank + 1; });
    return places;
}
// Поле «Ставки» v3: слабее target−GAP (по matchPower) → бот ≈target; tap-навык всех
// соперников раздаёт сервер (конкурентный диапазон). Крейсер/удачу соперников сохраняем.
function hardenBetFieldV3(opps, target, rng = Math.random) {
    return opps.map((o, i) => {
        const tempo = o.cruise ?? o.power;
        const base = tempo < target - exports.BET_POWER_GAP || tempo > target ? makeBotForCruise(target, i) : o;
        return {
            ...base,
            cruise: base.cruise ?? base.power,
            luck: base.luck ?? 0,
            skill: competitiveSkill(exports.COMP_SKILL_LO, exports.COMP_SKILL_HI, rng),
        };
    });
}
function trainingOpponentSkill(playerSkill, rng = Math.random) {
    const s = clamp01(playerSkill);
    return clamp01(s * (0.78 + rng() * 0.22));
}
function assignFieldSkillV3(opps, mode, target, playerSkill = 0, rng = Math.random) {
    if (mode === "bet")
        return hardenBetFieldV3(opps, target, rng);
    return opps.map(o => ({
        ...o, cruise: o.cruise ?? o.power, luck: o.luck ?? 0,
        skill: trainingOpponentSkill(playerSkill, rng),
    }));
}
const clampReact = (ms) => Math.min(exports.REACT_MAX, Math.max(exports.REACT_MIN, ms));
function dragFinishTime(power, reactionMs, r) {
    const speed = exports.BASE_SPEED + power * exports.SPEED_PER_POWER;
    const reactDelay = (clampReact(reactionMs) / 1000) * exports.REACT_WEIGHT;
    return exports.TRACK_LEN / speed + reactDelay + r * exports.LUCK_SPREAD;
}
// Места по возрастанию finishT (1 = победа). Тай-брейк по индексу (стабильно).
function resolveRace(racers) {
    const times = racers.map((x, i) => ({ i, t: dragFinishTime(x.power, x.reactionMs, x.r) }));
    times.sort((a, b) => a.t - b.t || a.i - b.i);
    const places = new Array(racers.length);
    times.forEach((x, rank) => { places[x.i] = rank + 1; });
    return places;
}
// Детерминированная «правдоподобная» реакция без Math.random — используется как фолбэк,
// когда у игрока ещё нет своего race_reaction_ms (новичок) и для базовой реакции бота.
function synthReaction(target) {
    return clampReact(250 + Math.round((target % 7) * 40));
}
// Реакция соперника в режиме «Ставка»: раздаёт СЕРВЕР из конкурентного диапазона —
// сохранённые (протухшие/медленные) реакции реальных игроков и предсказуемые реакции
// ботов не должны превращать поле в кормушку для скриптера с константной реакцией.
function competitiveReaction(rng = Math.random) {
    return clampReact(Math.round(exports.COMP_REACT_LO + rng() * (exports.COMP_REACT_HI - exports.COMP_REACT_LO)));
}
// Синтетический соперник-бот под целевую мощность target: не-чемпионская порода нужной
// редкости (чемпион — только приз, не гоняется как соперник), tune_speed/tune_stamina
// подобраны так, чтобы dragPower ≈ target. Редкость выбираем под target: у common база
// всего 10, и потолка тюнинга (2×TUNE_MAX=20 → +120 power) не хватает дотянуть до высоких
// таргетов — поэтому чем выше target, тем выше стартовая редкость (её RARITY_BASE даёт
// нижнюю границу), дальше 6 очков power за пункт тюнинга, поровну speed/stamina, кламп 0..TUNE_MAX.
// Если и максимальной редкости со stars=1 не хватает (эндгейм: игрок 156 > потолок бота 148),
// поднимаем звёзды до 3 — бот достижим на всей лестнице, гарантированных побед «по мощности» нет.
function makeBot(target, seed) {
    const wantRarity = target >= 130 ? "legendary" : target >= 90 ? "epic" : target >= 45 ? "rare" : "common";
    let candidates = pigeons_1.PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === wantRarity);
    if (!candidates.length)
        candidates = pigeons_1.PIGEON_BREEDS.filter(b => b.id !== "champion");
    const b = candidates[Math.floor(Math.random() * candidates.length)];
    let stars = 1;
    while (stars < 3 && Math.round((target - dragPower(b.rarity, stars, 0, 0)) / 6) > 2 * pigeons_1.TUNE_MAX)
        stars++;
    const base = dragPower(b.rarity, stars, 0, 0);
    const totalPoints = Math.min(2 * pigeons_1.TUNE_MAX, Math.max(0, Math.round((target - base) / 6)));
    const speed = Math.min(pigeons_1.TUNE_MAX, Math.ceil(totalPoints / 2));
    const stamina = Math.min(pigeons_1.TUNE_MAX, totalPoints - speed);
    const power = dragPower(b.rarity, stars, speed, stamina);
    const reactionMs = clampReact(synthReaction(target) + ((seed % 5) - 2) * 15 + Math.round((Math.random() - 0.5) * 60));
    // v3: крейсер бота от его скорости, удача — середина (умеренный разброс) для честного поля.
    const cruise = cruisePower(b.rarity, stars, speed);
    return { breed: b.id, power, reactionMs, bot: true, name: "Соперник", cruise, luck: Math.round(pigeons_1.TUNE_MAX / 2) };
}
// v3 tap-race bot matched by cruise, not by total power. Otherwise a stamina-heavy
// player sees "equal" opponents whose speed is much higher and cannot catch them by taps.
function makeBotForCruise(targetCruise, seed) {
    const combos = [];
    for (const b of pigeons_1.PIGEON_BREEDS) {
        if (b.id === "champion")
            continue;
        for (let stars = 1; stars <= 3; stars++) {
            for (let speed = 0; speed <= pigeons_1.TUNE_MAX; speed++) {
                combos.push({ breed: b, stars, speed, cruise: cruisePower(b.rarity, stars, speed) });
            }
        }
    }
    const fairCombos = combos.filter(c => c.cruise <= targetCruise);
    const pool = fairCombos.length ? fairCombos : combos;
    pool.sort((a, b) => Math.abs(a.cruise - targetCruise) - Math.abs(b.cruise - targetCruise));
    const top = pool.slice(0, Math.min(8, pool.length));
    const pick = top[Math.abs(seed + Math.floor(Math.random() * top.length)) % top.length] ?? combos[0];
    const stamina = Math.min(pigeons_1.TUNE_MAX, Math.max(0, Math.round(pick.speed / 2)));
    const power = dragPower(pick.breed.rarity, pick.stars, pick.speed, stamina);
    const reactionMs = clampReact(synthReaction(targetCruise) + ((seed % 5) - 2) * 15 + Math.round((Math.random() - 0.5) * 60));
    return { breed: pick.breed.id, power, reactionMs, bot: true, name: "Соперник", cruise: pick.cruise, luck: Math.round(pigeons_1.TUNE_MAX / 2) };
}
function hardenBetFieldV2(opps, target, rng = Math.random) {
    return opps.map((o, i) => {
        const r = o.power < target - exports.BET_POWER_GAP ? makeBot(target, i) : o;
        return { ...r, skill: competitiveSkill(exports.COMP_SKILL_LO, exports.COMP_SKILL_HI, rng) };
    });
}
function assignFieldSkill(opps, mode, target) {
    if (mode === "bet")
        return hardenBetFieldV2(opps, target);
    return opps.map(o => ({ ...o, skill: competitiveSkill(exports.TRAIN_SKILL_LO, exports.TRAIN_SKILL_HI) }));
}
// Ужесточение поля для режима «Ставка» (спека 2026-07-30-drag-bet-ev-fix):
// 1) соперник слабее target−BET_POWER_GAP → замена ботом ≈target (иначе игрок на вершине
//    лестницы получает поле строго слабее себя = гарантированная победа);
// 2) реакции ВСЕХ соперников — серверная конкурентная выборка на этот заезд.
// Порода/мощность реальных соперников в допуске сохраняются (флейвор «гоняюсь с живыми»).
function hardenBetField(opps, target) {
    return opps.map((o, i) => {
        const r = o.power < target - exports.BET_POWER_GAP ? makeBot(target, i) : o;
        return { ...r, reactionMs: competitiveReaction() };
    });
}
// n соперников для игрока chatId под целевую мощность targetPower: сперва реальные голуби
// других игроков в коридоре ±POWER_BAND (ближайшие по |power-target|), при нехватке —
// добивка синтетическими ботами под target.
async function pickOpponents(chatId, targetPower, n, db = db_1.pool) {
    // LIMIT 200 + random(): не полный скан таблицы на каждый заезд (масштабируемость);
    // .filter(BREED_BY_ID.has) — не роняем роут 500-й, если в чужом инвентаре осталась
    // переименованная/удалённая порода (как guard в dragTargetPower).
    const rows = (await db.query(`SELECT pi.breed, pi.stars, pi.tune_speed, pi.tune_stamina, pi.tune_luck, cs.race_reaction_ms
      FROM pigeon_inventory pi JOIN clicker_state cs ON cs.chat_id = pi.chat_id
      WHERE pi.chat_id <> $1 AND pi.count > 0 AND cs.admin_blocked=FALSE
      ORDER BY random() LIMIT 200`, [chatId])).rows;
    const real = rows.filter((r) => pigeons_1.BREED_BY_ID.has(r.breed)).map((r) => {
        const b = pigeons_1.BREED_BY_ID.get(r.breed);
        const power = dragPower(b.rarity, r.stars, r.tune_speed, r.tune_stamina);
        // v3: крейсер от скорости, удача из тюнинга — для tap-заезда (v1/v2 их игнорируют).
        const cruise = cruisePower(b.rarity, r.stars, r.tune_speed);
        return { breed: r.breed, power, reactionMs: r.race_reaction_ms ?? synthReaction(targetPower), bot: false, cruise, luck: r.tune_luck ?? 0 };
    }).filter(x => Math.abs(x.power - targetPower) <= exports.POWER_BAND)
        .sort((a, b) => Math.abs(a.power - targetPower) - Math.abs(b.power - targetPower))
        .slice(0, n);
    while (real.length < n)
        real.push(makeBot(targetPower, real.length));
    return real;
}
async function pickOpponentsV3(chatId, targetCruise, n, db = db_1.pool) {
    const rows = (await db.query(`SELECT pi.breed, pi.stars, pi.tune_speed, pi.tune_stamina, pi.tune_luck, cs.race_reaction_ms
      FROM pigeon_inventory pi JOIN clicker_state cs ON cs.chat_id = pi.chat_id
      WHERE pi.chat_id <> $1 AND pi.count > 0 AND cs.admin_blocked=FALSE
      ORDER BY random() LIMIT 200`, [chatId])).rows;
    const real = rows.filter((r) => pigeons_1.BREED_BY_ID.has(r.breed)).map((r) => {
        const b = pigeons_1.BREED_BY_ID.get(r.breed);
        const power = dragPower(b.rarity, r.stars, r.tune_speed, r.tune_stamina);
        const cruise = cruisePower(b.rarity, r.stars, r.tune_speed);
        return { breed: r.breed, power, reactionMs: r.race_reaction_ms ?? synthReaction(targetCruise), bot: false, cruise, luck: r.tune_luck ?? 0 };
    }).filter(x => {
        const tempo = x.cruise ?? x.power;
        return tempo <= targetCruise && Math.abs(tempo - targetCruise) <= exports.POWER_BAND;
    })
        .sort((a, b) => Math.abs((a.cruise ?? a.power) - targetCruise) - Math.abs((b.cruise ?? b.power) - targetCruise))
        .slice(0, n);
    while (real.length < n)
        real.push(makeBotForCruise(targetCruise, real.length));
    return real;
}
async function pickFriendOpponents(chatId, friendChat, targetCruise, n) {
    if (!Number.isSafeInteger(friendChat) || friendChat <= 0 || friendChat === chatId)
        return null;
    const a = Math.min(chatId, friendChat);
    const b = Math.max(chatId, friendChat);
    const rel = await db_1.pool.query(`SELECT 1 FROM pigeon_friends WHERE chat_a=$1 AND chat_b=$2 LIMIT 1`, [a, b]);
    if (!rel.rowCount)
        return null;
    const rows = (await db_1.pool.query(`SELECT pi.breed, pi.stars, pi.tune_speed, pi.tune_stamina, pi.tune_luck, cs.race_reaction_ms, s.first_name, s.username
       FROM pigeon_inventory pi
       JOIN clicker_state cs ON cs.chat_id = pi.chat_id
       LEFT JOIN subscribers s ON s.chat_id = pi.chat_id
      WHERE pi.chat_id=$1 AND pi.count > 0 AND pi.breed <> 'champion' AND cs.admin_blocked=FALSE
      ORDER BY random() LIMIT 100`, [friendChat])).rows;
    const friendRacers = rows.filter((r) => pigeons_1.BREED_BY_ID.has(r.breed)).map((r) => {
        const breed = pigeons_1.BREED_BY_ID.get(r.breed);
        const power = dragPower(breed.rarity, r.stars, r.tune_speed, r.tune_stamina);
        const cruise = cruisePower(breed.rarity, r.stars, r.tune_speed);
        const name = (r.first_name || r.username || "Друг").toString().slice(0, 24);
        return { breed: r.breed, power, reactionMs: r.race_reaction_ms ?? synthReaction(targetCruise), bot: false, name, friend: true, cruise, luck: r.tune_luck ?? 0 };
    }).sort((x, y) => Math.abs((x.cruise ?? x.power) - targetCruise) - Math.abs((y.cruise ?? y.power) - targetCruise));
    if (!friendRacers.length)
        return null;
    const field = [friendRacers[0]];
    while (field.length < n)
        field.push(makeBotForCruise(targetCruise, field.length));
    return field.slice(0, n);
}
const DUEL_OPEN_LIMIT = 10;
function normalizeDuelStake(stake) {
    const n = Number(stake);
    if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0 || n > exports.DUEL_STAKE_MAX)
        return null;
    return n;
}
function normalizeDuelTap(tap) {
    return {
        count: Math.max(0, Math.floor(Number(tap?.count)) || 0),
        reactionMs: Math.max(0, Number(tap?.reactionMs)) || 3000,
        durationMs: Number(tap?.durationMs) || exports.TAP_WINDOW_MS,
    };
}
async function assertDuelFriend(client, chatId, friendChat) {
    if (!Number.isSafeInteger(friendChat) || friendChat <= 0 || friendChat === chatId)
        return false;
    const active = await client.query(`SELECT COUNT(*)::int AS n FROM clicker_state WHERE chat_id IN ($1,$2) AND admin_blocked=FALSE`, [chatId, friendChat]);
    if (Number(active.rows[0]?.n || 0) !== 2)
        return false;
    const a = Math.min(chatId, friendChat), b = Math.max(chatId, friendChat);
    const rel = await client.query(`SELECT 1 FROM pigeon_friends WHERE chat_a=$1 AND chat_b=$2 LIMIT 1`, [a, b]);
    if (rel.rowCount)
        return true;
    // Рефералы и однокомандники также отображаются в «Друзьях»: разрешаем им дуэли.
    const known = await client.query(`SELECT 1 FROM clicker_state me JOIN clicker_state other ON other.chat_id=$2
      WHERE me.chat_id=$1 AND me.admin_blocked=FALSE AND other.admin_blocked=FALSE AND (
        me.referred_by=$2 OR other.referred_by=$1 OR
        (me.squad IS NOT NULL AND me.squad=other.squad)
      ) LIMIT 1`, [chatId, friendChat]);
    return !!known.rowCount;
}
async function getDuelStats(client, chatId, breed) {
    const r = await client.query(`SELECT stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed]);
    if (!r.rowCount)
        return null;
    const b = pigeons_1.BREED_BY_ID.get(breed);
    if (!b)
        return null;
    const stars = Number(r.rows[0].stars) || 1;
    const speed = Number(r.rows[0].tune_speed) || 0;
    const stamina = Number(r.rows[0].tune_stamina) || 0;
    const luck = Number(r.rows[0].tune_luck) || 0;
    return { breed, rarity: b.rarity, stars, speed, stamina, luck, power: dragPower(b.rarity, stars, speed, stamina), cruise: cruisePower(b.rarity, stars, speed) };
}
function duelName(row, fallback) {
    return (row?.first_name || row?.username || fallback).toString().slice(0, 24);
}
function resolveDuel(fromChat, toChat, fromName, toName, fromStats, toStats, fromTapRaw, toTapRaw) {
    const fromTap = normalizeDuelTap(fromTapRaw);
    const toTap = normalizeDuelTap(toTapRaw);
    const fromSkill = tapSkill(fromTap, fromStats.stamina);
    const toSkill = tapSkill(toTap, toStats.stamina);
    const rolls = [Math.random(), Math.random()];
    const racersBase = [
        { chat: fromChat, breed: fromStats.breed, name: fromName, cruise: fromStats.cruise, power: fromStats.power, luck: fromStats.luck, skill: fromSkill, tap: fromTap, r: rolls[0] },
        { chat: toChat, breed: toStats.breed, name: toName, cruise: toStats.cruise, power: toStats.power, luck: toStats.luck, skill: toSkill, tap: toTap, r: rolls[1] },
    ];
    const places = resolveRaceV3(racersBase.map(r => ({ cruise: r.cruise, skill: r.skill, luck: r.luck, r: r.r, tapSpeedBoost: exports.TAP_SPEED_BOOST })));
    const racers = racersBase.map((r, i) => ({
        chat: r.chat, breed: r.breed, name: r.name, power: r.power,
        finishT: dragFinishTimeV3(r.cruise, r.skill, r.luck, r.r, exports.TAP_SPEED_BOOST),
        place: places[i], bot: false, friend: true,
        mySkill: {
            taps: clampTapCount(r.tap.count, r.tap.durationMs),
            tapAcc: tapAccuracy(clampTapCount(r.tap.count, r.tap.durationMs), i === 0 ? fromStats.stamina : toStats.stamina),
            reactionMs: clampReact(r.tap.reactionMs), total: r.skill,
        },
    }));
    return { racers, winnerChat: places[0] === 1 ? fromChat : toChat };
}
function duelResultFor(result, viewerChat, stake, winnerChat, balance) {
    const racers = (result?.racers || []).map((r) => ({ ...r, me: Number(r.chat) === viewerChat, friend: Number(r.chat) !== viewerChat }));
    racers.sort((a, b) => (a.me === b.me ? 0 : a.me ? -1 : 1));
    const mine = racers.find((r) => r.me);
    return {
        ok: true,
        duel: true,
        racers,
        myPlace: mine ? Number(mine.place) : 0,
        reward: winnerChat === viewerChat ? stake : -stake,
        newBalance: balance,
        mySkill: mine?.mySkill,
    };
}
async function listFriendDuels(chatId) {
    const mapRows = (rows) => rows.map(r => ({
        id: Number(r.id), fromChat: Number(r.from_chat), toChat: Number(r.to_chat), stake: Number(r.stake),
        fromBreed: r.from_breed, toBreed: r.to_breed || null, status: r.status,
        fromName: duelName(r, "Друг"), createdAt: r.created_at,
        result: r.result || null, winnerChat: r.winner_chat ? Number(r.winner_chat) : null,
    }));
    const incoming = await db_1.pool.query(`SELECT d.*, s.first_name, s.username FROM pigeon_duels d LEFT JOIN subscribers s ON s.chat_id=d.from_chat
      WHERE d.to_chat=$1 AND d.status='open' ORDER BY d.created_at DESC LIMIT 20`, [chatId]);
    const outgoing = await db_1.pool.query(`SELECT d.*, s.first_name, s.username FROM pigeon_duels d LEFT JOIN subscribers s ON s.chat_id=d.to_chat
      WHERE d.from_chat=$1 AND d.status='open' ORDER BY d.created_at DESC LIMIT 20`, [chatId]);
    const done = await db_1.pool.query(`SELECT d.*, s.first_name, s.username FROM pigeon_duels d LEFT JOIN subscribers s ON s.chat_id=CASE WHEN d.from_chat=$1 THEN d.to_chat ELSE d.from_chat END
      WHERE (d.from_chat=$1 OR d.to_chat=$1) AND d.status='done' ORDER BY d.closed_at DESC LIMIT 10`, [chatId]);
    return { incoming: mapRows(incoming.rows), outgoing: mapRows(outgoing.rows), done: mapRows(done.rows) };
}
async function createFriendDuel(chatId, friendChat, breed, stakeRaw, tapRaw, requestId = "") {
    const stake = normalizeDuelStake(stakeRaw);
    if (stake == null)
        return { ok: false, reason: "bad_stake" };
    if (!pigeons_1.BREED_BY_ID.has(breed))
        return { ok: false, reason: "not_owned" };
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        await lockDuelMutations(client);
        // Сериализуем создание дуэлей одного отправителя. Иначе два запроса могли
        // одновременно увидеть count<limit и оба вставить новую открытую дуэль.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`pigeon-duel:${chatId}`]);
        if (requestId) {
            const previous = await client.query(`SELECT d.id, s.balance, s.energy, s.state_revision FROM pigeon_duels d LEFT JOIN clicker_state s ON s.chat_id=d.from_chat
          WHERE d.from_chat=$1 AND d.request_id=$2`, [chatId, requestId]);
            if (previous.rowCount) {
                await client.query("ROLLBACK");
                return {
                    ok: true, duplicate: true, id: Number(previous.rows[0].id),
                    newBalance: previous.rows[0].balance == null ? undefined : Number(previous.rows[0].balance),
                    newEnergy: previous.rows[0].energy == null ? undefined : Number(previous.rows[0].energy),
                    revision: previous.rows[0].state_revision == null ? undefined : Number(previous.rows[0].state_revision),
                };
            }
        }
        // Сначала фиксируем/блокируем общий кошелёк, и только затем читаем голубя и
        // создаём дуэль. Иначе параллельный админ-сброс мог удалить инвентарь после
        // getDuelStats(), а запрос затем создавал вызов от уже несуществующей птицы.
        const { refreshEnergyFor } = await Promise.resolve().then(() => __importStar(require("./clicker")));
        const st = await refreshEnergyFor(client, chatId);
        if (!(await assertDuelFriend(client, chatId, friendChat))) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_friend" };
        }
        const open = await client.query(`SELECT COUNT(*)::int AS n FROM pigeon_duels WHERE from_chat=$1 AND status='open'`, [chatId]);
        if (Number(open.rows[0].n) >= DUEL_OPEN_LIMIT) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "limit" };
        }
        const stats = await getDuelStats(client, chatId, breed);
        if (!stats) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_owned" };
        }
        if (st.energy < exports.DRAG_ENERGY_COST) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "no_energy" };
        }
        if (st.balance < stake) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_enough_coins" };
        }
        const energyLeft = st.energy - exports.DRAG_ENERGY_COST;
        const balance = st.balance - stake;
        const tap = normalizeDuelTap(tapRaw);
        const updated = await client.query(`UPDATE clicker_state SET energy=$2, balance=$3, race_reaction_ms=$4, energy_carry=$5, state_revision=state_revision+1, updated_at=NOW(), energy_updated_at=NOW() WHERE chat_id=$1 RETURNING state_revision`, [chatId, energyLeft, balance, clampReact(tap.reactionMs), st.energyCarry]);
        const ins = await client.query(`INSERT INTO pigeon_duels (from_chat,to_chat,stake,from_breed,from_tap,from_stats,request_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id`, [chatId, friendChat, stake, breed, JSON.stringify(tap), JSON.stringify(stats), requestId || null]);
        await client.query("COMMIT");
        return { ok: true, id: Number(ins.rows[0].id), newBalance: balance, newEnergy: energyLeft, revision: Number(updated.rows[0]?.state_revision || 0) };
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
async function declineFriendDuel(chatId, duelId) {
    if (!Number.isSafeInteger(duelId) || duelId <= 0)
        return { ok: false, reason: "bad_input" };
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        await lockDuelMutations(client);
        const d = await client.query(`SELECT from_chat, stake, status FROM pigeon_duels WHERE id=$1 AND to_chat=$2 FOR UPDATE`, [duelId, chatId]);
        if (!d.rowCount) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_found" };
        }
        if (d.rows[0].status === "declined") {
            const current = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
            await client.query("ROLLBACK");
            return { ok: true, duplicate: true, newBalance: current.rows[0] ? Number(current.rows[0].balance) : undefined };
        }
        if (d.rows[0].status !== "open") {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_found" };
        }
        const fromChat = Number(d.rows[0].from_chat), stake = Number(d.rows[0].stake) || 0;
        await client.query(`UPDATE pigeon_duels SET status='declined', closed_at=NOW() WHERE id=$1`, [duelId]);
        if (stake > 0)
            await client.query(`UPDATE clicker_state SET balance=balance+$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`, [fromChat, stake]);
        const bal = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
        await client.query("COMMIT");
        return { ok: true, newBalance: bal.rows[0] ? Number(bal.rows[0].balance) : undefined };
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
/** Отправитель может снять неотвеченный вызов и вернуть ставку из эскроу. */
async function cancelFriendDuel(chatId, duelId) {
    if (!Number.isSafeInteger(duelId) || duelId <= 0)
        return { ok: false, reason: "bad_input" };
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        await lockDuelMutations(client);
        const d = await client.query(`SELECT stake, status FROM pigeon_duels WHERE id=$1 AND from_chat=$2 FOR UPDATE`, [duelId, chatId]);
        if (!d.rowCount) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_found" };
        }
        if (d.rows[0].status === "cancelled") {
            const current = await client.query(`SELECT balance, state_revision FROM clicker_state WHERE chat_id=$1`, [chatId]);
            await client.query("ROLLBACK");
            return { ok: true, duplicate: true, newBalance: current.rows[0] ? Number(current.rows[0].balance) : undefined, revision: current.rows[0] ? Number(current.rows[0].state_revision || 0) : undefined };
        }
        if (d.rows[0].status !== "open") {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_found" };
        }
        const stake = Number(d.rows[0].stake) || 0;
        await client.query(`UPDATE pigeon_duels SET status='cancelled', closed_at=NOW() WHERE id=$1`, [duelId]);
        if (stake > 0) {
            await client.query(`UPDATE clicker_state SET balance=balance+$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`, [chatId, stake]);
        }
        const bal = await client.query(`SELECT balance, state_revision FROM clicker_state WHERE chat_id=$1`, [chatId]);
        await client.query("COMMIT");
        return { ok: true, newBalance: bal.rows[0] ? Number(bal.rows[0].balance) : undefined, revision: bal.rows[0] ? Number(bal.rows[0].state_revision || 0) : undefined };
    }
    catch (e) {
        await client.query("ROLLBACK").catch(() => { });
        throw e;
    }
    finally {
        client.release();
    }
}
async function acceptFriendDuel(chatId, duelId, breed, tapRaw) {
    if (!pigeons_1.BREED_BY_ID.has(breed))
        return { ok: false, reason: "not_owned" };
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        await lockDuelMutations(client);
        const d = await client.query(`SELECT * FROM pigeon_duels WHERE id=$1 AND to_chat=$2 FOR UPDATE`, [duelId, chatId]);
        if (!d.rowCount) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_found" };
        }
        const duel = d.rows[0];
        // Идентификатор дуэли сам служит idempotency-key: если commit прошёл, а ответ
        // потерялся, повтор возвращает сохранённый результат и ничего не списывает снова.
        if (duel.status === "done" && duel.result && duel.winner_chat != null) {
            const current = await client.query(`SELECT balance, energy, state_revision FROM clicker_state WHERE chat_id=$1`, [chatId]);
            await client.query("ROLLBACK");
            const state = current.rows[0];
            return {
                ...duelResultFor(duel.result, chatId, Number(duel.stake) || 0, Number(duel.winner_chat), state ? Number(state.balance) : undefined),
                newEnergy: state ? Number(state.energy) : undefined,
                revision: state ? Number(state.state_revision || 0) : undefined,
                duplicate: true,
            };
        }
        if (duel.status !== "open") {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_found" };
        }
        const opponent = await client.query(`SELECT admin_blocked FROM clicker_state WHERE chat_id=$1`, [Number(duel.from_chat)]);
        if (!opponent.rowCount || opponent.rows[0].admin_blocked) {
            const stake = Number(duel.stake) || 0;
            await client.query(`UPDATE pigeon_duels SET status='cancelled', closed_at=NOW() WHERE id=$1`, [duelId]);
            if (stake > 0 && opponent.rowCount) {
                await client.query(`UPDATE clicker_state SET balance=balance+$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`, [Number(duel.from_chat), stake]);
            }
            await client.query("COMMIT");
            return { ok: false, reason: "opponent_blocked" };
        }
        const stats = await getDuelStats(client, chatId, breed);
        if (!stats) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_owned" };
        }
        const { refreshEnergyFor } = await Promise.resolve().then(() => __importStar(require("./clicker")));
        const st = await refreshEnergyFor(client, chatId);
        const stake = Number(duel.stake) || 0;
        if (st.energy < exports.DRAG_ENERGY_COST) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "no_energy" };
        }
        if (st.balance < stake) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_enough_coins" };
        }
        const names = await client.query(`SELECT chat_id, first_name, username FROM subscribers WHERE chat_id IN ($1,$2)`, [Number(duel.from_chat), chatId]);
        const nameFor = (id, fallback) => duelName(names.rows.find((r) => Number(r.chat_id) === id), fallback);
        const tap = normalizeDuelTap(tapRaw);
        const resolved = resolveDuel(Number(duel.from_chat), chatId, nameFor(Number(duel.from_chat), "Друг"), nameFor(chatId, "Друг"), duel.from_stats, stats, duel.from_tap, tap);
        const energyLeft = st.energy - exports.DRAG_ENERGY_COST;
        let balance = st.balance - stake;
        const bank = stake * 2;
        if (resolved.winnerChat === chatId)
            balance += bank;
        const updated = await client.query(`UPDATE clicker_state SET energy=$2, balance=$3, race_reaction_ms=$4, energy_carry=$5, state_revision=state_revision+1, updated_at=NOW(), energy_updated_at=NOW() WHERE chat_id=$1 RETURNING state_revision`, [chatId, energyLeft, balance, clampReact(tap.reactionMs), st.energyCarry]);
        if (resolved.winnerChat !== chatId && bank > 0)
            await client.query(`UPDATE clicker_state SET balance=balance+$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`, [Number(duel.from_chat), bank]);
        await client.query(`UPDATE pigeon_duels SET status='done', to_breed=$2, to_tap=$3::jsonb, to_stats=$4::jsonb, winner_chat=$5, result=$6::jsonb, closed_at=NOW() WHERE id=$1`, [duelId, breed, JSON.stringify(tap), JSON.stringify(stats), resolved.winnerChat, JSON.stringify(resolved)]);
        await client.query("COMMIT");
        return { ...duelResultFor(resolved, chatId, stake, resolved.winnerChat, balance), newEnergy: energyLeft, revision: Number(updated.rows[0]?.state_revision || 0) };
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}
// ── Кэш соперников: превью (/drag/opponents) и сам заезд (runRace) раньше независимо
// звали pickOpponents с ORDER BY random() → на старте показывались одни голуби, а гонялись
// другие. Теперь превью кэширует свой набор, а заезд его забирает (one-shot, TTL), так что
// «кого показали — с тем и гонишься». Ключ (chatId:breed:mode) — режимы не делят поле.
// In-memory: сервис одно-процессный (docker), превью→заезд идут подряд секундами.
const OPP_CACHE_TTL_MS = 5 * 60000;
const oppCache = new Map();
function oppKey(chatId, breed, mode) { return chatId + ":" + breed + ":" + mode; }
function cacheOpponents(chatId, breed, mode, racers) {
    oppCache.set(oppKey(chatId, breed, mode), { racers, ts: Date.now() });
    if (oppCache.size > 5000) { // защита от разрастания: чистим протухшее при переполнении
        const now = Date.now();
        for (const [k, v] of oppCache)
            if (now - v.ts > OPP_CACHE_TTL_MS)
                oppCache.delete(k);
        if (oppCache.size > 5000)
            oppCache.delete(oppCache.keys().next().value);
    }
}
// Забираем и удаляем (one-shot): повторный заезд без нового превью подберёт свежих.
function takeCachedOpponents(chatId, breed, mode) {
    const k = oppKey(chatId, breed, mode);
    const hit = oppCache.get(k);
    if (!hit)
        return null;
    oppCache.delete(k);
    if (Date.now() - hit.ts > OPP_CACHE_TTL_MS)
        return null;
    return hit.racers;
}
// ── Мощность игрока для породы ─────────────────────────────────────────────
// Возвращает мощность голубя в инвентаре или null если не владеет.
async function dragTargetPower(chatId, breed) {
    const row = (await db_1.pool.query(`SELECT stars, tune_speed, tune_stamina FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed])).rows[0];
    if (!row)
        return null;
    const b = pigeons_1.BREED_BY_ID.get(breed);
    if (!b)
        return null;
    return dragPower(b.rarity, row.stars, row.tune_speed, row.tune_stamina);
}
async function dragTargetProfile(chatId, breed) {
    const row = (await db_1.pool.query(`SELECT stars, tune_speed, tune_stamina FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed])).rows[0];
    if (!row)
        return null;
    const b = pigeons_1.BREED_BY_ID.get(breed);
    if (!b)
        return null;
    return {
        power: dragPower(b.rarity, row.stars, row.tune_speed, row.tune_stamina),
        match: dragMatchPowerV3(b.rarity, row.stars, row.tune_speed),
    };
}
// ── Резолв заезда в транзакции ──────────────────────────────────────────────
// Всё под FOR UPDATE clicker_state (внутри refreshEnergyFor): реген энергии → проверки
// (владение породой/энергия/ставка) → подбор соперников → резолв мест → списание энергии
// + расчёт/начисление ставки → фиксация race_reaction_ms (для будущего pickOpponents).
async function runRace(chatId, breed, mode, stake, reactionMs, launch, tap, requestId = "") {
    if (!pigeons_1.BREED_BY_ID.has(breed))
        return { ok: false, reason: "not_owned" };
    if (mode !== "training" && mode !== "bet")
        return { ok: false, reason: "bad_mode" };
    if (mode === "bet" && !exports.STAKE_PRESETS.includes(stake))
        return { ok: false, reason: "bad_stake" };
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        if (requestId) {
            // Один и тот же заезд после сетевого таймаута должен вернуть прежний результат,
            // а не второй раз списать энергию/ставку. Advisory-lock закрывает параллельный дубль.
            await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`pigeon-drag:${chatId}:${requestId}`]);
            const previous = await client.query(`SELECT response FROM pigeon_drag_runs WHERE chat_id=$1 AND request_id=$2`, [chatId, requestId]);
            if (previous.rowCount) {
                // Исход гонки неизменен, но сохранённые тогда balance/energy уже могли
                // устареть из-за последующих действий. Повтор возвращает текущий кошелёк.
                const current = await client.query(`SELECT balance, energy, state_revision FROM clicker_state WHERE chat_id=$1`, [chatId]);
                await client.query("ROLLBACK");
                return {
                    ...(previous.rows[0].response || {}), ok: true, duplicate: true,
                    newBalance: current.rows[0] ? Number(current.rows[0].balance) : undefined,
                    newEnergy: current.rows[0] ? Number(current.rows[0].energy) : undefined,
                    revision: current.rows[0] ? Number(current.rows[0].state_revision || 0) : undefined,
                };
            }
        }
        // Энергия/баланс с регеном — та же строка clicker_state, что и в кликере, взятая
        // FOR UPDATE в этой же транзакции, чтобы не словить гонку с параллельным тапом/заездом.
        const { refreshEnergyFor } = await Promise.resolve().then(() => __importStar(require("./clicker")));
        const st = await refreshEnergyFor(client, chatId);
        const inv = await client.query(`SELECT stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed]);
        if (!inv.rowCount) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_owned" };
        }
        if (st.energy < exports.DRAG_ENERGY_COST) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "no_energy" };
        }
        if (mode === "bet" && st.balance < stake) {
            await client.query("ROLLBACK");
            return { ok: false, reason: "not_enough_coins" };
        }
        const b = pigeons_1.BREED_BY_ID.get(breed);
        const myPower = dragPower(b.rarity, inv.rows[0].stars, inv.rows[0].tune_speed, inv.rows[0].tune_stamina);
        const myMatch = dragMatchPowerV3(b.rarity, inv.rows[0].stars, inv.rows[0].tune_speed);
        // «Кого показали в превью — с тем и гонимся»: берём закэшированный набор старта; если его
        // нет (заезд без превью / истёк TTL) — подбираем свежий как раньше.
        const picked = takeCachedOpponents(chatId, breed, mode)
            ?? await (tap ? pickOpponentsV3(chatId, myMatch, 3, client) : pickOpponents(chatId, myPower, 3, client));
        const react = clampReact(Math.round(tap ? tap.reactionMs : launch ? launch.reactionMs : reactionMs));
        // Один рандомный «luck»-ролл на гонщика, зафиксированный ДО резолва — места и finishT
        // ниже должны использовать один и тот же r по индексу, иначе места и показанное
        // время анимации разъедутся (клиент анимирует по finishT).
        let racersUnsorted;
        let places;
        let mySkillOut = undefined;
        if (tap) {
            // v3 «Тап-заезд»: мой навык из числа тапов (стамина = эффективность), крейсер от
            // скорости, удача сжимает разброс; соперникам tap-навык раздаёт сервер (bet —
            // конкурентный диапазон + гард мощности, training — шире и добрее).
            const myCruise = cruisePower(b.rarity, inv.rows[0].stars, inv.rows[0].tune_speed);
            const myLuck = inv.rows[0].tune_luck ?? 0;
            const mySkill = tapSkill(tap, inv.rows[0].tune_stamina);
            const opps = assignFieldSkillV3(picked, mode, myMatch, mySkill);
            const tapSpeedBoost = exports.TAP_SPEED_BOOST;
            const field = [
                { breed, cruise: myCruise, skill: mySkill, luck: myLuck, power: myPower, bot: false, name: undefined, friend: false, me: true, tapSpeedBoost },
                ...opps.map(o => ({ breed: o.breed, cruise: o.cruise, skill: o.skill, luck: o.luck, power: o.power, bot: o.bot, name: o.name, friend: o.friend, me: false, tapSpeedBoost })),
            ];
            const rolls = field.map(() => Math.random());
            places = resolveRaceV3(field.map((f, i) => ({ cruise: f.cruise, skill: f.skill, luck: f.luck, r: rolls[i], tapSpeedBoost: f.tapSpeedBoost })));
            racersUnsorted = field.map((f, i) => ({
                breed: f.breed, power: f.power,
                finishT: dragFinishTimeV3(f.cruise, f.skill, f.luck, rolls[i], f.tapSpeedBoost),
                place: places[i], me: f.me, bot: f.bot, name: f.name, friend: f.friend,
            }));
            const clampedTaps = clampTapCount(tap.count, tap.durationMs);
            mySkillOut = {
                taps: clampedTaps, tapAcc: tapAccuracy(clampedTaps, inv.rows[0].tune_stamina),
                react: reactAccuracy(tap.reactionMs), reactionMs: react, total: mySkill,
            };
        }
        else if (launch) {
            // v2 «Идеальный запуск»: мой skill из трёх инпутов, соперникам skill раздаёт сервер
            // (bet — конкурентный диапазон + гард мощности, training — шире и добрее).
            const opps = assignFieldSkill(picked, mode, myPower);
            const mySkill = launchSkill(launch);
            const field = [
                { breed, power: myPower, skill: mySkill, bot: false, name: undefined, friend: false, me: true },
                ...opps.map(o => ({ breed: o.breed, power: o.power, skill: o.skill, bot: o.bot, name: o.name, friend: o.friend, me: false })),
            ];
            const rolls = field.map(() => Math.random());
            places = resolveRaceV2(field.map((f, i) => ({ power: f.power, skill: f.skill, r: rolls[i] })));
            racersUnsorted = field.map((f, i) => ({
                breed: f.breed, power: f.power,
                finishT: dragFinishTimeV2(f.power, f.skill, rolls[i]),
                place: places[i], me: f.me, bot: f.bot, name: f.name, friend: f.friend,
            }));
            mySkillOut = {
                rev1: revAccuracy(launch.rev1),
                react: reactAccuracy(launch.reactionMs), reactionMs: react, total: mySkill,
            };
        }
        else {
            // Легаси-путь v1 (кэшированные клиенты catdrag ≤4 шлют только reactionMs).
            const opps = mode === "bet" ? hardenBetField(picked, myPower) : picked;
            const field = [
                { breed, power: myPower, reactionMs: react, bot: false, name: undefined, friend: false, me: true },
                ...opps.map(o => ({ breed: o.breed, power: o.power, reactionMs: o.reactionMs, bot: o.bot, name: o.name, friend: o.friend, me: false })),
            ];
            const rolls = field.map(() => Math.random());
            places = resolveRace(field.map((f, i) => ({ power: f.power, reactionMs: f.reactionMs, r: rolls[i] })));
            racersUnsorted = field.map((f, i) => ({
                breed: f.breed, power: f.power,
                finishT: dragFinishTime(f.power, f.reactionMs, rolls[i]),
                place: places[i], me: f.me, bot: f.bot, name: f.name, friend: f.friend,
            }));
        }
        // НЕ сортировать по месту: клиент рисует дорожку по индексу массива — сортировка
        // пересаживала игрока со стартовой (верхней) линии на «дорожку = финишное место»
        // и спойлерила исход (победитель всегда сверху). Порядок поля: я — индекс 0,
        // соперники следом; пьедестал в результатах клиент сортирует сам по r.place.
        const racers = racersUnsorted;
        const myPlace = places[0];
        // Списания/выплата: энергия списывается всегда (training тоже тратит попытку); ставка —
        // только в режиме bet, и только после проверки balance>=stake выше, так что баланс не
        // может уйти в минус даже при полном проигрыше (reward = -stake).
        const energyLeft = st.energy - exports.DRAG_ENERGY_COST;
        let balance = st.balance, reward = 0;
        if (mode === "bet") {
            const mult = exports.PAYOUT[myPlace] ?? 0; // 2=+ставка net, 1=возврат (net 0), 0/undefined=потеря
            reward = stake * mult - stake;
            balance += reward;
        }
        // updated_at=NOW() сбрасывает базу регена — иначе следующий refresh() в кликере досчитает
        // энергию ещё раз за те же секунды, что уже учёл refreshEnergyFor выше (двойной реген).
        const updated = await client.query(`UPDATE clicker_state SET energy=$2, balance=$3, race_reaction_ms=$4, energy_carry=$5, state_revision=state_revision+1, updated_at=NOW(), energy_updated_at=NOW() WHERE chat_id=$1 RETURNING state_revision`, [chatId, energyLeft, balance, react, st.energyCarry]);
        const result = { ok: true, racers, myPlace, reward, newBalance: balance, newEnergy: energyLeft, revision: Number(updated.rows[0]?.state_revision || 0), mySkill: mySkillOut };
        if (requestId) {
            await client.query(`INSERT INTO pigeon_drag_runs (chat_id, request_id, response) VALUES ($1,$2,$3::jsonb)`, [chatId, requestId, JSON.stringify(result)]);
        }
        await client.query("COMMIT");
        return result;
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
}

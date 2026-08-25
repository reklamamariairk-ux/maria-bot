"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CASE_LOSS_PITY = exports.CASE_TOTAL_WEIGHT = exports.CASE_SLOTS = exports.canGrantCaseBusinessLevel = exports.CASE_BUSINESS_LEVEL_VALUE_CAP = exports.CASE_COST = void 0;
exports.protectCaseLossStreak = protectCaseLossStreak;
exports.caseEV = caseEV;
exports.rollCase = rollCase;
exports.prizeValue = prizeValue;
const pigeons_1 = require("./pigeons");
exports.CASE_COST = 100000; // цена открытия кейса, монеты
exports.CASE_BUSINESS_LEVEL_VALUE_CAP = 300000;
const canGrantCaseBusinessLevel = (marketValue) => Number.isFinite(marketValue) && marketValue >= 0 && marketValue <= exports.CASE_BUSINESS_LEVEL_VALUE_CAP;
exports.canGrantCaseBusinessLevel = canGrantCaseBusinessLevel;
// Условная ценность бустов в монетах — только для расчёта EV/эджа (буст = разовый).
const TURBO_VALUE = 1500, ENERGY_VALUE = 1200;
const coinsSlot = (key, weight, lo, hi) => ({
    key, weight,
    roll: (r) => ({ type: "coins", amount: Math.round(lo + r * (hi - lo)) }),
    evValue: (lo + hi) / 2,
});
const pigeonSlot = (rarity, weight) => ({
    key: "pigeon_" + rarity, weight,
    roll: () => ({ type: "pigeon", rarity }),
    evValue: pigeons_1.PIGEON_PRICE[rarity],
});
const businessSlot = (id, weight, value) => ({
    key: "business_" + id, weight,
    roll: () => ({ type: "business", id }),
    evValue: value,
});
// CS2-подобная таблица: частые дешёвые результаты, редкие игровые предметы и
// сверхприз 10 млн. Веса суммируются до 10000 (0.01% на единицу).
exports.CASE_SLOTS = [
    coinsSlot("coins_zero", 1745, 0, 0),
    coinsSlot("coins_loss", 3000, 10000, 50000),
    coinsSlot("coins_slight_under", 2000, 60000, 90000),
    coinsSlot("coins_equal", 800, 100000, 100000),
    coinsSlot("coins_plus", 700, 110000, 160000),
    coinsSlot("coins_big", 600, 200000, 400000),
    coinsSlot("coins_jackpot", 50, 500000, 1500000),
    coinsSlot("coins_super_jackpot", 5, 10000000, 10000000),
    pigeonSlot("common", 500),
    pigeonSlot("rare", 300),
    pigeonSlot("epic", 50),
    businessSlot("region", 100, 100000),
    businessSlot("loyalty", 80, 100000),
    businessSlot("manager", 40, 100000),
    businessSlot("franchise", 30, 100000),
];
exports.CASE_TOTAL_WEIGHT = exports.CASE_SLOTS.reduce((s, x) => s + x.weight, 0);
// После пяти призов рыночной ценностью ниже ставки следующая попытка как минимум
// окупается. Защита останавливает плохую серию, но не создаёт гарантированную прибыль.
exports.CASE_LOSS_PITY = 5;
function protectCaseLossStreak(prize, lossStreak, r) {
    if (lossStreak < exports.CASE_LOSS_PITY || prizeValue(prize) >= exports.CASE_COST)
        return prize;
    return { type: "coins", amount: Math.round(exports.CASE_COST + Math.max(0, Math.min(1, r)) * 40000) };
}
// Средняя ценность приза (EV) и домовый эдж — без учёта гейта чемпиона (его вклад
// в реальности ~0, т.к. падает ≤1 раза в год; для «сырого» EV считаем как есть,
// но есть и evNoChampion — реалистичный EV на дистанции).
function caseEV() {
    const w = exports.CASE_TOTAL_WEIGHT;
    let ev = 0, evNoChamp = 0;
    for (const s of exports.CASE_SLOTS) {
        ev += (s.weight / w) * s.evValue;
        evNoChamp += (s.weight / w) * s.evValue;
    }
    return { ev, evNoChampion: evNoChamp, edge: 1 - ev / exports.CASE_COST, edgeNoChampion: 1 - evNoChamp / exports.CASE_COST };
}
// Розыгрыш приза. r1 ∈ [0,1) выбирает слот по весам, r2 ∈ [0,1) — значение внутри слота.
function rollCase(r1, r2, _championAllowed = false) {
    const target = r1 * exports.CASE_TOTAL_WEIGHT;
    let acc = 0;
    for (const s of exports.CASE_SLOTS) {
        acc += s.weight;
        if (target < acc) {
            return s.roll(r2);
        }
    }
    // страховка от накопленной погрешности — последний слот
    return { type: "coins", amount: Math.round(40000 + r2 * 30000) };
}
// Ценность приза в монетах (для учёта case_won игрока — «казино»-баланс дом/игрок).
function prizeValue(prize) {
    switch (prize.type) {
        case "coins": return prize.amount;
        case "turbo": return TURBO_VALUE;
        case "energy": return ENERGY_VALUE;
        case "pigeon": return pigeons_1.PIGEON_PRICE[prize.rarity];
        case "business": return 100000; // фактическая цена уровня уточняется при выдаче
    }
}

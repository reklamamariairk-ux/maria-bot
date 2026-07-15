// scripts/test-pigeons.mjs — тесты чистых функций голубей. Запуск: npm run build && node scripts/test-pigeons.mjs
import assert from "node:assert/strict";
import { PIGEON_BREEDS, PIGEON_SETS, breedOfWeek, pickBreed, pickPurchaseBreed, starTarget, raceScore, BREED_BY_ID } from "../dist/pigeons.js";

assert.equal(PIGEON_BREEDS.length, 17);
assert.equal(PIGEON_SETS.length, 4);
for (const s of PIGEON_SETS) assert.equal(PIGEON_BREEDS.filter(b => b.set === s.id).length, 4);

// breedOfWeek детерминирован и не «champion»
assert.equal(breedOfWeek("2026-W29"), breedOfWeek("2026-W29"));
assert.notEqual(breedOfWeek("2026-W29"), "champion");

// вне ивента fest не дропается никогда; champion — никогда вообще
for (let i = 0; i < 5000; i++) {
  const id = pickBreed(Math.random(), Math.random(), "2026-W29", false);
  const b = BREED_BY_ID.get(id);
  assert.ok(b && b.set !== "fest" && id !== "champion", `bad drop ${id}`);
}
// в ивент fest дропается (статистически: 5000 бросков хватит)
let fest = 0;
for (let i = 0; i < 5000; i++) if (BREED_BY_ID.get(pickBreed(Math.random(), Math.random(), "2026-W29", true)).set === "fest") fest++;
assert.ok(fest > 0, "fest must drop during events");

// порода недели реально бустится: частота boost-породы > средней по её редкости
const week = "2026-W30"; const boost = breedOfWeek(week);
const boostRarity = BREED_BY_ID.get(boost).rarity;
const peers = PIGEON_BREEDS.filter(b => b.rarity === boostRarity && b.set !== "fest" && b.id !== "champion");
const cnt = Object.fromEntries(peers.map(p => [p.id, 0]));
for (let i = 0; i < 20000; i++) { const id = pickBreed(Math.random(), Math.random(), week, false); if (id in cnt) cnt[id]++; }
if (peers.length > 1 && boost in cnt) {
  const others = peers.filter(p => p.id !== boost).map(p => cnt[p.id]);
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  assert.ok(cnt[boost] > avg * 1.8, `week boost weak: ${cnt[boost]} vs avg ${avg}`);
}

// покупка: только rare+; вне ивента без fest
for (let i = 0; i < 5000; i++) {
  const b = BREED_BY_ID.get(pickPurchaseBreed(Math.random(), Math.random(), false));
  assert.ok(b.rarity !== "common" && b.set !== "fest" && b.id !== "champion");
}

assert.equal(starTarget(1), 3); assert.equal(starTarget(2), 5); assert.equal(starTarget(3), null);
assert.ok(raceScore("zolotoy", 3, 0) > raceScore("sizar", 1, 0));
assert.ok(raceScore("sizar", 1, 0.999) > raceScore("zolotoy", 3, 0)); // новичок МОЖЕТ выиграть
console.log("test-pigeons: OK");

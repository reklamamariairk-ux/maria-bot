// E2E драг-рейсинга против живой БД. Запуск внутри контейнера maria-bot.
// Тестовые chat_id 1.99e12 (выше TG, ниже VK-сдвига). В finally всё удаляется.
import { pool } from "./dist/db.js";
import { grantPigeon, upgradeTune } from "./dist/pigeons.js";
import { runRace, pickOpponents, dragTargetPower, DRAG_ENERGY_COST, STAKE_PRESETS, PAYOUT, REACT_MIN } from "./dist/drag.js";

const B = 1990000000000;
const A1 = B + 1, A2 = B + 2, A3 = B + 3;
const ALL = [A1, A2, A3];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK", m); } else { fail++; console.log("  FAIL:", m); } };
const seed = (chat, energy, balance) => pool.query(
  `INSERT INTO clicker_state (chat_id, energy, balance, total_earned) VALUES ($1,$2,$3,$3)
   ON CONFLICT (chat_id) DO UPDATE SET energy=$2, balance=$3`, [chat, energy, balance]);

try {
  console.log("STAKE_PRESETS:", STAKE_PRESETS.join(","), "| DRAG_ENERGY_COST:", DRAG_ENERGY_COST);

  // сид: A1 — сильный голубь + энергия/монеты; A2/A3 — соперники по мощности
  await grantPigeon(A1, "zolotoy"); await seed(A1, 1000, 200000);
  for (let i = 0; i < 8; i++) await upgradeTune(A1, "zolotoy", "speed");
  await grantPigeon(A2, "zolotoy"); await seed(A2, 1000, 200000);
  for (let i = 0; i < 6; i++) await upgradeTune(A2, "zolotoy", "speed");
  await grantPigeon(A3, "baikal"); await seed(A3, 1000, 200000);
  for (let i = 0; i < 5; i++) await upgradeTune(A3, "baikal", "speed");

  // dragTargetPower + подбор соперников
  console.log("\n[O] pickOpponents");
  const myPower = await dragTargetPower(A1, "zolotoy");
  ok(typeof myPower === "number" && myPower > 0, "dragTargetPower вернул мощность (=" + myPower + ")");
  const opps = await pickOpponents(A1, myPower, 3);
  ok(opps.length === 3, "подобрано ровно 3 соперника (реальные + добивка ботами, =" + opps.length + ")");
  ok(opps.every(o => Math.abs(o.power - myPower) <= 40), "мощность соперников близка к моей");

  // тренировка: энергия -250, баланс не тронут
  console.log("\n[T] runRace training");
  await seed(A1, 1000, 200000);
  const t = await runRace(A1, "zolotoy", "training", 0, 250);
  ok(t.ok && t.racers.length === 4, "тренировка: 4 гонщика");
  ok([1,2,3,4].includes(t.myPlace), "место в 1..4 (=" + t.myPlace + ")");
  ok(t.newEnergy === 1000 - DRAG_ENERGY_COST, "энергия -" + DRAG_ENERGY_COST + " (=" + t.newEnergy + ")");
  ok(t.newBalance === 200000, "баланс НЕ тронут в тренировке");
  ok((t.racers.every(r => typeof r.finishT === "number")), "у гонщиков есть finishT для анимации");

  // ставка: выплата соответствует месту, энергия -250
  console.log("\n[B] runRace bet");
  await seed(A1, 1000, 200000);
  const stake = STAKE_PRESETS[0];
  const b = await runRace(A1, "zolotoy", "bet", stake, 200);
  ok(b.ok && [1,2,3,4].includes(b.myPlace), "ставка: заезд прошёл, место " + b.myPlace);
  const expectReward = stake * (PAYOUT[b.myPlace] ?? 0) - stake; // 1→+stake, 2→0, 3-4→−stake
  ok(b.reward === expectReward, `выплата = ${b.reward} (ожидалось ${expectReward} для места ${b.myPlace})`);
  ok(b.newBalance === 200000 + expectReward, "баланс изменился ровно на выплату");
  ok(b.newEnergy === 1000 - DRAG_ENERGY_COST, "энергия -" + DRAG_ENERGY_COST + " и в ставке");

  // нет энергии
  console.log("\n[E] защита ресурсов");
  await seed(A1, 100, 200000);
  const noE = await runRace(A1, "zolotoy", "training", 0, 200);
  ok(!noE.ok && noE.reason === "no_energy", "мало энергии → no_energy");
  const bal0 = Number((await pool.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [A1])).rows[0].balance);
  ok(bal0 === 200000, "при no_energy ничего не списано");
  // нет монет на ставку
  await seed(A1, 1000, 100);
  const noC = await runRace(A1, "zolotoy", "bet", 2000, 200);
  ok(!noC.ok && noC.reason === "not_enough_coins", "мало монет → not_enough_coins");
  // не владеет
  const noOwn = await runRace(A1, "kurier", "training", 0, 200);
  ok(!noOwn.ok && noOwn.reason === "not_owned", "не владеет породой → not_owned");
  // плохая ставка
  const badS = await runRace(A1, "zolotoy", "bet", 777, 200);
  ok(!badS.ok && badS.reason === "bad_stake", "ставка не из пресетов → bad_stake");

  // v2 «Идеальный запуск»: skill-инпут → v2-резолв, брейкдаун в ответе, реакция в БД
  console.log("\n[V2] launch-механика");
  await seed(A1, 1000, 200000);
  const v2 = await runRace(A1, "zolotoy", "bet", stake, 300, { rev1: 40, rev2: -60, reactionMs: 300 });
  ok(v2.ok && [1, 2, 3, 4].includes(v2.myPlace), "v2 ставка: заезд прошёл, место " + v2.myPlace);
  ok(v2.reward === stake * (PAYOUT[v2.myPlace] ?? 0) - stake, "v2 выплата соответствует месту");
  ok(!!v2.mySkill && v2.mySkill.total > 0.7 && v2.mySkill.total <= 1, "v2 mySkill.total разумный для хорошего запуска (=" + (v2.mySkill ? v2.mySkill.total.toFixed(2) : "нет") + ")");
  ok(!!v2.mySkill && v2.mySkill.rev1 > v2.mySkill.rev2, "v2 брейкдаун: rev1(40мс) точнее rev2(60мс)");
  ok(v2.racers.every(r => typeof r.finishT === "number"), "v2 finishT есть у всех гонщиков");
  const rrV2 = Number((await pool.query(`SELECT race_reaction_ms FROM clicker_state WHERE chat_id=$1`, [A1])).rows[0].race_reaction_ms);
  ok(rrV2 === 300, "v2 реакция записана в race_reaction_ms (=" + rrV2 + ")");
  // легаси-вызов (без launch) продолжает работать — кэшированные клиенты v4
  await seed(A1, 1000, 200000);
  const lg = await runRace(A1, "zolotoy", "training", 0, 250);
  ok(lg.ok && lg.mySkill === undefined, "легаси-путь без skill жив, mySkill отсутствует");

  // античит: reactionMs=0 зажимается до REACT_MIN в БД
  console.log("\n[C] античит реакции");
  await seed(A1, 1000, 200000);
  await runRace(A1, "zolotoy", "training", 0, 0);
  const rr = Number((await pool.query(`SELECT race_reaction_ms FROM clicker_state WHERE chat_id=$1`, [A1])).rows[0].race_reaction_ms);
  ok(rr === REACT_MIN, "reactionMs=0 → в БД зажато до REACT_MIN=" + REACT_MIN + " (=" + rr + ")");

  console.log(`\n=== ИТОГ: ${pass} pass, ${fail} fail ===`);
} catch (e) { console.error("EXCEPTION:", e); fail++; }
finally {
  console.log("\n[cleanup]...");
  await pool.query("DELETE FROM pigeon_inventory WHERE chat_id = ANY($1)", [ALL]).catch(() => {});
  await pool.query("DELETE FROM clicker_state WHERE chat_id = ANY($1)", [ALL]).catch(() => {});
  const l = await pool.query("SELECT (SELECT COUNT(*) FROM pigeon_inventory WHERE chat_id=ANY($1)) i, (SELECT COUNT(*) FROM clicker_state WHERE chat_id=ANY($1)) s", [ALL]).catch(() => ({ rows: [{ i: "?", s: "?" }] }));
  console.log(`[cleanup] осталось: inv=${l.rows[0].i} state=${l.rows[0].s} (должно быть 0)`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

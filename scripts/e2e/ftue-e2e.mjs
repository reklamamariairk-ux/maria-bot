// E2E FTUE «Первый день» против живой БД. Запуск внутри контейнера maria-bot.
import { pool } from "./dist/db.js";
import { getFtue, claimFtue, FTUE_STEPS } from "./dist/clicker.js";
import { grantPigeon } from "./dist/pigeons.js";

const A = 1990000000007;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK", m); } else { fail++; console.log("  FAIL:", m); } };

try {
  await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy) VALUES ($1, 0, 0, 1000)
    ON CONFLICT (chat_id) DO UPDATE SET balance=0, total_earned=0, ftue_claimed=0, chest_date=NULL, race_reaction_ms=NULL`, [A]);
  await pool.query(`DELETE FROM clicker_cards WHERE chat_id=$1`, [A]);
  await pool.query(`DELETE FROM pigeon_inventory WHERE chat_id=$1`, [A]);

  const f0 = await getFtue(A);
  ok(f0.steps.length === FTUE_STEPS.length, "5 шагов в чеклисте");
  ok(f0.steps.every(s => !s.done && !s.claimed), "новичок: всё не сделано");
  const early = await claimFtue(A, 0);
  ok(!early.ok && early.reason === "not_done", "клейм несделанного → not_done");

  // выполняем шаги: тапы (total_earned), пекарня, сундук, голубь, заезд
  await pool.query(`UPDATE clicker_state SET total_earned=60, chest_date='2026-01-01', race_reaction_ms=300 WHERE chat_id=$1`, [A]);
  await pool.query(`INSERT INTO clicker_cards (chat_id, card, level) VALUES ($1,'bakery',1) ON CONFLICT (chat_id, card) DO UPDATE SET level=1`, [A]);
  await grantPigeon(A, "sizar");

  const f1 = await getFtue(A);
  ok(f1.steps.every(s => s.done), "все шаги детектятся из состояния");
  const c0 = await claimFtue(A, 0);
  ok(c0.ok && c0.reward === FTUE_STEPS[0].reward, "клейм шага 0 → +" + FTUE_STEPS[0].reward);
  const again = await claimFtue(A, 0);
  ok(!again.ok && again.reason === "already", "повторный клейм → already");
  for (let i = 1; i < FTUE_STEPS.length; i++) await claimFtue(A, i);
  const f2 = await getFtue(A);
  ok(f2.allClaimed, "все забраны → allClaimed");
  const bal = Number((await pool.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [A])).rows[0].balance);
  const total = FTUE_STEPS.reduce((m, s) => m + s.reward, 0);
  ok(bal === total, `баланс = сумме наград (${bal} == ${total})`);
  const badStep = await claimFtue(A, 99);
  ok(!badStep.ok && badStep.reason === "bad_step", "неизвестный шаг → bad_step");

  console.log(`\n=== ИТОГ: ${pass} pass, ${fail} fail ===`);
} catch (e) { console.error("EXCEPTION:", e); fail++; }
finally {
  await pool.query(`DELETE FROM pigeon_inventory WHERE chat_id=$1`, [A]).catch(() => {});
  await pool.query(`DELETE FROM clicker_cards WHERE chat_id=$1`, [A]).catch(() => {});
  await pool.query(`DELETE FROM clicker_state WHERE chat_id=$1`, [A]).catch(() => {});
  await pool.end();
  process.exit(fail ? 1 : 0);
}

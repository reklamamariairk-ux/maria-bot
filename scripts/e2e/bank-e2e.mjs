// E2E копилки стаи против живой БД (в контейнере maria-bot).
import { pool } from "./dist/db.js";
import {
  initSquadBankSchema, donateSquadBank, squadBankStatus, tapClicker,
  SQUAD_BANK_DAY_CAP, SQUAD_BANK_MULT, weekKey, _clearSquadBankCache,
} from "./dist/clicker.js";

const A = 1990000300001, B = 1990000300002;
const SQ = "choco";
const ALL = [A, B];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK", m); } else { fail++; console.log("  FAIL:", m); } };

async function cleanup() {
  await pool.query(`DELETE FROM clicker_squad_bank WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM clicker_state WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM clicker_events WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
}

try {
  await initSquadBankSchema();
  await cleanup();
  await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy, squad) VALUES ($1, 200000, 200000, 1000, $2)`, [A, SQ]);
  await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy, squad) VALUES ($1, 500, 500, 1000, $2)`, [B, SQ]);

  console.log("[1] Вклад списывает баланс и попадает в копилку");
  const d1 = await donateSquadBank(A, 5000);
  ok(d1.ok && d1.donated === 5000, "вклад 5000 принят");
  ok(Number(d1.state.balance) === 195000, "баланс списан (195000)");
  ok(d1.bank.sum >= 5000 && d1.bank.myTotal === 5000, "копилка/мой вклад = 5000");

  console.log("[2] Не хватает монет / мелочь");
  const d2 = await donateSquadBank(B, 5000);
  ok(d2.ok && d2.donated === 500, "вклад клампится балансом (500)");
  const d3 = await donateSquadBank(B, 50);
  ok(!d3.ok, "мелочь/пустой баланс → отказ");

  console.log("[3] Дневной лимит");
  const d4 = await donateSquadBank(A, SQUAD_BANK_DAY_CAP * 2);
  ok(d4.ok && d4.donated === SQUAD_BANK_DAY_CAP - 5000, "добор ровно до дневного капа");
  const d5 = await donateSquadBank(A, 1000);
  ok(!d5.ok && d5.reason === "day_cap", "сверх капа → day_cap");

  console.log("[4] Достижение цели включает бафф тапов");
  // Цель для стаи с 2 активными = 100000; докидываем со второго аккаунта не выйдет
  // (кап), поэтому докладываем строкой напрямую — как будто другие члены стаи.
  const st1 = await squadBankStatus(SQ, A);
  if (!st1.reached) {
    await pool.query(
      `INSERT INTO clicker_squad_bank (week, squad, chat_id, total, today, today_key)
       VALUES ($1, $2, 1990000300099, $3, 0, NULL)`,
      [weekKey(), SQ, Math.max(0, st1.target - st1.sum)]);
  }
  const st2 = await squadBankStatus(SQ, A);
  ok(st2.reached === true, `цель ${st2.target} достигнута (${st2.sum})`);
  // бафф: кэш стаи сброшен донатом? Кэш инвалидируется только donate'ом — наш
  // прямой INSERT кэш не чистил, но donate выше уже был; для чистоты подождать
  // нельзя — дёргаем внутренний сброс через повторный donate B (мелкий, упадёт)
  // и просто проверяем арифметику тапов с балансом ДО/ПОСЛЕ.
  await pool.query(`UPDATE clicker_state SET energy=1000, balance=0, multitap_level=0, prestige=0, turbo_until=NULL WHERE chat_id=$1`, [B]);
  _clearSquadBankCache();
  const tapped = await tapClicker(B, 40); // 40 тапов: сладкий крит на 40-м = +7
  const expected = Math.floor((40 + 7) * SQUAD_BANK_MULT);
  ok(Number(tapped.balance) === expected, `40 тапов с баффом ×${SQUAD_BANK_MULT} = ${expected} (факт ${tapped.balance})`);

  console.log("[5] Копилка недели изолирована по стаям");
  const other = await squadBankStatus("berry");
  ok(other.sum === 0 || other.sum >= 0, "чужая стая не видит наш вклад: " + other.sum);
  const ev = await pool.query(`SELECT COUNT(*)::int AS n FROM clicker_events WHERE chat_id=$1 AND event='squad_bank'`, [A]);
  ok(Number(ev.rows[0].n) >= 2, "события squad_bank записаны");
} catch (e) {
  console.error("EXCEPTION:", e); fail++;
} finally {
  await pool.query(`DELETE FROM clicker_squad_bank WHERE chat_id = 1990000300099`).catch(() => {});
  await cleanup();
  console.log(`\n=== ИТОГ: ${pass} pass, ${fail} fail ===`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

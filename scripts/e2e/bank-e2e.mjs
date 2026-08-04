// E2E копилки стаи (адаптивная цель + бафф всего дохода) против живой БД.
import { pool } from "./dist/db.js";
import {
  initSquadBankSchema, donateSquadBank, squadBankStatus, tapClicker, getClicker,
  SQUAD_BANK_DAY_CAP, SQUAD_BANK_MULT, SQUAD_BANK_TARGET_FLOOR, weekKey, _clearSquadBankCache,
} from "./dist/clicker.js";

const A = 1990000300001, B = 1990000300002;
const SQ = "choco";
const ALL = [A, B];
const prevWeek = String(Number(weekKey()) - 7);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK", m); } else { fail++; console.log("  FAIL:", m); } };

async function cleanup() {
  await pool.query(`DELETE FROM clicker_squad_bank WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM squad_week_stats WHERE week=$1 AND squad IN ('choco','vanilla')`, [prevWeek]).catch(() => {});
  await pool.query(`DELETE FROM clicker_state WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM clicker_events WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  _clearSquadBankCache();
}

try {
  await initSquadBankSchema();
  await cleanup();
  await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy, squad) VALUES ($1, 200000, 200000, 1000, $2)`, [A, SQ]);
  await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy, squad) VALUES ($1, 500, 500, 1000, $2)`, [B, SQ]);

  console.log("[1] Адаптивная цель");
  const st0 = await squadBankStatus(SQ, A);
  ok(st0.target === SQUAD_BANK_TARGET_FLOOR, `без истории цель = пол (${st0.target})`);
  await pool.query(`INSERT INTO squad_week_stats (week, squad, earned) VALUES ($1, 'vanilla', 10000000) ON CONFLICT DO NOTHING`, [prevWeek]);
  const stV = await squadBankStatus("vanilla");
  ok(stV.target === 1500000, `история 10M → цель 15% = 1.5M (${stV.target})`);

  console.log("[2] Вклад списывает баланс и попадает в копилку");
  const d1 = await donateSquadBank(A, 5000);
  ok(d1.ok && d1.donated === 5000, "вклад 5000 принят");
  ok(Number(d1.state.balance) === 195000, "баланс списан (195000)");
  ok(d1.bank.sum >= 5000 && d1.bank.myTotal === 5000, "копилка/мой вклад = 5000");
  ok(Array.isArray(d1.bank.topDonors) && d1.bank.topDonors[0] && d1.bank.topDonors[0].total === 5000 && typeof d1.bank.topDonors[0].name === "string", "топ вкладчиков с именем");

  console.log("[3] Кламп: мелочь и баланс");
  const d2 = await donateSquadBank(B, 5000);
  ok(d2.ok && d2.donated === 500, "вклад клампится балансом (500)");
  const d3 = await donateSquadBank(B, 50);
  ok(!d3.ok, "мелочь/пустой баланс → отказ");

  console.log("[4] Достижение цели (порог " + SQUAD_BANK_TARGET_FLOOR + ") этим вкладом");
  const d4 = await donateSquadBank(A, SQUAD_BANK_TARGET_FLOOR); // 5000+500 уже есть → пересечёт
  ok(d4.ok && d4.bank.reached === true, "цель достигнута вкладом A");
  ok(d4.bank.sum - d4.donated < d4.bank.target, "пересечение именно этим вкладом (пуш-условие)");

  console.log("[5] Бафф множит тапы И пассив");
  await pool.query(`UPDATE clicker_state SET energy=1000, balance=0, multitap_level=0, prestige=0, turbo_until=NULL, updated_at=NOW() WHERE chat_id=$1`, [B]);
  _clearSquadBankCache();
  const tapped = await tapClicker(B, 40); // сладкий крит на 40-м: (40+7)·1.25 = 58
  ok(Number(tapped.balance) === Math.floor(47 * SQUAD_BANK_MULT), `40 тапов с баффом = ${Math.floor(47 * SQUAD_BANK_MULT)} (факт ${tapped.balance})`);
  ok(tapped.bankMult === SQUAD_BANK_MULT, `state.bankMult = ${SQUAD_BANK_MULT}`);
  const stateA = await getClicker(A);
  ok(stateA.bankMult === SQUAD_BANK_MULT, "bankMult виден и второму члену стаи");

  console.log("[6] Дневной лимит");
  const already = 5000 + SQUAD_BANK_TARGET_FLOOR;
  const d5 = await donateSquadBank(A, SQUAD_BANK_DAY_CAP * 2);
  ok(d5.ok && d5.donated === SQUAD_BANK_DAY_CAP - already, `добор до дневного капа (${d5.donated})`);
  const d6 = await donateSquadBank(A, 1000);
  ok(!d6.ok && d6.reason === "day_cap", "сверх капа → day_cap");

  console.log("[7] Изоляция стай");
  const other = await squadBankStatus("berry");
  ok(other.sum === 0, "чужая стая не видит наш вклад");
} catch (e) {
  console.error("EXCEPTION:", e); fail++;
} finally {
  await cleanup();
  console.log(`\n=== ИТОГ: ${pass} pass, ${fail} fail ===`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

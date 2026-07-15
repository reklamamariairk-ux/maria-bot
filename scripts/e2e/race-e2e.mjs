// E2E-тест Гонки стаи + тюнинга против живой БД. Запуск внутри контейнера maria-bot.
// Тестовые chat_id 1.99e12 (выше TG, ниже VK-сдвига). В finally всё удаляется.
import { pool } from "./dist/db.js";
import {
  enterRace, getRace, closeRaceWeek, grantPigeon,
  getTuning, upgradeTune, currentWeekKey, previousWeekKey, RACE_ENABLED,
} from "./dist/pigeons.js";

const B = 1990000000000;
const A1 = B + 1, A2 = B + 2, A3 = B + 3, A4 = B + 4;
const ALL = [A1, A2, A3, A4];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };

try {
  ok(RACE_ENABLED === true, "флаг гонки включён");
  const week = await currentWeekKey();
  const prev = await previousWeekKey();
  console.log("week =", week, " prev =", prev);

  // --- Тюнинг ---
  console.log("\n[T] тюнинг гонщика");
  await grantPigeon(A1, "sizar");
  await pool.query("INSERT INTO clicker_state (chat_id,balance,total_earned) VALUES ($1,2000000,2000000) ON CONFLICT (chat_id) DO UPDATE SET balance=2000000", [A1]);
  const t0 = await getTuning(A1, "sizar");
  ok(t0.owned && t0.speed === 0 && t0.division === "bronze", "старт: speed=0, дивизион bronze");
  ok(t0.nextCost.speed === 500, "цена 1-го уровня скорости = 500");
  const up = await upgradeTune(A1, "sizar", "speed");
  ok(up.ok && up.level === 1 && up.spent === 500, "прокачка speed → уровень 1, списано 500");
  const balAfter = await pool.query("SELECT balance FROM clicker_state WHERE chat_id=$1", [A1]);
  ok(Number(balAfter.rows[0].balance) === 1999500, "баланс уменьшился на 500 (=1999500)");
  const badStat = await upgradeTune(A1, "sizar", "nonsense");
  ok(!badStat.ok && badStat.reason === "bad_stat", "неизвестная характеристика → bad_stat");
  // до потолка: докачаем speed до 10, проверим max_level и переход дивизиона
  for (let i = 1; i < 10; i++) await upgradeTune(A1, "sizar", "speed");
  const tMax = await getTuning(A1, "sizar");
  ok(tMax.speed === 10 && tMax.nextCost.speed === null, "speed на потолке 10, nextCost=null");
  const overMax = await upgradeTune(A1, "sizar", "speed");
  ok(!overMax.ok && overMax.reason === "max_level", "прокачка сверх потолка → max_level");
  ok(tMax.division === "silver", "powerRating 10 → дивизион silver");
  // нехватка монет
  await pool.query("UPDATE clicker_state SET balance = 10 WHERE chat_id=$1", [A1]);
  const poor = await upgradeTune(A1, "sizar", "stamina");
  ok(!poor.ok && poor.reason === "not_enough_coins", "без монет → not_enough_coins");
  const notOwned = await upgradeTune(A2, "kurier", "speed");
  ok(!notOwned.ok && notOwned.reason === "not_owned", "не владеешь → not_owned");

  // --- Заявка: снапшот дивизиона ---
  console.log("\n[A] enterRace — снапшот score+division");
  const e1 = await enterRace(A1, "sizar"); // speed=10 → silver
  ok(e1.ok === true, "заявка принята");
  const entryRow = await pool.query("SELECT score, division FROM pigeon_race_entries WHERE week=$1 AND chat_id=$2", [week, A1]);
  ok(entryRow.rows[0].division === "silver", "дивизион заявки = silver (снапшот)");
  ok(entryRow.rows[0].score >= 10 + 60, "очки заявки учитывают тюнинг (score=" + entryRow.rows[0].score + ")");
  // поздняя прокачка не меняет дивизион уже поданной заявки
  await pool.query("INSERT INTO clicker_state (chat_id,balance,total_earned) VALUES ($1,100000,100000) ON CONFLICT (chat_id) DO UPDATE SET balance=100000", [A1]);
  await upgradeTune(A1, "sizar", "stamina"); await upgradeTune(A1, "sizar", "luck");
  const entryRow2 = await pool.query("SELECT division FROM pigeon_race_entries WHERE week=$1 AND chat_id=$2", [week, A1]);
  ok(entryRow2.rows[0].division === "silver", "поздняя прокачка НЕ меняет дивизион заявки");
  const again = await enterRace(A1, "sizar");
  ok(!again.ok && again.reason === "already", "повторная заявка → already");

  // --- Закрытие недели по дивизионам ---
  console.log("\n[C] closeRaceWeek — 3 дивизиона, топ-3, Чемпион только Золоту");
  // прямые заявки под prevWeek: 2 в bronze, 2 в silver, 2 в gold, с заданными score
  const seed = [
    [A1, "bronze", 50], [A2, "bronze", 30],
    [A3, "silver", 80], [A4, "silver", 40],
  ];
  const G1 = B + 5, G2 = B + 6; // золото
  const GOLD = [G1, G2]; const ALL2 = [...ALL, ...GOLD];
  const seedGold = [[G1, "gold", 120], [G2, "gold", 90]];
  for (const [a, div, sc] of [...seed, ...seedGold]) {
    await grantPigeon(a, "sizar");
    await pool.query(
      `INSERT INTO pigeon_race_entries (week, chat_id, breed, score, division, entered_at)
       VALUES ($1,$2,'sizar',$3,$4, NOW()) ON CONFLICT (week,chat_id) DO UPDATE SET score=$3, division=$4`,
      [prev, a, sc, div]);
  }
  const balB = {};
  for (const a of ALL2) { const r = await pool.query("SELECT balance FROM clicker_state WHERE chat_id=$1", [a]); balB[a] = r.rowCount ? Number(r.rows[0].balance) : 0; }

  const close1 = await closeRaceWeek();
  ok(close1.closed === true, "неделя закрыта");
  ok(close1.entries === 6, "учтено 6 заявок во всех дивизионах (entries=" + close1.entries + ")");

  const res = (await pool.query("SELECT results FROM pigeon_race_winners WHERE week=$1", [prev])).rows[0].results;
  ok(res.gold && res.gold.length === 2 && res.gold[0].chat === G1 && res.gold[0].prize === 50000, "gold: 1 место G1, приз 50000");
  ok(res.silver && res.silver[0].chat === A3 && res.silver[0].prize === 15000, "silver: 1 место A3 (80), приз 15000");
  ok(res.bronze && res.bronze[0].chat === A1 && res.bronze[0].prize === 5000, "bronze: 1 место A1 (50), приз 5000");

  // призы начислены по дивизионам
  const exp = { [G1]: 50000, [G2]: 25000, [A3]: 15000, [A4]: 8000, [A1]: 5000, [A2]: 2500 };
  for (const a of ALL2) {
    const cur = Number((await pool.query("SELECT balance FROM clicker_state WHERE chat_id=$1", [a])).rows[0].balance);
    ok(cur - balB[a] === exp[a], `A${a - B}: начислено ${cur - balB[a]} (ожидалось ${exp[a]})`);
  }
  // Чемпион только gold#1
  const champG1 = await pool.query("SELECT 1 FROM pigeon_inventory WHERE chat_id=$1 AND breed='champion'", [G1]);
  ok(champG1.rowCount === 1, "Чемпион выдан победителю Золота (G1)");
  const champOther = await pool.query("SELECT chat_id FROM pigeon_inventory WHERE breed='champion' AND chat_id=ANY($1)", [[G2, A1, A3]]);
  ok(champOther.rowCount === 0, "остальным (в т.ч. победителям bronze/silver) Чемпион НЕ выдан");

  // идемпотентность
  const close2 = await closeRaceWeek();
  ok(close2.closed === false, "повторное закрытие → closed=false");

  // getRace
  console.log("\n[G] getRace");
  const gr = await getRace(A1);
  ok(gr.enabled === true && gr.myBreed === "sizar" && gr.myDivision === "silver", "getRace: myBreed+myDivision этой недели");
  ok(gr.lastResults && gr.lastResults.gold && gr.lastResults.gold.length === 2, "getRace.lastResults сгруппированы по дивизионам");

  console.log(`\n=== ИТОГ: ${pass} pass, ${fail} fail ===`);

  // cleanup включает золотые аккаунты
  globalThis.__CLEAN = ALL2;
} catch (e) { console.error("EXCEPTION:", e); fail++; }
finally {
  console.log("\n[cleanup]…");
  const clean = globalThis.__CLEAN || ALL;
  const prev = await previousWeekKey().catch(() => null);
  await pool.query("DELETE FROM pigeon_race_entries WHERE chat_id = ANY($1)", [clean]).catch(() => {});
  if (prev) await pool.query("DELETE FROM pigeon_race_winners WHERE week=$1", [prev]).catch(() => {});
  await pool.query("DELETE FROM pigeon_inventory WHERE chat_id = ANY($1)", [clean]).catch(() => {});
  await pool.query("DELETE FROM clicker_state WHERE chat_id = ANY($1)", [clean]).catch(() => {});
  const l = await pool.query("SELECT (SELECT COUNT(*) FROM pigeon_race_entries WHERE chat_id=ANY($1)) e, (SELECT COUNT(*) FROM pigeon_inventory WHERE chat_id=ANY($1)) i, (SELECT COUNT(*) FROM clicker_state WHERE chat_id=ANY($1)) s", [clean]).catch(() => ({ rows: [{ e: "?", i: "?", s: "?" }] }));
  console.log(`[cleanup] осталось: entries=${l.rows[0].e} inv=${l.rows[0].i} state=${l.rows[0].s} (должно быть 0)`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

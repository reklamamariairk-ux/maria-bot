// E2E своих стай против живой БД (в контейнере maria-bot).
import { pool } from "./dist/db.js";
import {
  initCustomSquadSchema, createSquad, joinSquadByCode, requestJoinSquad,
  listSquadRequests, decideSquadRequest, getSquads, SQUAD_CREATE_COST, SQUAD_MAX_MEMBERS,
} from "./dist/clicker.js";

const OWNER = 1990000400001, FRIEND = 1990000400002, STRANGER = 1990000400003;
const ALL = [OWNER, FRIEND, STRANGER];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK", m); } else { fail++; console.log("  FAIL:", m); } };

async function cleanup() {
  await pool.query(`DELETE FROM squad_requests WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM squads WHERE owner_chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM clicker_squad_bank WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM clicker_state WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM clicker_events WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
}

try {
  await initCustomSquadSchema();
  await cleanup();
  for (const [id, bal] of [[OWNER, 30000], [FRIEND, 1000], [STRANGER, 1000]]) {
    await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy) VALUES ($1,$2,$2,1000)`, [id, bal]);
  }

  console.log("[1] Создание стаи");
  const noMoney = await createSquad(FRIEND, "Бедная стая");
  ok(!noMoney.ok && noMoney.reason === "no_coins", "без 25к монет — отказ");
  const bad = await createSquad(OWNER, "Пиздатые");
  ok(!bad.ok && bad.reason === "bad_name", "мат в названии — отказ");
  const c1 = await createSquad(OWNER, "Тест Стая E2E");
  ok(c1.ok && c1.inviteCode && c1.inviteCode.length === 6, `создана, код ${c1.inviteCode}`);
  ok(Number(c1.state.balance) === 30000 - SQUAD_CREATE_COST, "монеты за создание списаны");
  ok(c1.state.squad === c1.squadId, "создатель сразу в своей стае");
  const dup = await createSquad(OWNER, "Вторая");
  ok(!dup.ok && dup.reason === "already_owner", "вторую стаю тому же владельцу нельзя");

  console.log("[2] Вступление по коду");
  const j1 = await joinSquadByCode(FRIEND, c1.inviteCode.toLowerCase());
  ok(j1.ok && j1.squadName === "Тест Стая E2E" && j1.state.squad === c1.squadId, "код работает (регистронезависимо)");
  const jb = await joinSquadByCode(STRANGER, "XXXXXX");
  ok(!jb.ok, "несуществующий код — отказ");

  console.log("[3] Заявка и решение владельца");
  const r1 = await requestJoinSquad(STRANGER, c1.squadId);
  ok(r1.ok && r1.pending === true, "заявка чужака создана (pending)");
  const list1 = await listSquadRequests(OWNER);
  ok(list1.squadId === c1.squadId && list1.requests.length === 1 && list1.requests[0].chatId === STRANGER, "владелец видит заявку");
  const notOwner = await listSquadRequests(FRIEND);
  ok(notOwner.squadId === null, "не-владелец заявок не видит");
  const rej = await decideSquadRequest(OWNER, STRANGER, false);
  ok(rej.ok, "отклонение работает");
  const r2 = await requestJoinSquad(STRANGER, c1.squadId);
  const acc = await decideSquadRequest(OWNER, STRANGER, true);
  const strState = await pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [STRANGER]);
  ok(r2.ok && acc.ok && strState.rows[0].squad === c1.squadId, "повторная заявка + принятие → в стае");

  console.log("[4] Стандартная стая — открытая");
  const std = await requestJoinSquad(STRANGER, "choco");
  ok(std.ok && std.pending === false, "в стандартную — сразу, без заявки");

  console.log("[5] getSquads видит кастомную стаю в рейтинге");
  const gs = await getSquads(OWNER);
  const mine = gs.squads.find((s) => s.id === c1.squadId);
  ok(Boolean(mine && mine.custom && mine.name === "Тест Стая E2E"), "кастомная в списке с именем");
  ok(gs.myOwn && gs.myOwn.inviteCode === c1.inviteCode && gs.myOwn.requests === 0, "myOwn с кодом, заявок 0");
} catch (e) {
  console.error("EXCEPTION:", e); fail++;
} finally {
  await cleanup();
  console.log(`\n=== ИТОГ: ${pass} pass, ${fail} fail ===`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

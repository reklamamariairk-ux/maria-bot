// E2E связки аккаунтов по телефону (account-link.ts) против живой БД.
// Запуск внутри контейнера maria-bot: node /app/link-e2e.mjs
import { pool } from "./dist/db.js";
import { initAccountLinkSchema, registerAccountLink, canonicalChatId, linksOf } from "./dist/account-link.js";

const A = 1990000200001; // «TG»-тестовый
const B = 1990000200002; // «VK»-тестовый (прокачаннее)
const C = 1990000200003; // «МАКС»-тестовый
const ALL = [A, B, C];
const PHONE = "+7999000200e2e"; // невалидный формат намеренно — не столкнётся с реальным
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK", m); } else { fail++; console.log("  FAIL:", m); } };

async function cleanup() {
  await pool.query(`DELETE FROM account_links WHERE alias_chat_id = ANY($1) OR canonical_chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM phone_canonical WHERE phone = $1`, [PHONE]).catch(() => {});
  await pool.query(`DELETE FROM clicker_state WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
  await pool.query(`DELETE FROM clicker_events WHERE chat_id = ANY($1)`, [ALL]).catch(() => {});
}

try {
  await initAccountLinkSchema();
  await cleanup();
  await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy) VALUES ($1, 100, 100, 1000)`, [A]);
  await pool.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, energy) VALUES ($1, 9000, 9000, 1000)`, [B]);

  console.log("[1] Первый аккаунт с телефоном");
  const r1 = await registerAccountLink(A, PHONE);
  ok(r1.linked === false && r1.canonicalChatId === A, "A первый: связи нет, канон A");
  ok((await canonicalChatId(A)) === A, "canonicalChatId(A) = A");

  console.log("[2] Второй аккаунт, прокачаннее → он канон");
  const r2 = await registerAccountLink(B, PHONE);
  ok(r2.linked === true && r2.canonicalChatId === B && r2.aliasedChatId === A, "B богаче: канон B, алиас A");
  ok((await canonicalChatId(A)) === B, "canonicalChatId(A) → B");
  ok((await canonicalChatId(B)) === B, "canonicalChatId(B) = B");

  console.log("[3] Третья платформа того же телефона");
  const r3 = await registerAccountLink(C, PHONE);
  ok(r3.linked === true && r3.canonicalChatId === B && r3.aliasedChatId === C, "C беднее: алиас C → B");
  ok((await canonicalChatId(C)) === B, "canonicalChatId(C) → B");

  console.log("[4] Повторная верификация — идемпотентность");
  const r4 = await registerAccountLink(B, PHONE);
  ok(r4.linked === false && r4.canonicalChatId === B, "повтор канона: без изменений");
  const links = await linksOf(B);
  ok(links.length === 2 && links.every((l) => [A, C].includes(l.alias)), "linksOf(B) = {A, C}");

  console.log("[5] Канон никогда не алиас");
  const selfAlias = await pool.query(`SELECT 1 FROM account_links WHERE alias_chat_id = $1`, [B]);
  ok(selfAlias.rowCount === 0, "B нет в алиасах");
} catch (e) {
  console.error("EXCEPTION:", e); fail++;
} finally {
  await cleanup();
  console.log(`\n=== ИТОГ: ${pass} pass, ${fail} fail ===`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

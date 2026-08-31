/**
 * Связка аккаунтов одного человека между платформами (TG / VK / МАКС)
 * по верифицированному телефону.
 *
 * Модель: у телефона есть ОДИН канонический игровой аккаунт. Все остальные
 * internalId с тем же телефоном — алиасы: requireUser подменяет их id на
 * канонический, и человек играет одним профилем с любой платформы.
 * Прогресс алиаса НЕ мержится — замораживается (v1; таблиц ~25, мерж рискован).
 *
 * Канон выбирается «кто прокачаннее» (clicker_state.total_earned) на момент
 * связки — чтобы человек не потерял видимый прогресс.
 *
 * Единственная точка входа registerAccountLink — из club.verifyPhone: телефон
 * туда попадает только после криптографической верификации (:contact TG,
 * sign VK). Никогда не вызывать с телефоном со слов клиента.
 */
import { pool } from "./db";
import { trackEvent } from "./analytics";
import { log } from "./logger";
import type { PoolClient } from "pg";
import { platformOf, type Platform } from "./platform";

export async function initAccountLinkSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_canonical (
      phone             TEXT PRIMARY KEY,
      canonical_chat_id BIGINT NOT NULL,
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS account_links (
      alias_chat_id     BIGINT PRIMARY KEY,
      canonical_chat_id BIGINT NOT NULL,
      phone             TEXT NOT NULL,
      linked_at         TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_account_links_canonical ON account_links(canonical_chat_id);
    CREATE INDEX IF NOT EXISTS idx_account_links_phone ON account_links(phone);
  `);
}

export interface LinkResult {
  linked: boolean;              // появилась ли НОВАЯ связь в этом вызове
  canonicalChatId: number;      // кем теперь играет этот телефон
  aliasedChatId?: number;       // чей прогресс заморожен (если связь новая)
}

/** Платформы, которые уже ведут в один канонический профиль. */
export function accountPlatforms(
  currentPlatform: Platform,
  canonicalChatId: number,
  aliasChatIds: number[],
): Platform[] {
  const found = new Set<Platform>([
    currentPlatform,
    platformOf(canonicalChatId),
    ...aliasChatIds.map(platformOf),
  ]);
  return (["tg", "vk", "max"] as Platform[]).filter((platform) => found.has(platform));
}

/** total_earned кликера (0 если в игру не заходил). */
async function progressOf(chatId: number, db: Pick<PoolClient, "query"> = pool): Promise<number> {
  const { rows } = await db.query(
    `SELECT total_earned FROM clicker_state WHERE chat_id = $1`, [chatId]);
  return Number(rows[0]?.total_earned ?? 0);
}

export async function registerAccountLink(chatId: number, phone: string): Promise<LinkResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Если платформа уже является алиасом (например, человек подтвердил новый
    // номер), новый телефон должен указывать на действующий канон, а не на
    // замороженный профиль алиаса.
    const linked = await client.query(
      `SELECT canonical_chat_id FROM account_links WHERE alias_chat_id=$1`, [chatId]);
    const candidate = Number(linked.rows[0]?.canonical_chat_id ?? chatId);
    const cur = await client.query(
      `SELECT canonical_chat_id FROM phone_canonical WHERE phone = $1 FOR UPDATE`, [phone]);

    if (cur.rowCount === 0) {
      // Первый аккаунт с этим телефоном. Если сам был алиасом другого телефона
      // (сменил номер) — старая связь остаётся, канон тот же; новых связей нет.
      await client.query(
        `INSERT INTO phone_canonical (phone, canonical_chat_id) VALUES ($1, $2)`, [phone, candidate]);
      await client.query("COMMIT");
      _cache.delete(chatId); _cache.delete(candidate);
      return { linked: false, canonicalChatId: candidate };
    }

    const existing = Number(cur.rows[0].canonical_chat_id);
    if (existing === candidate) {
      await client.query("COMMIT");
      _cache.delete(chatId); _cache.delete(candidate);
      return { linked: false, canonicalChatId: candidate };
    }

    // Второй+ аккаунт того же телефона: канон = кто прокачаннее.
    // Транзакция уже держит соединение и блокировку телефона. Используем то же
    // соединение: вложенные pool.query() могли занять весь пул при массовой связке.
    const pNew = await progressOf(candidate, client);
    const pOld = await progressOf(existing, client);
    const canonical = pNew > pOld ? candidate : existing;
    const alias = canonical === candidate ? existing : candidate;

    await client.query(
      `INSERT INTO account_links (alias_chat_id, canonical_chat_id, phone)
       VALUES ($1, $2, $3)
       ON CONFLICT (alias_chat_id) DO UPDATE SET canonical_chat_id = $2, phone = $3, linked_at = NOW()`,
      [alias, canonical, phone]);
    // Прежние алиасы этого телефона перенаправляем на нового канона
    const moved = await client.query(
      `UPDATE account_links SET canonical_chat_id = $1 WHERE phone = $2 AND alias_chat_id <> $1
       RETURNING alias_chat_id`,
      [canonical, phone]);
    // Канон не может сам быть алиасом
    await client.query(`DELETE FROM account_links WHERE alias_chat_id = $1`, [canonical]);
    await client.query(
      `UPDATE phone_canonical SET canonical_chat_id = $1, updated_at = NOW() WHERE phone = $2`,
      [canonical, phone]);
    await client.query("COMMIT");

    // Все затронутые алиасы могли уже кэшировать прежний канон на 60 секунд.
    for (const id of new Set([chatId, candidate, existing, alias, canonical, ...moved.rows.map((r) => Number(r.alias_chat_id))])) {
      _cache.delete(id);
    }
    trackEvent(canonical, "account_link", { alias, phone_last4: phone.slice(-4) });
    log.info({ canonical, alias }, "[account-link] linked");
    return { linked: true, canonicalChatId: canonical, aliasedChatId: alias };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    log.error({ err: e, chatId }, "[account-link]");
    return { linked: false, canonicalChatId: chatId };
  } finally {
    client.release();
  }
}

// ── Резолв канона на каждом запросе (кэш 60с, промах = 1 индексный SELECT) ──
const CACHE_TTL = 60_000;
const CACHE_MAX = 20_000;
const _cache = new Map<number, { canon: number; ts: number }>();

export async function canonicalChatId(chatId: number): Promise<number> {
  const hit = _cache.get(chatId);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.canon;
  let canon = chatId;
  const { rows } = await pool.query(
    `SELECT canonical_chat_id FROM account_links WHERE alias_chat_id = $1`, [chatId]);
  if (rows[0]) canon = Number(rows[0].canonical_chat_id);
  const now = Date.now();
  _cache.set(chatId, { canon, ts: now });
  if (_cache.size > CACHE_MAX) {
    for (const [id, item] of _cache) if (now - item.ts >= CACHE_TTL) _cache.delete(id);
    if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value!);
  }
  return canon;
}

/** Для админки: все связи канона (платформы человека). */
export async function linksOf(chatId: number): Promise<{ alias: number; phone: string }[]> {
  const { rows } = await pool.query(
    `SELECT alias_chat_id, phone FROM account_links WHERE canonical_chat_id = $1`, [chatId]);
  return rows.map((r) => ({ alias: Number(r.alias_chat_id), phone: String(r.phone) }));
}

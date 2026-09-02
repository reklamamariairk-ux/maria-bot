import crypto from "crypto";
import { createClient } from "redis";
import { log } from "./logger";

type RedisClient = ReturnType<typeof createClient>;

const REDIS_URL = (process.env.REDIS_URL || "").trim();
const REDIS_PREFIX = (process.env.REDIS_PREFIX || "maria-bot").replace(/[^a-zA-Z0-9:_-]/g, "_");
const RETRY_AFTER_MS = 30_000;
const COMMAND_TIMEOUT_MS = Math.max(250, Math.min(5_000, Number(process.env.REDIS_COMMAND_TIMEOUT_MS) || 1_000));

let client: RedisClient | null = null;
let connectPromise: Promise<RedisClient | null> | null = null;
let retryAfter = 0;
let lastErrorAt: string | null = null;

export function sharedStateConfigured(): boolean {
  return Boolean(REDIS_URL);
}

function scoped(key: string): string {
  return `${REDIS_PREFIX}:${key}`;
}

export function privacySafeKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

async function redisClient(): Promise<RedisClient | null> {
  if (!REDIS_URL) return null;
  if (client?.isReady) return client;
  if (Date.now() < retryAfter) return null;
  if (connectPromise) return connectPromise;

  // Не оставляем полуподключённый клиент перед новой попыткой. Иначе после
  // сетевого разрыва каждый цикл retry создавал бы ещё один набор listeners/socket.
  if (client) {
    const stale = client;
    client = null;
    if (stale.isOpen) await stale.disconnect().catch(() => {});
  }

  connectPromise = (async () => {
    const next = createClient({
      url: REDIS_URL,
      socket: {
        connectTimeout: 1_500,
        reconnectStrategy: false,
      },
    });
    next.on("error", (error) => {
      lastErrorAt = new Date().toISOString();
      log.warn({ err: error }, "[redis] client error");
    });
    try {
      await next.connect();
      client = next;
      retryAfter = 0;
      log.info("[redis] shared state connected");
      return next;
    } catch (error) {
      lastErrorAt = new Date().toISOString();
      retryAfter = Date.now() + RETRY_AFTER_MS;
      await next.disconnect().catch(() => {});
      log.warn({ err: error }, "[redis] unavailable; using local safety fallback");
      return null;
    } finally {
      connectPromise = null;
    }
  })();
  return connectPromise;
}

async function markRedisFailure(redis: RedisClient, error: unknown, message: string): Promise<void> {
  lastErrorAt = new Date().toISOString();
  retryAfter = Date.now() + RETRY_AFTER_MS;
  if (client === redis) client = null;
  if (redis.isOpen) await redis.disconnect().catch(() => {});
  log.warn({ err: error }, message);
}

function commands(redis: RedisClient): RedisClient {
  return redis.withCommandOptions({ abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) }) as RedisClient;
}

/**
 * Distributed fixed-window limiter. `null` means Redis is not configured or is
 * temporarily unavailable; callers must fall back to a bounded local limiter.
 */
export async function consumeSharedRateLimit(key: string, limit: number, windowMs: number): Promise<boolean | null> {
  const redis = await redisClient();
  if (!redis) return null;
  const script = `
    local n = redis.call('INCR', KEYS[1])
    if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
    if n > tonumber(ARGV[2]) then return 0 end
    return 1
  `;
  try {
    const allowed = await commands(redis).eval(script, {
      keys: [scoped(`rate:${privacySafeKey(key)}`)],
      arguments: [String(windowMs), String(Math.max(1, Math.floor(limit)))],
    });
    return Number(allowed) === 1;
  } catch (error) {
    await markRedisFailure(redis, error, "[redis] distributed rate limit failed");
    return null;
  }
}

/** Atomic token bucket shared by every API replica. */
export async function consumeSharedTokenBucket(
  key: string,
  requested: number,
  tokensPerSecond: number,
  capacity: number,
  requestIdentity = "",
): Promise<number | null> {
  const redis = await redisClient();
  if (!redis) return null;
  const now = Date.now();
  const script = `
    if ARGV[6] ~= '' and redis.call('HGET', KEYS[1], 'last_id') == ARGV[6] then
      return tonumber(redis.call('HGET', KEYS[1], 'last_accepted')) or 0
    end
    local vals = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
    local cap = tonumber(ARGV[3])
    local tokens = tonumber(vals[1]) or cap
    local ts = tonumber(vals[2]) or tonumber(ARGV[1])
    local elapsed = math.max(0, tonumber(ARGV[1]) - ts) / 1000
    tokens = math.min(cap, tokens + elapsed * tonumber(ARGV[2]))
    local accepted = math.min(math.floor(tokens), tonumber(ARGV[4]))
    redis.call('HSET', KEYS[1], 'tokens', tokens - accepted, 'ts', ARGV[1], 'last_id', ARGV[6], 'last_accepted', accepted)
    redis.call('PEXPIRE', KEYS[1], ARGV[5])
    return accepted
  `;
  try {
    const accepted = await commands(redis).eval(script, {
      keys: [scoped(`bucket:${privacySafeKey(key)}`)],
      arguments: [
        String(now),
        String(tokensPerSecond),
        String(capacity),
        String(Math.max(0, Math.floor(requested))),
        "300000",
        requestIdentity.slice(0, 180),
      ],
    });
    return Math.max(0, Number(accepted) || 0);
  } catch (error) {
    await markRedisFailure(redis, error, "[redis] token bucket failed");
    return null;
  }
}

export async function sharedStateHealth(): Promise<{ configured: boolean; ok: boolean; latencyMs?: number; lastErrorAt: string | null }> {
  if (!REDIS_URL) return { configured: false, ok: true, lastErrorAt };
  const started = Date.now();
  const redis = await redisClient();
  if (!redis) return { configured: true, ok: false, lastErrorAt };
  try {
    await commands(redis).ping();
    return { configured: true, ok: true, latencyMs: Date.now() - started, lastErrorAt };
  } catch (error) {
    await markRedisFailure(redis, error, "[redis] health check failed");
    return { configured: true, ok: false, lastErrorAt };
  }
}

export async function closeSharedState(): Promise<void> {
  const current = client;
  client = null;
  if (current?.isOpen) await current.quit().catch(() => current.disconnect().catch(() => {}));
}

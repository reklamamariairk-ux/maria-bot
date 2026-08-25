/** Общие строгие проверки подписанных launch-параметров платформ. */
export const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
export const AUTH_FUTURE_SKEW_SECONDS = 5 * 60;

/**
 * Подпись сама по себе не ограничивает replay. Принимаем данные не старше суток
 * и допускаем только небольшой уход часов клиента/платформы вперёд.
 */
export function isFreshAuthTimestamp(
  value: unknown,
  nowSeconds = Date.now() / 1000,
  maxAgeSeconds = AUTH_MAX_AGE_SECONDS,
  futureSkewSeconds = AUTH_FUTURE_SKEW_SECONDS,
): boolean {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isFinite(nowSeconds)) return false;
  const age = nowSeconds - timestamp;
  return age <= maxAgeSeconds && age >= -futureSkewSeconds;
}

/** Не допускаем неоднозначный разбор `a=1&a=2` разными слоями приложения. */
export function hasUniqueQueryKeys(params: URLSearchParams): boolean {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** Platform ID должен точно помещаться в JS number и выделенный namespace. */
export function isValidPlatformId(value: unknown, maxExclusive = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < maxExclusive;
}

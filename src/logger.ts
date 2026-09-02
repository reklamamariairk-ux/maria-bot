/**
 * Единый logger для maria-bot. Заменяет console.log/error/warn.
 *
 * Уровни (pino): trace < debug < info < warn < error < fatal
 * По умолчанию: info. Управляется через ENV `LOG_LEVEL`.
 *
 * В dev (NODE_ENV != production) → pino-pretty с цветами.
 * В prod → JSON-строки (для парсинга в Sentry/Loki/CloudWatch).
 *
 * Sentry интегрируется automatically: если задан `SENTRY_DSN` env —
 * любой `log.error(...)` ИЛИ `log.fatal(...)` поедет в Sentry как exception.
 *
 * Использование:
 *   import { log, withCtx, captureError } from './logger';
 *   log.info({ chatId: 123 }, 'order created');
 *   log.error({ err: e, chatId }, 'fetchLk failed');
 *   const reqLog = withCtx({ requestId: 'abc' });
 *   reqLog.info('handled request');
 */

import pino from 'pino';
import * as Sentry from '@sentry/node';
import { observeHttpRequest } from './runtime-metrics';

const isProd = process.env.NODE_ENV === 'production';
const sentryDsn = process.env.SENTRY_DSN ?? '';

// ── Sentry init (opt-in через SENTRY_DSN) ─────────────────────────────────
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: isProd ? 'production' : 'development',
    release: process.env.RELEASE ?? process.env.npm_package_version,
    // Sampling: 100% errors, 10% transactions (умеренная нагрузка)
    tracesSampleRate: 0.1,
    // Не отправлять breadcrumbs для console.* (избегаем шума, у нас свой log)
    integrations: (defaults) => defaults.filter(i => i.name !== 'Console'),
    beforeSend(event) {
      // Не шлём 4xx-ошибки бизнес-логики в Sentry (rate_limited, validation_error)
      const msg = String(event.message ?? event.exception?.values?.[0]?.value ?? '');
      if (/^(rate_limited|validation_error|forbidden|unauthorized)$/.test(msg)) return null;
      return event;
    },
  });
  // eslint-disable-next-line no-console
  console.log('[logger] Sentry enabled (dsn ***)');
}

// ── Pino transport: pretty в dev, plain JSON в prod ───────────────────────
const transport = isProd
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    };

const baseLog = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'maria-bot' },
  // Авто-форматирование ошибок: pino понимает поле `err: Error` и сериализует stack
  serializers: { err: pino.stdSerializers.err },
  transport,
});

// ── Wrapper: интеграция error/fatal с Sentry ──────────────────────────────
// pino не имеет hooks на конкретный уровень, поэтому делаем тонкую обёртку
// которая ловит error/fatal и переcсылает в Sentry (если включён).

type LogFn = (obj: object | string, msg?: string) => void;
interface Logger {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child: (bindings: object) => Logger;
}

function wrap(inner: pino.Logger): Logger {
  const sentryCapture = (level: 'error' | 'fatal', obj: object | string, msg?: string) => {
    if (!sentryDsn) return;
    try {
      // Ищем Error в payload
      const errLike = typeof obj === 'object' && obj !== null
        ? ((obj as { err?: unknown; error?: unknown }).err ?? (obj as { error?: unknown }).error)
        : null;
      const ctx: Record<string, unknown> = typeof obj === 'object' && obj !== null
        ? { ...obj as Record<string, unknown> }
        : { msg: obj as string };
      delete ctx.err;
      delete ctx.error;
      if (errLike instanceof Error) {
        Sentry.captureException(errLike, { level, extra: ctx, tags: { msg: msg ?? errLike.message } });
      } else {
        Sentry.captureMessage(typeof obj === 'string' ? obj : (msg ?? 'log.' + level), {
          level,
          extra: ctx,
        });
      }
    } catch { /* fail-safe: не ронять прод из-за logging */ }
  };

  return {
    trace: (obj, msg) => inner.trace(obj as object, msg),
    debug: (obj, msg) => inner.debug(obj as object, msg),
    info:  (obj, msg) => inner.info(obj as object, msg),
    warn:  (obj, msg) => inner.warn(obj as object, msg),
    error: (obj, msg) => { inner.error(obj as object, msg); sentryCapture('error', obj, msg); },
    fatal: (obj, msg) => { inner.fatal(obj as object, msg); sentryCapture('fatal', obj, msg); },
    child: (bindings) => wrap(inner.child(bindings)),
  };
}

export const log: Logger = wrap(baseLog);

/** Создаёт child-logger с дополнительным контекстом (requestId, chatId и т.п.) */
export function withCtx(ctx: object): Logger {
  return log.child(ctx);
}

/** Явный capture exception в Sentry (для catch-блоков где log.error лишний) */
export function captureError(err: unknown, ctx?: Record<string, unknown>): void {
  if (!sentryDsn) return;
  try {
    if (err instanceof Error) {
      Sentry.captureException(err, { extra: ctx });
    } else {
      Sentry.captureMessage(String(err), { level: 'error', extra: ctx });
    }
  } catch { /* no-op */ }
}

/** Express middleware: добавляет requestId, логирует start/finish */
export function requestLogger() {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const reqId = Math.random().toString(36).slice(2, 10);
    const t0 = Date.now();
    (req as { _log?: Logger })._log = withCtx({ reqId, method: req.method, path: req.path });
    res.setHeader('X-Request-Id', reqId);
    res.on('finish', () => {
      const dur = Date.now() - t0;
      const status = res.statusCode;
      observeHttpRequest(req.method, req.path, status, dur);
      const fn = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      // Пропускаем /health и static — иначе спам
      if (req.path === '/health' || req.path === '/api/health') return;
      log[fn]({ reqId, method: req.method, path: req.path, status, dur }, 'http');
    });
    next();
  };
}

/** Sentry-handler для Express: подключить ПОСЛЕ всех routes.
 *  Возвращает any потому что express определяет error-middleware по сигнатуре
 *  с 4 параметрами, а TS-генерики иногда сбоят с union — проще any. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sentryExpressErrorHandler(): any {
  if (!sentryDsn) {
    return (_err: Error, _req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => next(_err);
  }
  return Sentry.expressErrorHandler();
}

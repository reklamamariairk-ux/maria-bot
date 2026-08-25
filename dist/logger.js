"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
exports.withCtx = withCtx;
exports.captureError = captureError;
exports.requestLogger = requestLogger;
exports.sentryExpressErrorHandler = sentryExpressErrorHandler;
const pino_1 = __importDefault(require("pino"));
const Sentry = __importStar(require("@sentry/node"));
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
            if (/^(rate_limited|validation_error|forbidden|unauthorized)$/.test(msg))
                return null;
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
const baseLog = (0, pino_1.default)({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'maria-bot' },
    // Авто-форматирование ошибок: pino понимает поле `err: Error` и сериализует stack
    serializers: { err: pino_1.default.stdSerializers.err },
    transport,
});
function wrap(inner) {
    const sentryCapture = (level, obj, msg) => {
        if (!sentryDsn)
            return;
        try {
            // Ищем Error в payload
            const errLike = typeof obj === 'object' && obj !== null
                ? (obj.err ?? obj.error)
                : null;
            const ctx = typeof obj === 'object' && obj !== null
                ? { ...obj }
                : { msg: obj };
            delete ctx.err;
            delete ctx.error;
            if (errLike instanceof Error) {
                Sentry.captureException(errLike, { level, extra: ctx, tags: { msg: msg ?? errLike.message } });
            }
            else {
                Sentry.captureMessage(typeof obj === 'string' ? obj : (msg ?? 'log.' + level), {
                    level,
                    extra: ctx,
                });
            }
        }
        catch { /* fail-safe: не ронять прод из-за logging */ }
    };
    return {
        trace: (obj, msg) => inner.trace(obj, msg),
        debug: (obj, msg) => inner.debug(obj, msg),
        info: (obj, msg) => inner.info(obj, msg),
        warn: (obj, msg) => inner.warn(obj, msg),
        error: (obj, msg) => { inner.error(obj, msg); sentryCapture('error', obj, msg); },
        fatal: (obj, msg) => { inner.fatal(obj, msg); sentryCapture('fatal', obj, msg); },
        child: (bindings) => wrap(inner.child(bindings)),
    };
}
exports.log = wrap(baseLog);
/** Создаёт child-logger с дополнительным контекстом (requestId, chatId и т.п.) */
function withCtx(ctx) {
    return exports.log.child(ctx);
}
/** Явный capture exception в Sentry (для catch-блоков где log.error лишний) */
function captureError(err, ctx) {
    if (!sentryDsn)
        return;
    try {
        if (err instanceof Error) {
            Sentry.captureException(err, { extra: ctx });
        }
        else {
            Sentry.captureMessage(String(err), { level: 'error', extra: ctx });
        }
    }
    catch { /* no-op */ }
}
/** Express middleware: добавляет requestId, логирует start/finish */
function requestLogger() {
    return (req, res, next) => {
        const reqId = Math.random().toString(36).slice(2, 10);
        const t0 = Date.now();
        req._log = withCtx({ reqId, method: req.method, path: req.path });
        res.setHeader('X-Request-Id', reqId);
        res.on('finish', () => {
            const dur = Date.now() - t0;
            const status = res.statusCode;
            const fn = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
            // Пропускаем /health и static — иначе спам
            if (req.path === '/health' || req.path === '/api/health')
                return;
            exports.log[fn]({ reqId, method: req.method, path: req.path, status, dur }, 'http');
        });
        next();
    };
}
/** Sentry-handler для Express: подключить ПОСЛЕ всех routes.
 *  Возвращает any потому что express определяет error-middleware по сигнатуре
 *  с 4 параметрами, а TS-генерики иногда сбоят с union — проще any. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sentryExpressErrorHandler() {
    if (!sentryDsn) {
        return (_err, _req, _res, next) => next(_err);
    }
    return Sentry.expressErrorHandler();
}

import fs from "node:fs";
import { performance } from "node:perf_hooks";

const baseUrl = String(process.env.BASE_URL || "http://127.0.0.1:3010").replace(/\/+$/, "");
const target = new URL(baseUrl);
const localTarget = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
if (!localTarget && process.env.ALLOW_REMOTE_LOAD !== "1") {
  throw new Error("Remote load test refused. Set ALLOW_REMOTE_LOAD=1 explicitly after confirming the target.");
}

const profile = process.env.LOAD_PROFILE || "smoke";
const vus = Math.max(1, Number(process.env.VUS) || (profile === "capacity" ? 100 : 5));
const durationSec = Math.max(5, Number(process.env.DURATION_SEC) || (profile === "capacity" ? 300 : 20));
const tapIntervalMs = Math.max(1_000, Number(process.env.TAP_INTERVAL_MS) || 5_000);
const tapsPerBatch = Math.max(1, Math.min(200, Number(process.env.TAPS_PER_BATCH) || 20));
const timeoutMs = Math.max(1_000, Number(process.env.REQUEST_TIMEOUT_MS) || 10_000);

function loadAuthorizations() {
  if (process.env.AUTHORIZATIONS_FILE) {
    const parsed = JSON.parse(fs.readFileSync(process.env.AUTHORIZATIONS_FILE, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("AUTHORIZATIONS_FILE must contain a JSON array");
    return parsed.map((item) => typeof item === "string" ? item : item?.authorization).filter(Boolean);
  }
  return process.env.AUTHORIZATION ? [process.env.AUTHORIZATION] : [];
}

const authorizations = loadAuthorizations();
if (!authorizations.length) {
  throw new Error("Provide AUTHORIZATION or AUTHORIZATIONS_FILE with signed Telegram/VK/MAX Authorization values.");
}
if (profile === "capacity" && authorizations.length < vus) {
  throw new Error(`Capacity profile needs at least one real test account per VU (${authorizations.length}/${vus}).`);
}

const stats = {
  requests: 0,
  ok: 0,
  failed: 0,
  overloaded: 0,
  rateLimited: 0,
  latencies: [],
  errors: new Map(),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, authorization, options = {}) {
  const started = performance.now();
  stats.requests += 1;
  try {
    const response = await fetch(baseUrl + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsed = performance.now() - started;
    stats.latencies.push(elapsed);
    if (response.status === 503) stats.overloaded += 1;
    if (response.status === 429) stats.rateLimited += 1;
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) {
      stats.failed += 1;
      const key = `${response.status}:${body?.error || "bad_response"}`;
      stats.errors.set(key, (stats.errors.get(key) || 0) + 1);
      return null;
    }
    stats.ok += 1;
    return body;
  } catch (error) {
    stats.failed += 1;
    const key = error?.name || "network_error";
    stats.errors.set(key, (stats.errors.get(key) || 0) + 1);
    return null;
  }
}

async function virtualUser(index, deadline) {
  const authorization = authorizations[index % authorizations.length];
  const sessionId = `load_${process.pid}_${index}_${Math.random().toString(36).slice(2, 12)}`;
  let sequence = 0;
  const initial = await request("/api/clicker", authorization);
  if (!initial) return;

  while (Date.now() < deadline) {
    const cycleStarted = Date.now();
    const receipt = await request("/api/clicker/tap", authorization, {
      method: "POST",
      body: JSON.stringify({
        taps: tapsPerBatch,
        compact: true,
        sessionId,
        sequence: ++sequence,
        requestId: `${sessionId}_${sequence}`,
      }),
    });
    if (receipt && receipt.compactTap !== true) {
      const key = "200:non_compact_tap";
      stats.failed += 1;
      stats.ok = Math.max(0, stats.ok - 1);
      stats.errors.set(key, (stats.errors.get(key) || 0) + 1);
    }
    await sleep(Math.max(0, tapIntervalMs - (Date.now() - cycleStarted)));
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

console.log(JSON.stringify({ event: "load_start", baseUrl, profile, vus, durationSec, tapIntervalMs, tapsPerBatch }));
const deadline = Date.now() + durationSec * 1_000;
await Promise.all(Array.from({ length: vus }, (_, index) => virtualUser(index, deadline)));

const result = {
  event: "load_result",
  profile,
  vus,
  durationSec,
  requests: stats.requests,
  ok: stats.ok,
  failed: stats.failed,
  errorRate: stats.requests ? stats.failed / stats.requests : 1,
  overloaded: stats.overloaded,
  rateLimited: stats.rateLimited,
  latencyMs: {
    p50: Math.round(percentile(stats.latencies, 0.50)),
    p95: Math.round(percentile(stats.latencies, 0.95)),
    p99: Math.round(percentile(stats.latencies, 0.99)),
    max: Math.round(Math.max(0, ...stats.latencies)),
  },
  errors: Object.fromEntries(stats.errors),
};
console.log(JSON.stringify(result, null, 2));

const p95Target = Number(process.env.P95_TARGET_MS) || 200;
const maxErrorRate = Number(process.env.MAX_ERROR_RATE) || 0.005;
if (result.errorRate > maxErrorRate || result.latencyMs.p95 > p95Target) process.exitCode = 1;

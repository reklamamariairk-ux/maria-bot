import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { tapSessionReplay } from "../src/clicker";
import { privacySafeKey } from "../src/shared-state";
import { observeHttpRequest, prometheusMetrics } from "../src/runtime-metrics";

const root = path.resolve(__dirname, "..");

describe("scale-readiness", () => {
  it("deduplicates the latest tap sequence without rewarding stale sequences", () => {
    expect(tapSessionReplay(7, 8, 20, 24)).toBeNull();
    expect(tapSessionReplay(7, 7, 20, 24)).toEqual({ acceptedTaps: 20, earned: 24 });
    expect(tapSessionReplay(7, 6, 20, 24)).toEqual({ acceptedTaps: 0, earned: 0 });
  });

  it("does not expose user/IP material in Redis keys", () => {
    const raw = "203.0.113.44:POST:/api/clicker/tap";
    const key = privacySafeKey(raw);
    expect(key).toMatch(/^[a-f0-9]{24}$/);
    expect(key).not.toContain("203.0.113.44");
    expect(privacySafeKey(raw)).toBe(key);
  });

  it("exports bounded HTTP and PostgreSQL runtime metrics", () => {
    observeHttpRequest("POST", "/api/clicker/tap", 200, 42);
    const text = prometheusMetrics({ totalCount: 12, idleCount: 7, waitingCount: 2 } as any, {
      role: "api",
      inflight: 3,
      analyticsBuffered: 4,
    });
    expect(text).toContain('maria_http_requests_total{method="POST",path="/api/clicker/tap",status="200"}');
    expect(text).toContain("maria_pg_pool_waiting 2");
    expect(text).toContain("maria_inflight_requests{role=\"api\"} 3");
  });

  it("uses compact tap batching and keeps the legacy protocol as fallback", () => {
    const client = fs.readFileSync(path.join(root, "public", "js", "catclick.js"), "utf8");
    const routes = fs.readFileSync(path.join(root, "src", "routes", "clicker.ts"), "utf8");
    expect(client).toContain("const TAP_SYNC_INTERVAL = 5");
    expect(client).toContain("compact: true, sessionId: batch.sessionId, sequence: batch.sequence");
    expect(client).toContain("applyCompactTap(d, batch)");
    expect(routes).toContain("await tapClickerFast");
    expect(routes).toContain(": await tapClicker(u.id, taps, comboBonus, requestId)");
  });

  it("ships separate API/worker roles and production proxy/pool templates", () => {
    const index = fs.readFileSync(path.join(root, "src", "index.ts"), "utf8");
    const nginx = fs.readFileSync(path.join(root, "deploy", "nginx-bot-russia.conf"), "utf8");
    const pgbouncer = fs.readFileSync(path.join(root, "deploy", "pgbouncer.ini.example"), "utf8");
    const backup = fs.readFileSync(path.join(root, "deploy", "backup-maria-bot.sh"), "utf8");
    expect(index).toContain('type ProcessRole = "all" | "api" | "worker"');
    expect(index).toContain('app.get("/ready"');
    expect(index).toContain('app.get("/metrics"');
    expect(nginx).toContain("proxy_cache maria_static");
    expect(nginx).toContain("gzip on;");
    expect(pgbouncer).toContain("pool_mode = transaction");
    expect(pgbouncer).toContain("max_db_connections = 32");
    expect(backup).toContain("pg_restore --exit-on-error");
    expect(backup).toContain("-mtime +30 -delete");
  });
});

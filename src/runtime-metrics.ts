import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Pool } from "pg";

const durationBucketsMs = [25, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000];
const requestCounters = new Map<string, number>();
const durationCounters = new Map<string, { count: number; sumMs: number; buckets: number[] }>();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

function normalizedPath(path: string): string {
  return String(path || "/")
    .split("?")[0]
    .replace(/\/[0-9]{3,}/g, "/:id")
    .replace(/\/[a-f0-9_-]{16,}/gi, "/:token")
    .slice(0, 160);
}

export function observeHttpRequest(method: string, path: string, status: number, durationMs: number): void {
  const route = normalizedPath(path);
  const key = `${method.toUpperCase()}\t${route}\t${Math.floor(status)}`;
  requestCounters.set(key, (requestCounters.get(key) || 0) + 1);
  const durationKey = `${method.toUpperCase()}\t${route}`;
  const current = durationCounters.get(durationKey) || {
    count: 0,
    sumMs: 0,
    buckets: durationBucketsMs.map(() => 0),
  };
  current.count += 1;
  current.sumMs += Math.max(0, durationMs);
  durationBucketsMs.forEach((bucket, index) => {
    if (durationMs <= bucket) current.buckets[index] += 1;
  });
  durationCounters.set(durationKey, current);
}

const esc = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

export function prometheusMetrics(
  pool: Pool,
  extra: { inflight: number; analyticsBuffered: number; role: string },
): string {
  const lines: string[] = [
    "# HELP maria_http_requests_total Completed HTTP requests.",
    "# TYPE maria_http_requests_total counter",
  ];
  for (const [key, count] of requestCounters) {
    const [method, path, status] = key.split("\t");
    lines.push(`maria_http_requests_total{method="${esc(method)}",path="${esc(path)}",status="${esc(status)}"} ${count}`);
  }
  lines.push(
    "# HELP maria_http_request_duration_seconds HTTP request duration.",
    "# TYPE maria_http_request_duration_seconds histogram",
  );
  for (const [key, value] of durationCounters) {
    const [method, path] = key.split("\t");
    const labels = `method="${esc(method)}",path="${esc(path)}"`;
    durationBucketsMs.forEach((bucket, index) => {
      lines.push(`maria_http_request_duration_seconds_bucket{${labels},le="${bucket / 1000}"} ${value.buckets[index]}`);
    });
    lines.push(`maria_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${value.count}`);
    lines.push(`maria_http_request_duration_seconds_sum{${labels}} ${value.sumMs / 1000}`);
    lines.push(`maria_http_request_duration_seconds_count{${labels}} ${value.count}`);
  }

  const memory = process.memoryUsage();
  lines.push(
    "# TYPE maria_inflight_requests gauge",
    `maria_inflight_requests{role="${esc(extra.role)}"} ${extra.inflight}`,
    "# TYPE maria_analytics_buffered gauge",
    `maria_analytics_buffered ${extra.analyticsBuffered}`,
    "# TYPE maria_pg_pool_total gauge",
    `maria_pg_pool_total ${pool.totalCount}`,
    "# TYPE maria_pg_pool_idle gauge",
    `maria_pg_pool_idle ${pool.idleCount}`,
    "# TYPE maria_pg_pool_waiting gauge",
    `maria_pg_pool_waiting ${pool.waitingCount}`,
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${memory.rss}`,
    "# TYPE nodejs_eventloop_delay_p95_seconds gauge",
    `nodejs_eventloop_delay_p95_seconds ${Number(eventLoop.percentile(95)) / 1e9}`,
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime()}`,
  );
  eventLoop.reset();
  return lines.join("\n") + "\n";
}

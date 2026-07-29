/**
 * B24-fallback создания заказа: когда шлюз сайта /api/order-create.php лежит
 * (HTML вместо JSON), заказ уходит сделкой в Bitrix24 напрямую и клиент получает
 * ok:true (leadOnly). Семантические ошибки PHP fallback НЕ триггерят.
 * https замокан целиком — сеть и боевой B24 в тестах не трогаются.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

type Handler = (opts: { hostname: string; path: string }, body: string) => { data: string };
const routes: { fn: Handler | null } = { fn: null };

vi.mock("https", () => {
  function request(opts: { hostname: string; path: string }, cb: (r: unknown) => void) {
    const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
    let body = "";
    req.write = (d: string) => { body += d; };
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => {
      const { data } = routes.fn!(opts, body);
      const res = new EventEmitter();
      process.nextTick(() => {
        cb(res);
        res.emit("data", Buffer.from(data));
        res.emit("end");
      });
    };
    return req;
  }
  return { default: { request }, request };
});

const REQ = {
  phone: "79990000000",
  name: "Тест Тестович",
  items: [{ id: 101, qty: 2 }],
  comment: "контекст",
};
const INFO = [{ id: 101, name: "Торт Тестовый", price: 1500, qty: 2 }];

async function loadCreateOrder() {
  vi.resetModules();
  process.env.ORDER_API = "https://site.fake/api/order-create.php";
  process.env.ORDER_TOKEN = "tok";
  process.env.BITRIX_WEBHOOK = "https://b24.fake/rest/1/hash/";
  const mod = await import("../src/order");
  return mod.createOrder;
}

describe("createOrder B24-fallback при лежащем сайте", () => {
  const b24Calls: Array<{ path: string; body: string }> = [];
  beforeEach(() => { b24Calls.length = 0; });

  it("HTML вместо JSON → ok:true, leadOnly, сделка с пометкой и товарами из кэша", async () => {
    routes.fn = (opts, body) => {
      if (opts.path.includes("order-create.php")) return { data: "<!DOCTYPE html><html>404</html>" };
      b24Calls.push({ path: opts.path, body });
      if (opts.path.includes("crm.lead.add.json")) return { data: JSON.stringify({ result: 555 }) };
      return { data: JSON.stringify({ result: true }) };
    };
    const createOrder = await loadCreateOrder();
    const r = await createOrder(REQ, INFO);
    expect(r.ok).toBe(true);
    expect(r.leadOnly).toBe(true);
    expect(r.total).toBe(3000);
    const lead = b24Calls.find((c) => c.path.includes("crm.lead.add.json"));
    expect(lead).toBeTruthy();
    expect(lead!.body).toContain("сайт недоступен");
    expect(lead!.body).toContain("НЕ создан в Bitrix Sale");
    const rows = b24Calls.find((c) => c.path.includes("productrows"));
    expect(rows!.body).toContain("Торт Тестовый");
    expect(rows!.body).toContain("1500");
  });

  it("семантическая ошибка PHP (шлюз жив) → отдаётся как есть, B24 не трогаем", async () => {
    routes.fn = (opts, body) => {
      if (opts.path.includes("order-create.php")) return { data: JSON.stringify({ ok: false, error: "invalid_phone" }) };
      b24Calls.push({ path: opts.path, body });
      return { data: JSON.stringify({ result: 1 }) };
    };
    const createOrder = await loadCreateOrder();
    const r = await createOrder(REQ, INFO);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid_phone");
    expect(r.leadOnly).toBeUndefined();
    expect(b24Calls.length).toBe(0);
  });

  it("сайт лежит И B24 лёг → исходная ошибка шлюза, не ложный успех", async () => {
    routes.fn = (opts) => {
      if (opts.path.includes("order-create.php")) return { data: "<!DOCTYPE html>" };
      return { data: "<html>b24 тоже лёг</html>" };
    };
    const createOrder = await loadCreateOrder();
    const r = await createOrder(REQ, INFO);
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/^bad_response:/);
  });
});

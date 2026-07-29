/**
 * Создание заказа: бот-обёртка вокруг /api/order-create.php на сайте.
 * Дополнительно — создание deal в Bitrix24 (CRM) через входящий webhook,
 * чтобы менеджер увидел заявку в B24 сразу, не дожидаясь Sale-sync.
 */

import https from "https";

const ORDER_API   = process.env.ORDER_API   ?? ""; // https://www.maria-irk.ru/api/order-create.php
const ORDER_TOKEN = process.env.ORDER_TOKEN ?? ""; // shared
const B24_WEBHOOK = process.env.BITRIX_WEBHOOK ?? ""; // https://b24.maria-irk.ru/rest/USER_ID/HASH/

export interface OrderItem {
  id: number;
  qty: number;
}

export interface OrderRequest {
  phone: string;
  name: string;
  items: OrderItem[];
  address?: string;
  delivery_date?: string;
  delivery_time?: string;
  comment?: string;
  email?: string;
  /** Платформа заказчика — для SOURCE_DESCRIPTION в Bitrix24 (default tg). */
  platform?: "tg" | "vk";
}

export interface OrderResultItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

export interface OrderResult {
  ok: boolean;
  orderId?: number;
  accountNumber?: string;
  total?: number;
  currency?: string;
  message?: string;
  error?: string;
  items?: OrderResultItem[];
  /** Сайт недоступен — заказ создан ТОЛЬКО сделкой в B24, менеджер оформит вручную. */
  leadOnly?: boolean;
}

export async function createOrder(req: OrderRequest, itemsInfo?: OrderResultItem[]): Promise<OrderResult> {
  if (!ORDER_API || !ORDER_TOKEN) {
    return { ok: false, error: "order_api_not_configured" };
  }
  if (!req.phone || !req.name || !Array.isArray(req.items) || req.items.length === 0) {
    return { ok: false, error: "missing_fields" };
  }

  // 1) Создание заказа в Bitrix Sale (b_sale_order)
  const saleResult = await callJsonPost(
    `${ORDER_API}${ORDER_API.includes("?") ? "&" : "?"}token=${encodeURIComponent(ORDER_TOKEN)}`,
    req,
  ) as OrderResult;

  if (!saleResult.ok) {
    // Шлюз сайта лежит (HTML вместо JSON / таймаут / сеть) — заказ НЕ должен теряться:
    // создаём сделку напрямую в B24 (менеджер оформит вручную), клиенту — «принято».
    // Семантические ошибки PHP (валидация и т.п.) сюда не попадают — там шлюз жив.
    const errStr = String(saleResult.error ?? "");
    const upstreamDown = errStr.startsWith("bad_response:") || errStr === "timeout"
      || /ECONN|ENOTFOUND|EAI_AGAIN|socket|TLS|certificate/i.test(errStr);
    if (upstreamDown && B24_WEBHOOK) {
      const enriched = itemsInfo && itemsInfo.length ? itemsInfo : undefined;
      const total = enriched ? enriched.reduce((s, i) => s + i.price * i.qty, 0) : undefined;
      const leadId = await pushToBitrix24(req, { ok: false, total, items: enriched }, true).catch((e) => {
        console.error("[B24] fallback failed:", (e as Error).message);
        return null;
      });
      if (leadId) {
        console.error(`[ORDER] site API down (${errStr}) — заказ ушёл ТОЛЬКО лидом в B24 #${leadId}`);
        return { ok: true, total, leadOnly: true };
      }
    }
    return saleResult;
  }

  // 2) Параллельно — создание deal в Bitrix24 CRM (для менеджера)
  // Не блокирует ответ юзеру — fire-and-log.
  if (B24_WEBHOOK) {
    pushToBitrix24(req, saleResult).catch((e) => {
      console.error("[B24] failed:", (e as Error).message);
    });
  }

  return saleResult;
}

function callJsonPost(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const opts: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      rejectUnauthorized: false,
    };
    const httpReq = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c: Buffer) => (d += c));
      r.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { resolve({ ok: false, error: `bad_response:${(e as Error).message}` }); }
      });
    });
    httpReq.on("error", (e) => resolve({ ok: false, error: e.message }));
    httpReq.setTimeout(20_000, () => { httpReq.destroy(); resolve({ ok: false, error: "timeout" }); });
    httpReq.write(payload);
    httpReq.end();
  });
}

async function pushToBitrix24(req: OrderRequest, sale: OrderResult, siteDown = false): Promise<number | null> {
  const tail = (req.phone || "").replace(/\D/g, "").slice(-10);
  const phoneFmt = tail ? `+7 (${tail.slice(0,3)}) ${tail.slice(3,6)}-${tail.slice(6,8)}-${tail.slice(8,10)}` : req.phone;

  const nameParts = (req.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || req.name;
  const lastName  = nameParts.slice(1).join(" ");

  // Используем items из ответа PHP (там полный name + price), если PHP старый —
  // fallback на req.items с одним id.
  const items: OrderResultItem[] = sale.items && sale.items.length
    ? sale.items
    : req.items.map((i) => ({ id: i.id, name: `Товар #${i.id}`, price: 0, qty: i.qty }));

  // Используем BMP-only символы (Bitrix MySQL utf8 не держит 4-байтные эмодзи)
  const title = siteDown
    ? `⚠ Заказ из Mini App (сайт недоступен) · ${req.name}`
    : `★ Заказ #${sale.orderId ?? '—'} · ${req.name}`;

  // Состав заказа — человеческое описание
  const itemsList = items.map((i) => {
    const sum = (i.price * i.qty).toLocaleString("ru-RU");
    const pricePer = i.price ? `${i.price.toLocaleString("ru-RU")} ₽` : "—";
    return `• ${i.name} — ${i.qty} × ${pricePer} = ${sum} ₽`;
  }).join("\n");

  // Структурированный комментарий — менеджер видит всё подряд в правой панели лида
  const lines: string[] = [];
  if (siteDown) {
    lines.push("!!! /api сайта недоступен — заказ НЕ создан в Bitrix Sale.");
    lines.push("Оформите заказ вручную и перезвоните клиенту.");
    lines.push("");
  }
  lines.push(`Сумма заказа: ${sale.total ?? '?'} ₽`);
  lines.push(`☎ Телефон: ${phoneFmt}`);
  if (req.email)         lines.push(`✉ Email: ${req.email}`);
  if (req.address)       lines.push(`▼ Адрес: ${req.address}`);
  if (req.delivery_date) lines.push(`▶ Дата доставки: ${req.delivery_date}`);
  if (req.delivery_time) lines.push(`⏰ Время доставки: ${req.delivery_time}`);
  lines.push("");
  lines.push("▼ Состав заказа:");
  lines.push(itemsList);
  if (req.comment) {
    lines.push("");
    lines.push("ⓘ Контекст клиента:");
    lines.push(req.comment);
  }
  if (!siteDown) {
    lines.push("");
    lines.push(`→ Заказ в Sale: https://www.maria-irk.ru/bitrix/admin/sale_order_view.php?ID=${sale.orderId ?? ''}`);
  }
  const comments = lines.join("\n");

  const fields: Record<string, unknown> = {
    TITLE:              title,
    NAME:               firstName,
    LAST_NAME:          lastName,
    PHONE:              [{ VALUE: req.phone, VALUE_TYPE: "WORK" }],
    COMMENTS:           comments,
    SOURCE_ID:          "WEB",
    SOURCE_DESCRIPTION: req.platform === "vk" ? "VK Mini App" : "Telegram Mini App",
    OPPORTUNITY:        sale.total ?? 0,
    CURRENCY_ID:        "RUB",
  };
  if (req.email)   fields.EMAIL = [{ VALUE: req.email, VALUE_TYPE: "WORK" }];
  if (req.address) fields.ADDRESS = req.address;

  // 1) Создаём лид
  const addUrl = B24_WEBHOOK.endsWith("/") ? B24_WEBHOOK + "crm.lead.add.json" : B24_WEBHOOK + "/crm.lead.add.json";
  const created = await callJsonPost(addUrl, { fields }) as { result?: number; error?: string };
  console.log(`[B24] lead for #${sale.orderId ?? (siteDown ? 'SITE_DOWN' : '—')} →`, JSON.stringify(created).substring(0, 300));
  const leadId = created?.result;
  if (!leadId) return null;

  // 2) Прикрепляем товары к лиду — отображаются в B24 как полноценный список
  // (а не только текстом в COMMENTS). Поле PRODUCT_ID опускаем — товары
  // в Bitrix24 CRM каталоге могут быть не синхронизированы с маркет-каталогом сайта;
  // отдаём PRODUCT_NAME, PRICE, QUANTITY — этого достаточно для отображения.
  const productrows = items.map((i) => ({
    PRODUCT_NAME: i.name,
    PRICE:        i.price,
    QUANTITY:     i.qty,
  }));
  const rowsUrl = B24_WEBHOOK.endsWith("/") ? B24_WEBHOOK + "crm.lead.productrows.set.json" : B24_WEBHOOK + "/crm.lead.productrows.set.json";
  const rowsRes = await callJsonPost(rowsUrl, { id: leadId, rows: productrows }) as { result?: boolean; error?: string };
  console.log(`[B24] productrows lead=${leadId} (${productrows.length}) →`, JSON.stringify(rowsRes).substring(0, 200));
  return leadId;
}

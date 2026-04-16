import https from "https";
import * as cheerio from "cheerio";

const BASE = "https://www.maria-irk.ru";
const AUTH_AJAX = `${BASE}/bitrix/components/bxmaker/authuserphone.enter/ajax.php`;

// Храним сессии в памяти: phone → session state
const sessions = new Map<string, SessionState>();

interface SessionState {
  phpsessid: string;
  gid: string;
  sessid: string;
  rand: string;
  template: string;
  parameters: string;
  createdAt: number;
  cookie?: string;  // cookie авторизованного пользователя
}

export interface LoyaltyData {
  name?: string;
  level?: string;
  balance?: string;
  cashback?: string;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function request(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ body: string; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      rejectUnauthorized: false,
    };

    const req = https.request(reqOptions, (res) => {
      const cookies = (res.headers["set-cookie"] ?? []) as string[];
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ body: Buffer.concat(chunks).toString("utf-8"), cookies })
      );
    });
    req.on("error", reject);
    req.setTimeout(12_000, () => { req.destroy(); reject(new Error("Timeout")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseCookies(cookieHeaders: string[]) {
  const map: Record<string, string> = {};
  for (const h of cookieHeaders) {
    const [pair] = h.split(";");
    const [k, v] = pair.split("=");
    if (k && v) map[k.trim()] = v.trim();
  }
  return map;
}

function cookieStr(obj: Record<string, string>) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ─── Step 1: Получить сессию и отправить SMS ──────────────────────────────────
export async function sendCode(phone: string): Promise<{ ok: boolean; message: string }> {
  // Очищаем старую сессию
  sessions.delete(phone);

  // Чистим телефон: только цифры
  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length < 10) return { ok: false, message: "Неверный формат телефона" };
  const normalizedPhone = cleanPhone.startsWith("8") ? "7" + cleanPhone.slice(1) : cleanPhone;

  try {
    // Шаг 1: GET /auth/ — получаем cookies и параметры
    const authPage = await request(`${BASE}/auth/`, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ru-RU,ru;q=0.9" },
    });

    const cookieMap = parseCookies(authPage.cookies);
    const phpsessid = cookieMap["PHPSESSID"] ?? "";
    const gid = cookieMap["BITRIX_SM_BXMAKER_AUP_GID2"] ?? "";

    // Парсим sessid, rand, template, parameters из HTML
    const html = authPage.body;
    const sessid = (html.match(/bitrix_sessid":"([a-f0-9]{32})/) ?? [])[1] ?? "";
    const rand = (html.match(/"rand":"([a-zA-Z0-9]{4,})"/) ?? [])[1] ?? "";
    const template = (html.match(/"template":"([^"]+)"/) ?? [])[1] ?? "";
    const parameters = (html.match(/"parameters":"([^"]+)"/) ?? [])[1] ?? "";

    if (!phpsessid || !sessid) {
      return { ok: false, message: "Не удалось получить сессию с сайта" };
    }

    // Шаг 2: POST authByPhone — отправляем SMS
    const cookieHeader = cookieStr({ PHPSESSID: phpsessid, BITRIX_SM_BXMAKER_AUP_GID2: gid });
    const body = new URLSearchParams({
      siteId: "s1",
      rand,
      sessid,
      template,
      parameters,
      expandData: "{}",
      phone: normalizedPhone,
      method: "authByPhone",
    }).toString();

    const smsResp = await request(AUTH_AJAX, {
      method: "POST",
      headers: {
        "Cookie": cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${BASE}/auth/`,
        "User-Agent": "Mozilla/5.0",
      },
      body,
    });

    const smsJson = JSON.parse(smsResp.body);

    if (smsJson.error) {
      const code = smsJson.error.code ?? "";
      if (code === "ERROR_USER_NOT_FOUND") {
        return { ok: false, message: "Номер не зарегистрирован в программе лояльности" };
      }
      return { ok: false, message: smsJson.error.msg ?? "Ошибка отправки кода" };
    }

    // Обновляем sessid из куков ответа
    const newCookies = parseCookies(smsResp.cookies);
    const finalSessid = newCookies["PHPSESSID"] ? await refreshSessid(newCookies["PHPSESSID"] ?? phpsessid, gid) : sessid;

    // Сохраняем сессию
    sessions.set(phone, {
      phpsessid: newCookies["PHPSESSID"] ?? phpsessid,
      gid: newCookies["BITRIX_SM_BXMAKER_AUP_GID2"] ?? gid,
      sessid: finalSessid,
      rand,
      template,
      parameters,
      createdAt: Date.now(),
    });

    // Автоудаление через 10 минут
    setTimeout(() => sessions.delete(phone), 10 * 60 * 1000);

    return { ok: true, message: "Код отправлен на ваш номер" };
  } catch (e) {
    return { ok: false, message: "Ошибка соединения с сайтом" };
  }
}

async function refreshSessid(phpsessid: string, gid: string): Promise<string> {
  const r = await request(`${BASE}/auth/`, {
    method: "GET",
    headers: {
      "Cookie": cookieStr({ PHPSESSID: phpsessid, BITRIX_SM_BXMAKER_AUP_GID2: gid }),
      "User-Agent": "Mozilla/5.0",
    },
  });
  return (r.body.match(/bitrix_sessid":"([a-f0-9]{32})/) ?? [])[1] ?? "";
}

// ─── Step 2: Подтвердить код и получить баланс ────────────────────────────────
export async function verifyCode(
  phone: string,
  code: string
): Promise<{ ok: boolean; message: string; data?: LoyaltyData }> {
  const session = sessions.get(phone);
  if (!session) return { ok: false, message: "Сессия истекла, запросите код повторно" };

  const cleanPhone = phone.replace(/\D/g, "");
  const normalizedPhone = cleanPhone.startsWith("8") ? "7" + cleanPhone.slice(1) : cleanPhone;

  try {
    const cookieHeader = cookieStr({
      PHPSESSID: session.phpsessid,
      BITRIX_SM_BXMAKER_AUP_GID2: session.gid,
    });

    // Шаг 3: startConfirm — подтверждение кода
    const body = new URLSearchParams({
      siteId: "s1",
      rand: session.rand,
      sessid: session.sessid,
      template: session.template,
      parameters: session.parameters,
      expandData: "{}",
      phone: normalizedPhone,
      confirmType: "sms",
      confirmValue: code.trim(),
      actionType: "login",
      method: "startConfirm",
    }).toString();

    const confirmResp = await request(AUTH_AJAX, {
      method: "POST",
      headers: {
        "Cookie": cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": `${BASE}/auth/`,
        "User-Agent": "Mozilla/5.0",
      },
      body,
    });

    const confirmJson = JSON.parse(confirmResp.body);

    if (confirmJson.error) {
      const code_err = confirmJson.error.code ?? "";
      if (code_err === "ERROR_INVALID_CODE") {
        return { ok: false, message: "Неверный код. Попробуйте ещё раз" };
      }
      return { ok: false, message: confirmJson.error.msg ?? "Ошибка подтверждения" };
    }

    // Успешная авторизация — собираем авторизованные куки
    const authCookies = parseCookies(confirmResp.cookies);
    const authCookieStr = cookieStr({
      PHPSESSID: authCookies["PHPSESSID"] ?? session.phpsessid,
      ...authCookies,
    });

    sessions.set(phone, { ...session, cookie: authCookieStr });

    // Парсим баланс
    const loyaltyData = await fetchLoyalty(authCookieStr);
    sessions.delete(phone);

    return { ok: true, message: "Авторизация успешна", data: loyaltyData };
  } catch (e) {
    return { ok: false, message: "Ошибка соединения с сайтом" };
  }
}

// ─── Парсинг баланса с личного кабинета ─────────────────────────────────────
async function fetchLoyalty(cookieHeader: string): Promise<LoyaltyData> {
  const result: LoyaltyData = {};

  try {
    const resp = await request(`${BASE}/personal/`, {
      method: "GET",
      headers: {
        "Cookie": cookieHeader,
        "User-Agent": "Mozilla/5.0",
        "Referer": `${BASE}/`,
      },
    });

    const $ = cheerio.load(resp.body);

    // Пробуем разные варианты — структура может отличаться
    const selectors = {
      balance: [
        '.bonus-balance', '.bonus-amount', '.score-value', '.balance-value',
        '[class*="bonus"]', '[class*="score"]', '[class*="balance"]',
        'span[class*="points"]', '.loyalty-balance',
      ],
      level: [
        '.loyalty-level', '.club-level', '[class*="level"]', '.user-level',
      ],
      name: [
        '.user-name', '.profile-name', 'h1.name', '.personal-name',
      ],
    };

    for (const sel of selectors.name) {
      const v = $(sel).first().text().trim();
      if (v && v.length > 1 && v.length < 50) { result.name = v; break; }
    }

    for (const sel of selectors.level) {
      const v = $(sel).first().text().trim();
      if (v && v.length > 1) { result.level = v; break; }
    }

    for (const sel of selectors.balance) {
      const v = $(sel).first().text().trim();
      const num = v.replace(/\s/g, "").match(/\d+/);
      if (num) { result.balance = v; break; }
    }

    // Если не нашли через селекторы — ищем по тексту
    if (!result.balance) {
      $("*").each((_, el) => {
        const text = $(el).text().trim();
        if (/балл|бонус|bonus/i.test(text) && /\d+/.test(text) && text.length < 60) {
          const match = text.match(/(\d[\d\s]*)\s*(балл|бонус)/i);
          if (match) { result.balance = match[1].trim() + " баллов"; return false; }
        }
      });
    }

  } catch {}

  return result;
}

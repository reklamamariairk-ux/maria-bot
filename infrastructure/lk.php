<?php
/**
 * Личный кабинет: возвращает баланс баллов, статус, билеты «Сладкого чека»
 * для участника клуба «Мария для своих» по номеру телефона.
 *
 * Куда положить:  /api/lk.php
 * Доступ:         https://www.maria-irk.ru/api/lk.php?token=XXX&phone=79991234567
 *
 * Источник данных — 1С УПП (89.108.119.147), те же эндпоинты, что использует
 * страница /personal/bonuses/ и /personal/lottery/ на сайте:
 *   - Bonus/{phone}        → JSON {"Bonus": "..."} или текст «Нет данных…»
 *   - SweetCheck/Info/{phone} → XML <Scores>...</Scores>
 *
 * Безопасность:
 *   - shared-token (LK_TOKEN), знает только бот.
 *   - Опционально IP-allowlist (ALLOWED_IPS = []).
 *   - Бот вызывает только для верифицированных номеров (phone_verified_at).
 *
 * Контракт ответа:
 *   {
 *     "found":    true|false,           // удалось ли что-то достать из 1С
 *     "name":     "Имя Фамилия" | null, // если пользователь есть в Bitrix
 *     "level":    "Семья",              // на сайте сейчас единый уровень
 *     "balance":  1234,                 // баллов
 *     "tickets":  5,                    // билетов «Сладкого чека»
 *     "phone":    "8XXXXXXXXXX"         // нормализованный (для отладки)
 *   }
 */

const LK_TOKEN     = 'a4e4705f63070a189cc9bfa5bc65a722aa63bd9c981cae37229731eaca396a98';
const ONEC_HOST    = 'http://89.108.119.147';
const ONEC_AUTH    = 'web:web';
const ALLOWED_IPS  = []; // [] = разрешены все, иначе ['1.2.3.4', ...]

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');

if (($_GET['token'] ?? '') !== LK_TOKEN) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if (!empty(ALLOWED_IPS) && !in_array($_SERVER['REMOTE_ADDR'] ?? '', ALLOWED_IPS, true)) {
    http_response_code(403);
    echo json_encode(['error' => 'ip_not_allowed']);
    exit;
}

$phone = normalizePhone($_GET['phone'] ?? '');
if (!$phone) {
    http_response_code(400);
    echo json_encode(['error' => 'bad_phone']);
    exit;
}

$balance      = fetchBalance($phone);
$tickets      = fetchTickets($phone);
$found        = ($balance['ok'] || $tickets['ok']);
$bitrixUser   = lookupBitrixUser($phone);

echo json_encode([
    'found'         => $found,
    'name'          => $bitrixUser['name'] ?? null,
    'level'         => 'Семья',
    'balance'       => $balance['value'],
    'tickets'       => [],                  // детальный список (пока 1С не отдаёт — пустой)
    'tickets_count' => $tickets['value'],   // суммарное число билетов из 1С
    'phone'         => $phone,
], JSON_UNESCAPED_UNICODE);


// ─── Помощники ─────────────────────────────────────────────────────────────

function normalizePhone(string $raw): ?string {
    $p = preg_replace('/[^\d+]/', '', $raw);
    if (preg_match('/^\+?7/', $p)) {
        $p = '8' . preg_replace('/^\+?7/', '', $p);
    } elseif (strpos($p, '+8') === 0) {
        $p = ltrim($p, '+');
    }
    $p = preg_replace('/\D/', '', $p);
    return (strlen($p) === 11 && $p[0] === '8') ? $p : null;
}

function callOneC(string $path): array {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => ONEC_HOST . $path,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
        CURLOPT_USERPWD        => ONEC_AUTH,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'body' => $body === false ? '' : (string)$body];
}

function fetchBalance(string $phone): array {
    $r = callOneC("/f_base_2023/hs/Website/Bonus/{$phone}");
    if ($r['code'] !== 200 || $r['body'] === '') {
        return ['ok' => false, 'value' => 0];
    }
    if (mb_stripos($r['body'], 'Нет данных') !== false) {
        return ['ok' => true, 'value' => 0];
    }
    $j = json_decode($r['body'], true);
    if (json_last_error() === JSON_ERROR_NONE && isset($j['Bonus'])) {
        $v = (float)str_replace(',', '.', (string)$j['Bonus']);
        return ['ok' => true, 'value' => (int)round($v)];
    }
    return ['ok' => false, 'value' => 0];
}

function fetchTickets(string $phone): array {
    $r = callOneC("/f_base_2023/hs/SweetCheck/Info/{$phone}");
    if ($r['code'] !== 200 || $r['body'] === '') {
        return ['ok' => false, 'value' => 0];
    }
    libxml_use_internal_errors(true);
    $xml = simplexml_load_string($r['body']);
    if ($xml && isset($xml->Scores)) {
        $n = (int)preg_replace('/[^\d]/', '', (string)$xml->Scores);
        return ['ok' => true, 'value' => $n];
    }
    return ['ok' => false, 'value' => 0];
}

function lookupBitrixUser(string $phone): array {
    require_once($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');
    $tail = substr($phone, 1); // 10-digit suffix without leading 8
    $variants = ['+7'.$tail, '7'.$tail, '8'.$tail, $tail];
    foreach ($variants as $v) {
        $db = CUser::GetList('id', 'asc', ['PERSONAL_PHONE' => $v], ['SELECT' => ['ID', 'NAME', 'LAST_NAME']]);
        if ($u = $db->Fetch()) {
            $name = trim(($u['NAME'] ?? '') . ' ' . ($u['LAST_NAME'] ?? ''));
            return ['id' => $u['ID'], 'name' => $name ?: null];
        }
    }
    return ['id' => null, 'name' => null];
}

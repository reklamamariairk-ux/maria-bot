<?php
/**
 * bonus-add.php — шлюз НАЧИСЛЕНИЯ бонусов в 1С из Mini App «Мария».
 *
 * Зачем шлюз: 1С (89.108.119.147) на IP-whitelist — ходить можно только с сайта
 * maria-irk.ru (как lk.php). Приложение постит сюда, мы проксируем в 1С.
 *
 * Поток:  app POST {token, phone, amount, reason, key}
 *      →  1С  POST http://89.108.119.147/f_base_2023/hs/Website/BonusAdd  (web:web)
 *
 * Деплой: положить в /api/ на www.maria-irk.ru (файловый менеджер админки, как lk.php).
 * Проверка: curl -XPOST https://www.maria-irk.ru/api/bonus-add.php \
 *             -H 'Content-Type: application/json' \
 *             -d '{"token":"...","phone":"79991234567","amount":1,"reason":"test","key":"t1"}'
 *
 * ⚠️ ПОДГОНИ имена полей в $payload ниже под реальный метод BonusAdd в 1С,
 *    если он ждёт другие (напр. "Телефон"/"Сумма"/"Комментарий").
 */

// Вставь сюда тот же shared-token, что в lk.php (тогда и в app env BONUS_ADD_TOKEN
// будет то же значение). Либо сгенерируй свой — главное, чтобы совпадал с env.
const BONUS_TOKEN = 'PASTE_LK_TOKEN_HERE';
const ONEC_HOST   = 'http://89.108.119.147';
const ONEC_AUTH   = 'web:web';
const ONEC_PATH   = '/f_base_2023/hs/Website/BonusAdd';

header('Content-Type: application/json; charset=utf-8');

$raw = file_get_contents('php://input');
$in  = json_decode($raw, true);
if (!is_array($in)) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'bad_json']); exit; }

if (($in['token'] ?? '') !== BONUS_TOKEN) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

$phone  = preg_replace('/\D+/', '', (string)($in['phone'] ?? ''));
$amount = (int)($in['amount'] ?? 0);
if ($phone === '' || $amount <= 0) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'bad_params']);
    exit;
}

// Точные имена полей BonusAdd неизвестны (в доках только read) — поэтому шлём
// значение СРАЗУ под распространёнными именами. 1С прочитает то, что знает, лишнее
// проигнорит. Если метод строгий и ругается на лишние поля — оставь только нужные.
$reason = (string)($in['reason'] ?? 'Mini App «Мария»');
$key    = (string)($in['key'] ?? '');
$payload = json_encode([
    'phone'   => $phone,  'Phone'   => $phone,  'Телефон'     => $phone,
    'amount'  => $amount, 'Amount'  => $amount, 'Сумма'       => $amount, 'Bonus' => $amount, 'Балл' => $amount, 'Баллы' => $amount,
    'comment' => $reason, 'Comment' => $reason, 'Комментарий' => $reason,
    'key'     => $key,    'Key'     => $key,    'Ключ'        => $key,    'operation_id' => $key,
], JSON_UNESCAPED_UNICODE);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => ONEC_HOST . ONEC_PATH,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
    CURLOPT_USERPWD        => ONEC_AUTH,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
]);
$body = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($code >= 200 && $code < 300) {
    echo json_encode(['ok' => true, 'onec' => $body], JSON_UNESCAPED_UNICODE);
} else {
    http_response_code(502);
    echo json_encode(['ok' => false, 'error' => 'onec_' . $code, 'detail' => ($err ?: $body)], JSON_UNESCAPED_UNICODE);
}

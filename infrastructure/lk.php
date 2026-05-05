<?php
/**
 * Личный кабинет: возвращает баланс, уровень, билеты «Сладкого чека»
 * для зарегистрированного на сайте maria-irk.ru участника клуба
 * по номеру телефона.
 *
 * Куда положить:
 *   /local/api/lk.php
 *   доступен по https://www.maria-irk.ru/local/api/lk.php?token=XXX&phone=79991234567
 *
 * Безопасность:
 *   — Защищено shared-token: только бот знает PARTNERS_TOKEN, без него 403.
 *   — Дополнительно — IP-allowlist (опционально, см. ALLOWED_IPS).
 *   — Бот вызывает только после того, как номер верифицирован
 *     юзером через Telegram-контакт. Двойной верификации не нужно.
 *
 * Контракт:
 *   Запрос:  GET ?token=XXX&phone=79991234567
 *   Ответ:   {
 *     "found":   true|false,
 *     "name":    "Имя Фамилия" | null,
 *     "level":   "Друзья|Лучшие друзья|Семья" | null,
 *     "balance": 1234,                           // в баллах (₽)
 *     "year_spent": 12500,                       // покупки за 12 мес. в ₽
 *     "tickets": [ {"id": "...", "name": "...", "date": "..."}, ... ]
 *   }
 *
 * Что нужно настроить на стороне сайта:
 *   1) В коде ниже подменить фрагмент «// ─── Найти пользователя по телефону»
 *      на реальный поиск в вашей системе лояльности (это зависит от того,
 *      где вы храните клубные карты — пользовательские поля Bitrix CMS,
 *      инфоблок, внешний модуль, и т.д.).
 *   2) Аналогично — секции «// ─── Получить баланс / уровень / билеты».
 *   3) PARTNERS_TOKEN ниже — заменить на длинную случайную строку,
 *      положить такую же в env Render как LK_TOKEN.
 */

const PARTNERS_TOKEN = 'CHANGE_ME_TO_RANDOM_STRING';     // обязательно поменять
const ALLOWED_IPS    = [];                                // [] = разрешены все, иначе ['1.2.3.4', '5.6.7.8']

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ─── Аутентификация ────────────────────────────────────────────────────────
$token = $_GET['token'] ?? '';
if ($token !== PARTNERS_TOKEN) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if (!empty(ALLOWED_IPS) && !in_array($_SERVER['REMOTE_ADDR'] ?? '', ALLOWED_IPS, true)) {
    http_response_code(403);
    echo json_encode(['error' => 'ip_not_allowed']);
    exit;
}

// ─── Нормализация телефона ─────────────────────────────────────────────────
$phoneRaw = $_GET['phone'] ?? '';
$phoneDigits = preg_replace('/\D/', '', $phoneRaw);
if (substr($phoneDigits, 0, 1) === '8') {
    $phoneDigits = '7' . substr($phoneDigits, 1);
}
if (strlen($phoneDigits) < 11) {
    http_response_code(400);
    echo json_encode(['error' => 'bad_phone']);
    exit;
}

// ─── Загружаем Bitrix ──────────────────────────────────────────────────────
require($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

if (!\Bitrix\Main\Loader::includeModule('iblock')) {
    http_response_code(500);
    echo json_encode(['error' => 'iblock_module_unavailable']);
    exit;
}

$response = [
    'found'      => false,
    'name'       => null,
    'level'      => null,
    'balance'    => 0,
    'year_spent' => 0,
    'tickets'    => [],
];

// ─── Найти пользователя по телефону ────────────────────────────────────────
// Стандартный путь: пользователи Bitrix Site Manager хранятся в b_user.
// Поле телефона зависит от настроек: PERSONAL_PHONE / PERSONAL_MOBILE /
// UF_PHONE / и т.д. — поправить под реальное.

$by = 'id'; $order = 'asc';
$user = null;
$dbUser = CUser::GetList(
    $by, $order,
    [
        // Пробуем все возможные поля телефона
        'LOGIC' => 'OR',
        ['PERSONAL_PHONE'  => '%' . substr($phoneDigits, -10) . '%'],
        ['PERSONAL_MOBILE' => '%' . substr($phoneDigits, -10) . '%'],
    ],
    ['SELECT' => ['UF_*']]
);
if ($u = $dbUser->Fetch()) {
    $user = $u;
}

if (!$user) {
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

$response['found'] = true;
$response['name']  = trim(($user['NAME'] ?? '') . ' ' . ($user['LAST_NAME'] ?? '')) ?: null;

// ─── Получить баланс / уровень / билеты ────────────────────────────────────
// ВАЖНО: ниже — заглушка. Замени на реальный код, который читает
// баланс из вашей системы лояльности.
//
// Если у вас балансы лежат в каком-то модуле (например, Sale, или
// в собственном инфоблоке "Карты лояльности") — здесь нужно поправить
// под реальное хранение.

// Пример заглушки — если в b_user есть пользовательское поле UF_BONUS_BALANCE:
$response['balance']    = (int)($user['UF_BONUS_BALANCE']    ?? 0);
$response['year_spent'] = (int)($user['UF_YEAR_SPENT']       ?? 0);
$response['level']      = (string)($user['UF_LOYALTY_LEVEL'] ?? '');

// Уровень по сумме за год, если поле UF_LOYALTY_LEVEL не заполнено
if (!$response['level']) {
    $spent = $response['year_spent'];
    $response['level'] = $spent >= 50000 ? 'Семья' : ($spent >= 10000 ? 'Лучшие друзья' : 'Друзья');
}

// Билеты «Сладкого чека» — пример из инфоблока, если такой есть.
// Замени IBLOCK_CODE 'sweet_check_tickets' на ваш или удали блок.
$ticketsIblockCode = 'sweet_check_tickets';
$dbTickets = CIBlockElement::GetList(
    ['DATE_CREATE' => 'DESC'],
    [
        'IBLOCK_CODE'         => $ticketsIblockCode,
        'PROPERTY_USER_ID'    => $user['ID'],
        'ACTIVE'              => 'Y',
    ],
    false,
    ['nTopCount' => 20],
    ['ID', 'NAME', 'DATE_CREATE', 'PROPERTY_TICKET_NUM']
);
while ($t = $dbTickets->Fetch()) {
    $response['tickets'][] = [
        'id'   => $t['PROPERTY_TICKET_NUM_VALUE'] ?: $t['ID'],
        'name' => $t['NAME'] ?: 'Сладкий чек',
        'date' => $t['DATE_CREATE'],
    ];
}

echo json_encode($response, JSON_UNESCAPED_UNICODE);

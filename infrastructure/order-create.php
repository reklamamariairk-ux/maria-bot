<?php
/**
 * Создание заказа в Bitrix Sale напрямую через SQL.
 * POST /api/order-create.php?token=XXX
 *
 * Body (JSON):
 *   {
 *     "phone":         "79991234567",      // обязательно
 *     "name":          "Иван Иванов",      // обязательно (имя или ФИО)
 *     "items":         [{"id": 204580, "qty": 1}, ...],   // обязательно
 *     "address":       "г Иркутск, ул ...",  // опционально
 *     "delivery_date": "07.05.2026",         // dd.mm.yyyy, по умолчанию завтра
 *     "delivery_time": "10:00-11:00",        // опционально
 *     "comment":       "...",                // опционально
 *     "email":         "..."                 // опционально
 *   }
 *
 * Ответ: { ok: true, orderId: 53731, accountNumber: "53731", url: "..." }
 *        или { ok: false, error: "..." }
 *
 * B(iii) — без онлайн-оплаты: pay_system_id = 10 (наличные при получении),
 * delivery_id = 31 (стандартный способ сайта), статус «N» (новый).
 * Менеджер увидит заказ в админке и обработает.
 */

error_reporting(0);
ini_set('display_errors', '0');
ob_start();
@require_once($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

const ORDER_TOKEN = 'a4e4705f63070a189cc9bfa5bc65a722aa63bd9c981cae37229731eaca396a98';
const SITE_ID     = 's1';
const PERSON_TYPE = 1;
const PAY_SYSTEM  = 10;
const DELIVERY_ID = 31;
const STATUS_NEW  = 'N';

// Order props (по результатам инспекции b_sale_order_props PERSON_TYPE_ID=1)
const PROP_NAME       = 61; // CONTACT_NAME (Имя, required)
const PROP_LAST_NAME  = 62; // CONTACT_LAST_NAME (Фамилия, required)
const PROP_EMAIL      = 2;  // EMAIL
const PROP_PHONE      = 3;  // PHONE (required)
const PROP_ADDRESS    = 7;  // ADDRESS (required)
const PROP_DELIV_DATE = 20; // DELIVERY_DATE (required)
const PROP_TIME_TEXT  = 68; // ORDER_67526b2eee76d (Время доставки текстом)

while (ob_get_level() > 0) ob_end_clean();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if (($_GET['token'] ?? '') !== ORDER_TOKEN) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed']);
    exit;
}

if (!\Bitrix\Main\Loader::includeModule('sale') || !\Bitrix\Main\Loader::includeModule('catalog')) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'module_unavailable']);
    exit;
}

// ─── Парсинг body ──────────────────────────────────────────────────────────
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'bad_json']);
    exit;
}

$phoneIn  = trim((string)($body['phone']  ?? ''));
$nameIn   = trim((string)($body['name']   ?? ''));
$items    = is_array($body['items'] ?? null) ? $body['items'] : [];
$address  = trim((string)($body['address']       ?? '')) ?: 'Самовывоз — уточнит менеджер';
$delivAt  = trim((string)($body['delivery_date'] ?? ''));
$timeTxt  = trim((string)($body['delivery_time'] ?? ''));
$comment  = trim((string)($body['comment']       ?? ''));
$emailIn  = trim((string)($body['email']         ?? ''));

if ($phoneIn === '' || $nameIn === '' || empty($items)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'missing_fields']);
    exit;
}

// Нормализация телефона: оставляем + и цифры, для props используем красивый формат
$phoneDigits = preg_replace('/\D/', '', $phoneIn);
if (strlen($phoneDigits) < 10) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'bad_phone']);
    exit;
}
$tail10  = substr($phoneDigits, -10);
$phoneFormatted = '+7 ' . substr($tail10, 0, 3) . ' ' . substr($tail10, 3, 3) . '-' . substr($tail10, 6, 2) . '-' . substr($tail10, 8, 2);

// Имя/Фамилия — разбиваем по первому пробелу
$nameParts = preg_split('/\s+/u', $nameIn, 2);
$firstName = $nameParts[0] ?? $nameIn;
$lastName  = $nameParts[1] ?? '—';

// Дата доставки — если не задано, берём завтра
if (!$delivAt) {
    $delivAt = date('d.m.Y', strtotime('+1 day'));
}

// ─── Подсчёт суммы по реальным ценам ──────────────────────────────────────
$conn = \Bitrix\Main\Application::getConnection();

$itemsClean = [];
$total = 0.0;
foreach ($items as $it) {
    $pid = (int)($it['id']  ?? 0);
    $qty = (float)($it['qty'] ?? 1);
    if ($pid <= 0 || $qty <= 0) continue;

    $sql = "SELECT e.NAME, p.PRICE, p.CURRENCY
            FROM b_iblock_element e
            LEFT JOIN b_catalog_price p ON p.PRODUCT_ID = e.ID AND p.CATALOG_GROUP_ID = 1
            WHERE e.ID = $pid AND e.ACTIVE = 'Y'";
    $rs = $conn->query($sql);
    $row = $rs->fetch();
    if (!$row || !$row['PRICE']) continue;

    $price = (float)$row['PRICE'];
    $itemsClean[] = [
        'id'       => $pid,
        'qty'      => $qty,
        'name'     => (string)$row['NAME'],
        'price'    => $price,
        'currency' => (string)($row['CURRENCY'] ?? 'RUB'),
    ];
    $total += $price * $qty;
}

if (empty($itemsClean)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'no_valid_items']);
    exit;
}

// ─── Найти userId по телефону (если есть) ─────────────────────────────────
$userId = 1; // anon-fallback (Bitrix admin)
$variants = ["+7$tail10", "7$tail10", "8$tail10", $tail10];
foreach ($variants as $v) {
    $u = CUser::GetList('id', 'asc', ['PERSONAL_PHONE' => $v], ['SELECT' => ['ID']])->Fetch();
    if ($u) { $userId = (int)$u['ID']; break; }
}

// ─── INSERT b_sale_order ──────────────────────────────────────────────────
$sqlHelper = $conn->getSqlHelper();
$xmlId = 'tg_' . uniqid();

$priceSafe   = number_format($total, 8, '.', '');
$comment2    = $sqlHelper->forSql($comment ?: '');
$xmlIdSafe   = $sqlHelper->forSql($xmlId);

$sql = "INSERT INTO b_sale_order (
    LID, USER_ID, PERSON_TYPE_ID, PAYED, CANCELED, STATUS_ID,
    PRICE, CURRENCY, DISCOUNT_VALUE, TAX_VALUE, SUM_PAID,
    PAY_SYSTEM_ID, DELIVERY_ID, RECOUNT_FLAG, USER_DESCRIPTION,
    XML_ID, EXTERNAL_ORDER, MARKED, RESERVED,
    DATE_INSERT, DATE_UPDATE, IS_RECURRING, ALLOW_DELIVERY,
    DEDUCTED, UPDATED_1C, RUNNING, IS_SYNC_B24, VERSION
) VALUES (
    's1', $userId, " . PERSON_TYPE . ", 'N', 'N', '" . STATUS_NEW . "',
    $priceSafe, 'RUB', 0, 0, 0,
    " . PAY_SYSTEM . ", " . DELIVERY_ID . ", 'Y', '$comment2',
    '$xmlIdSafe', 'N', 'N', 'N',
    NOW(), NOW(), 'N', 'N',
    'N', 'N', 'N', 'N', '2'
)";
$conn->queryExecute($sql);
$orderId = (int)$conn->getInsertedId();

if ($orderId <= 0) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'order_insert_failed']);
    exit;
}

// ACCOUNT_NUMBER = ID
$conn->queryExecute("UPDATE b_sale_order SET ACCOUNT_NUMBER = '$orderId' WHERE ID = $orderId");

// ─── INSERT b_sale_basket для каждой позиции ──────────────────────────────
$fuserId = 0;
try {
    if (class_exists('\Bitrix\Sale\Fuser')) {
        $fuserId = (int)\Bitrix\Sale\Fuser::getIdByUserId($userId);
    }
} catch (\Throwable $e) {}
if ($fuserId <= 0) {
    // Фейковый fuser (старая логика)
    $rs = $conn->query("SELECT ID FROM b_sale_fuser WHERE USER_ID = $userId LIMIT 1");
    $f = $rs->fetch();
    $fuserId = $f ? (int)$f['ID'] : 1;
}

foreach ($itemsClean as $item) {
    $name  = $sqlHelper->forSql($item['name']);
    $price = number_format($item['price'], 8, '.', '');
    $qty   = number_format($item['qty'],   4, '.', '');
    $pid   = (int)$item['id'];
    $sql = "INSERT INTO b_sale_basket (
        FUSER_ID, ORDER_ID, PRODUCT_ID, NAME, QUANTITY, LID, MODULE,
        PRICE, CURRENCY, DISCOUNT_PRICE, VAT_RATE, NOTES,
        DATE_INSERT, DATE_UPDATE, PRODUCT_PROVIDER_CLASS,
        CATALOG_XML_ID, PRODUCT_XML_ID, BASE_PRICE,
        CAN_BUY, DELAY, IS_RECURRING, RESERVED, RESERVE_QUANTITY, MARKING_CODE,
        SUMMARY_PRICE
    ) VALUES (
        $fuserId, $orderId, $pid, '$name', $qty, 's1', 'catalog',
        $price, 'RUB', 0, 0, '',
        NOW(), NOW(), 'CCatalogProductProvider',
        '', '$pid', $price,
        'Y', 'N', 'N', 'N', NULL, '',
        $price
    )";
    $conn->queryExecute($sql);
}

// ─── INSERT b_sale_order_props_value (свойства заказа) ────────────────────
$props = [
    PROP_NAME      => ['Имя',                              $firstName],
    PROP_LAST_NAME => ['Фамилия',                          $lastName],
    PROP_EMAIL     => ['E-Mail (для уведомлений по заказу)', $emailIn],
    PROP_PHONE     => ['Телефон (для подтверждения заказа)', $phoneFormatted],
    PROP_ADDRESS   => ['Место доставки',                   $address],
    PROP_DELIV_DATE=> ['Дата доставки',                    $delivAt],
    PROP_TIME_TEXT => ['Время доставки (текст)',           $timeTxt],
];
foreach ($props as $propId => [$name, $val]) {
    if ($val === '' || $val === null) continue;
    $nameSafe = $sqlHelper->forSql((string)$name);
    $valSafe  = $sqlHelper->forSql((string)$val);
    $sql = "INSERT INTO b_sale_order_props_value (ORDER_ID, ORDER_PROPS_ID, NAME, VALUE) VALUES ($orderId, $propId, '$nameSafe', '$valSafe')";
    $conn->queryExecute($sql);
}

// ─── SEARCH_CONTENT для поиска по нашему /api/orders.php ─────────────────
$searchParts = [
    (string)$orderId, $priceSafe,
    "+7$tail10", "8$tail10", $tail10,
    substr($tail10, -9), substr($tail10, -8), substr($tail10, -7),
    substr($tail10, -6), substr($tail10, -5), substr($tail10, -4),
    $firstName, $lastName,
    $delivAt,
    'tg_miniapp',
];
$searchSafe = $sqlHelper->forSql(implode(' ', array_filter($searchParts)));
$conn->queryExecute("UPDATE b_sale_order SET SEARCH_CONTENT = '$searchSafe' WHERE ID = $orderId");

echo json_encode([
    'ok'            => true,
    'orderId'       => $orderId,
    'accountNumber' => (string)$orderId,
    'total'         => $total,
    'currency'      => 'RUB',
    'itemsCount'    => count($itemsClean),
    'message'       => 'Заказ принят. Менеджер свяжется по номеру ' . $phoneFormatted . ' для подтверждения.',
], JSON_UNESCAPED_UNICODE);

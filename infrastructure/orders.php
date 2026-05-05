<?php
/**
 * История заказов клиента из Bitrix Sale.
 * /api/orders.php?token=XXX&phone=79991234567
 *
 * Поиск по индексированному полю b_sale_order.SEARCH_CONTENT — Bitrix
 * автоматически кладёт туда телефон во всех формах (79..., 89..., 9...).
 *
 * Возвращает 30 последних заказов клиента с сайта (включая склейку 1С).
 */

@require_once($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

const ORDERS_TOKEN = 'a4e4705f63070a189cc9bfa5bc65a722aa63bd9c981cae37229731eaca396a98';

while (ob_get_level() > 0) ob_end_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');

if (($_GET['token'] ?? '') !== ORDERS_TOKEN) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

$phoneRaw = $_GET['phone'] ?? '';
$phoneDigits = preg_replace('/\D/', '', $phoneRaw);
if (strlen($phoneDigits) < 10) {
    http_response_code(400);
    echo json_encode(['error' => 'bad_phone']);
    exit;
}
$tail10 = substr($phoneDigits, -10);

if (!\Bitrix\Main\Loader::includeModule('sale')) {
    http_response_code(500);
    echo json_encode(['error' => 'sale_module_unavailable']);
    exit;
}

$conn = \Bitrix\Main\Application::getConnection();
$sql = '%' . $conn->getSqlHelper()->forSql($tail10) . '%';

$rs = $conn->query("
    SELECT ID, DATE_INSERT, PRICE, CURRENCY, STATUS_ID, PAYED, CANCELED, USER_ID
    FROM b_sale_order
    WHERE SEARCH_CONTENT LIKE '$sql'
    ORDER BY ID DESC
    LIMIT 30
");

$orders = [];
$ids = [];
while ($r = $rs->fetch()) {
    $orders[] = $r;
    $ids[] = (int)$r['ID'];
}

$itemsByOrder = [];
if (!empty($ids)) {
    $idsList = implode(',', array_map('intval', $ids));
    $rs2 = $conn->query("
        SELECT ORDER_ID, NAME, QUANTITY, PRICE
        FROM b_sale_basket
        WHERE ORDER_ID IN ($idsList)
        ORDER BY ID ASC
    ");
    while ($row = $rs2->fetch()) {
        $oid = (int)$row['ORDER_ID'];
        if (!isset($itemsByOrder[$oid])) $itemsByOrder[$oid] = [];
        if (count($itemsByOrder[$oid]) < 10) {
            $itemsByOrder[$oid][] = [
                'name'  => $row['NAME'],
                'qty'   => (float)$row['QUANTITY'],
                'price' => (float)$row['PRICE'],
            ];
        }
    }
}

$statusMap = [];
try {
    $rs3 = $conn->query("SELECT s.ID, l.NAME FROM b_sale_status s LEFT JOIN b_sale_status_lang l ON l.STATUS_ID=s.ID AND l.LID='ru'");
    while ($row = $rs3->fetch()) {
        $statusMap[$row['ID']] = $row['NAME'] ?: $row['ID'];
    }
} catch (\Throwable $e) {}

$out = [];
foreach ($orders as $r) {
    $oid = (int)$r['ID'];
    $dateRaw = $r['DATE_INSERT'];
    $dateStr = '';
    if (is_object($dateRaw) && method_exists($dateRaw, 'format')) {
        $dateStr = $dateRaw->format('Y-m-d H:i:s');
    } elseif (is_string($dateRaw)) {
        $dateStr = $dateRaw;
    }
    $out[] = [
        'id'         => $oid,
        'date'       => $dateStr,
        'sum'        => (float)$r['PRICE'],
        'currency'   => $r['CURRENCY'],
        'status_id'  => $r['STATUS_ID'],
        'status'     => $statusMap[$r['STATUS_ID']] ?? $r['STATUS_ID'],
        'paid'       => $r['PAYED'] === 'Y',
        'canceled'   => $r['CANCELED'] === 'Y',
        'items'      => $itemsByOrder[$oid] ?? [],
    ];
}

echo json_encode([
    'phone'  => $tail10,
    'count'  => count($out),
    'orders' => $out,
], JSON_UNESCAPED_UNICODE);

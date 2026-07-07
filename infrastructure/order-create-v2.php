<?php
/**
 * Создание заказа в Bitrix Sale ШТАТНЫМ путём (\Bitrix\Sale\Order) —
 * как при обычном оформлении на сайте.
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
 * Ответ: { ok: true, orderId, accountNumber, total, currency, itemsCount, items, userId, userCreated, message }
 *        или { ok: false, error: "..." }
 *
 * Почему штатный путь (вместо прежнего сырого SQL):
 *   - заказ привязывается к настоящему покупателю b_user (создаётся/находится по
 *     телефону, как на сайте) — больше НЕ висит на администраторе (userId=1);
 *   - цены/скидки берутся из каталога через CatalogProvider (реальные данные 1С);
 *   - SEARCH_CONTENT, корзина, отгрузка, оплата заполняются движком Битрикса →
 *     заказ корректно уходит в 1С под нужным клиентом и виден в его ЛК на сайте.
 *
 * Без онлайн-оплаты: pay_system_id = 10 (наличные при получении),
 * delivery_id = 31 (стандартный способ сайта). Менеджер обрабатывает в админке.
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
const CURRENCY    = 'RUB';

// Группа покупателей для авто-создаваемого юзера (стандартная для авторизованных).
const BUYER_GROUP = 2;
// Домен для синтетического email авто-создаваемого покупателя (Битрикс требует email).
const SYNTH_EMAIL_DOMAIN = 'miniapp.maria-irk.ru';

// Order props (по результатам инспекции b_sale_order_props PERSON_TYPE_ID=1)
const PROP_NAME       = 61; // CONTACT_NAME (Имя, required)
const PROP_LAST_NAME  = 62; // CONTACT_LAST_NAME (Фамилия, required)
const PROP_EMAIL      = 2;  // EMAIL
const PROP_PHONE      = 3;  // PHONE (required)
const PROP_ADDRESS    = 7;  // ADDRESS (required)
const PROP_DELIV_DATE = 20; // DELIVERY_DATE (required)
const PROP_TIME_TEXT  = 68; // ORDER_67526b2eee76d (Время доставки текстом)

use Bitrix\Main\Loader;
use Bitrix\Sale;
use Bitrix\Sale\Order;
use Bitrix\Sale\Basket;
use Bitrix\Sale\Delivery;
use Bitrix\Sale\PaySystem;

while (ob_get_level() > 0) ob_end_clean();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

function out($arr, int $code = 200) {
    http_response_code($code);
    echo json_encode($arr, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_GET['token'] ?? '') !== ORDER_TOKEN) {
    out(['ok' => false, 'error' => 'forbidden'], 403);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(['ok' => false, 'error' => 'method_not_allowed'], 405);
}
if (!Loader::includeModule('sale') || !Loader::includeModule('catalog') || !Loader::includeModule('iblock')) {
    out(['ok' => false, 'error' => 'module_unavailable'], 500);
}

// ─── Парсинг body ──────────────────────────────────────────────────────────
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    out(['ok' => false, 'error' => 'bad_json'], 400);
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
    out(['ok' => false, 'error' => 'missing_fields'], 400);
}

// Нормализация телефона
$phoneDigits = preg_replace('/\D/', '', $phoneIn);
if (strlen($phoneDigits) < 10) {
    out(['ok' => false, 'error' => 'bad_phone'], 400);
}
$tail10 = substr($phoneDigits, -10);
$phoneFormatted = '+7 ' . substr($tail10, 0, 3) . ' ' . substr($tail10, 3, 3) . '-' . substr($tail10, 6, 2) . '-' . substr($tail10, 8, 2);
$phoneE164 = '+7' . $tail10;

// Имя/Фамилия — по первому пробелу
$nameParts = preg_split('/\s+/u', $nameIn, 2);
$firstName = $nameParts[0] ?? $nameIn;
$lastName  = $nameParts[1] ?? '—';

// Дата доставки — если не задано, завтра
if (!$delivAt) {
    $delivAt = date('d.m.Y', strtotime('+1 day'));
}

// Очистка позиций (валидные id/qty); цены берёт каталог-провайдер при сборке корзины
$itemsClean = [];
foreach ($items as $it) {
    $pid = (int)($it['id']  ?? 0);
    $qty = (float)($it['qty'] ?? 1);
    if ($pid > 0 && $qty > 0) {
        $itemsClean[$pid] = ($itemsClean[$pid] ?? 0) + $qty; // схлопываем дубли id
    }
}
if (empty($itemsClean)) {
    out(['ok' => false, 'error' => 'no_valid_items'], 400);
}

// ─── Покупатель: найти или создать (как штатное оформление на сайте) ───────
[$userId, $userCreated] = resolveOrCreateUser($tail10, $phoneE164, $firstName, $lastName, $emailIn);
if ($userId <= 0) {
    out(['ok' => false, 'error' => 'user_resolve_failed'], 500);
}

// ─── Сборка заказа штатным API ─────────────────────────────────────────────
try {
    $order = Order::create(SITE_ID, $userId);
    $order->setPersonTypeId(PERSON_TYPE);
    $order->setField('CURRENCY', CURRENCY);

    // Корзина — цены/скидки через CatalogProvider (реальные данные 1С)
    $basket = Basket::create(SITE_ID);
    foreach ($itemsClean as $pid => $qty) {
        $item = $basket->createItem('catalog', $pid);
        $item->setFields([
            'QUANTITY'               => $qty,
            'CURRENCY'               => CURRENCY,
            'LID'                    => SITE_ID,
            'PRODUCT_PROVIDER_CLASS' => '\Bitrix\Catalog\Product\CatalogProvider',
        ]);
    }
    $order->setBasket($basket);

    if (count($basket) === 0) {
        out(['ok' => false, 'error' => 'no_valid_items'], 400);
    }

    // Отгрузка (доставка)
    $shipmentCollection = $order->getShipmentCollection();
    $shipment = $shipmentCollection->createItem(
        Delivery\Services\Manager::getObjectById(DELIVERY_ID)
    );
    $shipment->setFields([
        'CURRENCY' => $order->getCurrency(),
    ]);
    $shipmentItemCollection = $shipment->getShipmentItemCollection();
    foreach ($order->getBasket()->getOrderableItems() as $bItem) {
        $shipmentItem = $shipmentItemCollection->createItem($bItem);
        $shipmentItem->setQuantity($bItem->getQuantity());
    }

    // Свойства заказа (по ID, как на сайте)
    $propValues = [
        PROP_NAME       => $firstName,
        PROP_LAST_NAME  => $lastName,
        PROP_EMAIL      => $emailIn,
        PROP_PHONE      => $phoneFormatted,
        PROP_ADDRESS    => $address,
        PROP_DELIV_DATE => $delivAt,
        PROP_TIME_TEXT  => $timeTxt,
    ];
    $propertyCollection = $order->getPropertyCollection();
    foreach ($propertyCollection as $prop) {
        $pid = (int)$prop->getPropertyId();
        if (array_key_exists($pid, $propValues)) {
            $val = (string)$propValues[$pid];
            if ($val !== '') {
                $prop->setValue($val);
            }
        }
    }

    // Пересчёт + применение скидок
    $order->doFinalAction(true);

    // Оплата (наличные при получении) на полную сумму
    $paymentCollection = $order->getPaymentCollection();
    $payment = $paymentCollection->createItem(
        PaySystem\Manager::getObjectById(PAY_SYSTEM)
    );
    $payment->setFields([
        'SUM'      => $order->getPrice(),
        'CURRENCY' => $order->getCurrency(),
    ]);

    if ($comment !== '') {
        $order->setField('USER_DESCRIPTION', $comment);
    }
    // Метка источника (для аналитики; 1С трактует как новый заказ)
    $order->setField('XML_ID', 'tg_' . uniqid());

    $res = $order->save();
    if (!$res->isSuccess()) {
        out([
            'ok'      => false,
            'error'   => 'order_save_failed',
            'message' => implode('; ', $res->getErrorMessages()),
        ], 500);
    }

    $orderId = (int)$order->getId();
    $accountNumber = (string)$order->getField('ACCOUNT_NUMBER');
    $total = (float)$order->getPrice();

    // Состав заказа для ответа (бот строит из него B24-лид)
    $itemsOut = [];
    foreach ($order->getBasket() as $bItem) {
        $itemsOut[] = [
            'id'    => (int)$bItem->getProductId(),
            'name'  => (string)$bItem->getField('NAME'),
            'price' => (float)$bItem->getPrice(),
            'qty'   => (float)$bItem->getQuantity(),
        ];
    }

    out([
        'ok'            => true,
        'orderId'       => $orderId,
        'accountNumber' => $accountNumber !== '' ? $accountNumber : (string)$orderId,
        'total'         => $total,
        'currency'      => CURRENCY,
        'itemsCount'    => count($itemsOut),
        'items'         => $itemsOut,
        'userId'        => $userId,
        'userCreated'   => $userCreated,
        'message'       => 'Заказ принят. Менеджер свяжется по номеру ' . $phoneFormatted . ' для подтверждения.',
    ]);

} catch (\Throwable $e) {
    out(['ok' => false, 'error' => 'order_exception', 'message' => $e->getMessage()], 500);
}


// ─── Помощники ─────────────────────────────────────────────────────────────

/**
 * Находит покупателя по телефону (как штатная связка сайт/1С) или создаёт нового.
 * @return array{0:int,1:bool} [userId, created]
 */
function resolveOrCreateUser(string $tail10, string $phoneE164, string $firstName, string $lastName, string $email): array {
    // 1) Поиск по всем форматам телефона в PERSONAL_PHONE
    $variants = [$phoneE164, '7' . $tail10, '8' . $tail10, $tail10];
    foreach ($variants as $v) {
        $u = CUser::GetList('id', 'asc', ['PERSONAL_PHONE' => $v], ['SELECT' => ['ID']])->Fetch();
        if ($u) {
            return [(int)$u['ID'], false];
        }
    }
    // Подстраховка: иногда телефон лежит в логине
    $u = CUser::GetList('id', 'asc', ['LOGIN' => $phoneE164], ['SELECT' => ['ID']])->Fetch();
    if ($u) {
        return [(int)$u['ID'], false];
    }

    // 2) Создание нового покупателя (как авто-регистрация при оформлении на сайте)
    $login = $phoneE164;
    // Гарантируем уникальность логина
    $exists = CUser::GetList('id', 'asc', ['LOGIN' => $login], ['SELECT' => ['ID']])->Fetch();
    if ($exists) {
        $login = $phoneE164 . '_' . substr(uniqid(), -4);
    }

    $pass = randString(16) . 'Aa1!';
    $emailFinal = $email !== '' ? $email : $tail10 . '@' . SYNTH_EMAIL_DOMAIN;

    $cuser = new CUser();
    $fields = [
        'NAME'             => $firstName,
        'LAST_NAME'        => $lastName,
        'LOGIN'            => $login,
        'EMAIL'            => $emailFinal,
        'PERSONAL_PHONE'   => $phoneE164,
        'PHONE_NUMBER'     => $phoneE164,
        'PASSWORD'         => $pass,
        'CONFIRM_PASSWORD' => $pass,
        'GROUP_ID'         => [BUYER_GROUP],
        'ACTIVE'           => 'Y',
        'LID'              => SITE_ID,
    ];
    $newId = (int)$cuser->Add($fields);
    if ($newId > 0) {
        return [$newId, true];
    }
    return [0, false];
}

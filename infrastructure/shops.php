<?php
/**
 * Список магазинов «Мария» из Bitrix.
 * /api/shops.php?token=XXX → { count, shops: [{id, name, address, phone, hours, image, url, lat, lng}] }
 *
 * Источник: тип инфоблока «shops» (видели в админке: «Магазины»).
 * Свойства зависят от шаблона — попробуем стандартные коды.
 */

error_reporting(0);
ini_set('display_errors', '0');
ob_start();
@require_once($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

const SHOPS_TOKEN = 'a4e4705f63070a189cc9bfa5bc65a722aa63bd9c981cae37229731eaca396a98';
const CACHE_TTL   = 3600; // час

while (ob_get_level() > 0) ob_end_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=600');
header('Access-Control-Allow-Origin: *');

if (($_GET['token'] ?? '') !== SHOPS_TOKEN) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if (!\Bitrix\Main\Loader::includeModule('iblock')) {
    http_response_code(500);
    echo json_encode(['error' => 'iblock_unavailable']);
    exit;
}

$cacheId = 'shops_v1';
$cache = \Bitrix\Main\Data\Cache::createInstance();
if ($cache->initCache(CACHE_TTL, $cacheId, '/maria_shops')) {
    echo $cache->getVars();
    exit;
}

// Найдём все инфоблоки типа shops
$iblocks = [];
$rs = CIBlock::GetList([], ['TYPE' => 'shops', 'ACTIVE' => 'Y']);
while ($r = $rs->Fetch()) $iblocks[] = (int)$r['ID'];

if (empty($iblocks)) {
    $body = json_encode(['count' => 0, 'shops' => [], 'error' => 'no_iblock'], JSON_UNESCAPED_UNICODE);
    if ($cache->startDataCache()) $cache->endDataCache($body);
    echo $body;
    exit;
}

$shops = [];
foreach ($iblocks as $iid) {
    $rs = CIBlockElement::GetList(
        ['SORT' => 'ASC', 'NAME' => 'ASC'],
        ['IBLOCK_ID' => $iid, 'ACTIVE' => 'Y'],
        false, false,
        ['ID', 'NAME', 'PREVIEW_PICTURE', 'DETAIL_PICTURE', 'PREVIEW_TEXT',
         'PROPERTY_ADDRESS', 'PROPERTY_PHONE', 'PROPERTY_HOURS',
         'PROPERTY_WORK_TIME', 'PROPERTY_TIME', 'PROPERTY_OPENING_HOURS',
         'PROPERTY_LAT', 'PROPERTY_LNG', 'PROPERTY_COORDS', 'PROPERTY_MAP',
         'PROPERTY_CITY']
    );
    while ($r = $rs->GetNext()) {
        $name = htmlspecialchars_decode((string)$r['NAME']);
        // Попробуем разные имена для адреса
        $address = $r['PROPERTY_ADDRESS_VALUE']
            ?? $r['PREVIEW_TEXT'] ?? '';
        if (is_array($address)) $address = $address['TEXT'] ?? '';
        $address = trim(strip_tags(html_entity_decode((string)$address, ENT_QUOTES | ENT_HTML5, 'UTF-8')));

        // Телефон / часы
        $phone = $r['PROPERTY_PHONE_VALUE'] ?? '';
        $hours = $r['PROPERTY_HOURS_VALUE']
            ?? $r['PROPERTY_WORK_TIME_VALUE']
            ?? $r['PROPERTY_TIME_VALUE']
            ?? $r['PROPERTY_OPENING_HOURS_VALUE'] ?? '';
        if (is_array($hours)) $hours = (string)reset($hours);

        // Координаты
        $lat = $r['PROPERTY_LAT_VALUE'] ?? null;
        $lng = $r['PROPERTY_LNG_VALUE'] ?? null;
        if (!$lat && !empty($r['PROPERTY_COORDS_VALUE'])) {
            $parts = preg_split('/[,;\s]+/', trim((string)$r['PROPERTY_COORDS_VALUE']));
            if (count($parts) >= 2) { $lat = $parts[0]; $lng = $parts[1]; }
        }

        $img = '';
        $iid2 = (int)($r['PREVIEW_PICTURE'] ?: $r['DETAIL_PICTURE'] ?: 0);
        if ($iid2 > 0) {
            $p = CFile::GetPath($iid2);
            if ($p) $img = 'https://www.maria-irk.ru'.$p;
        }

        $shops[] = [
            'id'      => (int)$r['ID'],
            'name'    => $name,
            'address' => $address,
            'phone'   => (string)$phone,
            'hours'   => (string)$hours,
            'city'    => (string)($r['PROPERTY_CITY_VALUE'] ?? ''),
            'lat'    => $lat ? (float)$lat : null,
            'lng'    => $lng ? (float)$lng : null,
            'image'  => $img ?: null,
        ];
    }
}

$body = json_encode([
    'count' => count($shops),
    'shops' => $shops,
    'updated' => date('c'),
], JSON_UNESCAPED_UNICODE);

if ($cache->startDataCache()) $cache->endDataCache($body);
echo $body;

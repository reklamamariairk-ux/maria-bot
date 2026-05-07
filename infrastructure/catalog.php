<?php
/**
 * Каталог товаров «Мария» из Bitrix.
 *
 *   /api/catalog.php?token=XXX
 *     → { sections, products, updated }   — весь каталог
 *
 *   /api/catalog.php?token=XXX&id=204580
 *     → { product }                       — один товар с полными данными
 *
 *   /api/catalog.php?token=XXX&section=cakes&limit=30&offset=0
 *     → { products, total, ... }          — фильтрованный список
 *
 *   /api/catalog.php?token=XXX&search=торт
 *     → { products, total }               — поиск по названию/описанию
 *
 * Источник: инфоблок 17 (aspro_next_catalog → «Товарный каталог CRM»).
 * Цена — CATALOG_GROUP_ID = 1 (Розничная цена).
 */

@require_once($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

const CATALOG_TOKEN = 'a4e4705f63070a189cc9bfa5bc65a722aa63bd9c981cae37229731eaca396a98';
const IBLOCK_ID     = 17;
const PRICE_GROUP   = 1;
const CACHE_TTL     = 600; // 10 минут

while (ob_get_level() > 0) ob_end_clean();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if (($_GET['token'] ?? '') !== CATALOG_TOKEN) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if (!\Bitrix\Main\Loader::includeModule('iblock') || !\Bitrix\Main\Loader::includeModule('catalog')) {
    http_response_code(500);
    echo json_encode(['error' => 'module_unavailable']);
    exit;
}

$mode = isset($_GET['id']) ? 'item' : (isset($_GET['search']) ? 'search' : 'list');

if ($mode === 'item') {
    $id = (int)$_GET['id'];
    if ($id <= 0) { http_response_code(400); echo json_encode(['error' => 'bad_id']); exit; }
    echo json_encode(['product' => loadProduct($id)], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($mode === 'search') {
    $q = trim((string)($_GET['search'] ?? ''));
    $limit = max(1, min(50, (int)($_GET['limit'] ?? 20)));
    if ($q === '') { echo json_encode(['products' => [], 'total' => 0]); exit; }
    $items = searchCatalog($q, $limit);
    echo json_encode(['products' => $items, 'total' => count($items), 'query' => $q], JSON_UNESCAPED_UNICODE);
    exit;
}

// Default: list mode
$section = trim((string)($_GET['section'] ?? ''));
$limit   = max(1, min(200, (int)($_GET['limit'] ?? 200)));
$offset  = max(0, (int)($_GET['offset'] ?? 0));

$cacheId = 'catalog_v1_' . md5("$section|$limit|$offset");
$cache = \Bitrix\Main\Data\Cache::createInstance();
header('Cache-Control: public, max-age=300');
if ($cache->initCache(CACHE_TTL, $cacheId, '/maria_catalog')) {
    echo $cache->getVars();
    exit;
}

$payload = ['updated' => date('c'), 'sections' => loadSections()];
$payload = array_merge($payload, loadList($section, $limit, $offset));

$body = json_encode($payload, JSON_UNESCAPED_UNICODE);
if ($cache->startDataCache()) $cache->endDataCache($body);
echo $body;


// ─── Loaders ───────────────────────────────────────────────────────────────

function loadSections(): array {
    $out = [];
    $rs = CIBlockSection::GetList(
        ['SORT' => 'ASC', 'NAME' => 'ASC'],
        ['IBLOCK_ID' => IBLOCK_ID, 'ACTIVE' => 'Y', 'DEPTH_LEVEL' => 1],
        true, // count elements
        ['ID', 'NAME', 'CODE', 'PICTURE', 'ELEMENT_CNT']
    );
    while ($s = $rs->Fetch()) {
        $img = '';
        if (!empty($s['PICTURE'])) {
            $p = CFile::GetPath((int)$s['PICTURE']);
            if ($p) $img = absUrl($p);
        }
        $out[] = [
            'id'    => (int)$s['ID'],
            'code'  => $s['CODE'],
            'name'  => $s['NAME'],
            'image' => $img ?: null,
            'count' => (int)$s['ELEMENT_CNT'],
        ];
    }
    return $out;
}

function loadList(string $sectionCode, int $limit, int $offset): array {
    $filter = ['IBLOCK_ID' => IBLOCK_ID, 'ACTIVE' => 'Y'];
    if ($sectionCode !== '') {
        $sec = CIBlockSection::GetList([], ['IBLOCK_ID' => IBLOCK_ID, 'CODE' => $sectionCode], false, ['ID'])->Fetch();
        if ($sec) $filter['SECTION_ID'] = (int)$sec['ID'];
    }

    // Total count
    $total = (int)CIBlockElement::GetList(['ID' => 'DESC'], $filter, []);

    $rs = CIBlockElement::GetList(
        ['SORT' => 'ASC', 'ID' => 'DESC'],
        $filter,
        false,
        ['nTopCount' => $limit, 'nOffset' => $offset],
        [
            'ID', 'NAME', 'CODE', 'PREVIEW_PICTURE', 'DETAIL_PICTURE',
            'PREVIEW_TEXT', 'IBLOCK_SECTION_ID', 'DETAIL_PAGE_URL',
            'PROPERTY_HIT', 'PROPERTY_PERSONS', 'PROPERTY_PROP_159',
            'PROPERTY_PREVIEW_TEXT_CUSTOM',
        ]
    );

    $out = [];
    $ids = [];
    while ($r = $rs->GetNext()) {
        $ids[] = (int)$r['ID'];
        $img = pickImage((int)$r['PREVIEW_PICTURE'], (int)$r['DETAIL_PICTURE']);
        $previewProp = strip_tags(propText($r['PROPERTY_PREVIEW_TEXT_CUSTOM_VALUE']));
        $preview = trim((string)$r['PREVIEW_TEXT']) ?: $previewProp;

        $out[] = [
            'id'         => (int)$r['ID'],
            'name'       => htmlspecialchars_decode((string)$r['NAME']),
            'code'       => $r['CODE'],
            'section_id' => (int)$r['IBLOCK_SECTION_ID'],
            'image'      => $img,
            'preview'    => mb_substr($preview, 0, 280),
            'weight'     => firstStr($r['PROPERTY_PROP_159_VALUE']),
            'persons'    => $r['PROPERTY_PERSONS_VALUE'] ?: null,
            'hit'        => !empty($r['PROPERTY_HIT_VALUE']),
            'url'        => absUrl($r['DETAIL_PAGE_URL']),
        ];
    }

    // Цены и availability — одним батчем + применение скидок (Bitrix discount rules)
    if (!empty($ids)) {
        $idsList = implode(',', array_map('intval', $ids));
        $conn = \Bitrix\Main\Application::getConnection();
        $rs2 = $conn->query("SELECT PRODUCT_ID, PRICE, CURRENCY FROM b_catalog_price WHERE PRODUCT_ID IN ($idsList) AND CATALOG_GROUP_ID = " . PRICE_GROUP);
        $priceById = [];
        while ($p = $rs2->fetch()) $priceById[(int)$p['PRODUCT_ID']] = $p;
        $rs3 = $conn->query("SELECT ID, AVAILABLE, QUANTITY FROM b_catalog_product WHERE ID IN ($idsList)");
        $availById = [];
        while ($a = $rs3->fetch()) $availById[(int)$a['ID']] = $a;

        // Применяем правила скидок (торт месяца -20% и т.п.) через CCatalogProduct::GetOptimalPrice
        // Используем группу 2 ("Все авторизованные") как стандартную для всех клиентов сайта
        $userGroups = [2];
        foreach ($out as &$item) {
            $eid = $item['id'];
            $pr = $priceById[$eid] ?? null;
            $base = $pr ? (float)$pr['PRICE'] : null;
            $finalPrice = $base;
            $discountPercent = 0;
            if ($base !== null && class_exists('\CCatalogProduct')) {
                try {
                    $opt = \CCatalogProduct::GetOptimalPrice($eid, 1, $userGroups, 'N');
                    if ($opt && isset($opt['DISCOUNT_PRICE'])) {
                        $finalPrice = (float)$opt['DISCOUNT_PRICE'];
                        $rawBase = isset($opt['PRICE']['BASE_PRICE']) ? (float)$opt['PRICE']['BASE_PRICE'] : $base;
                        if ($rawBase > $finalPrice && $rawBase > 0) {
                            $discountPercent = (int)round(($rawBase - $finalPrice) / $rawBase * 100);
                            $base = $rawBase;
                        }
                    }
                } catch (\Throwable $e) { /* fallback to base */ }
            }
            $item['price']         = $finalPrice;
            $item['oldPrice']      = ($discountPercent > 0 && $base !== null) ? $base : null;
            $item['discountPercent'] = $discountPercent;
            $item['currency']      = $pr['CURRENCY'] ?? 'RUB';
            $av = $availById[$eid] ?? null;
            $item['available']     = $av ? ($av['AVAILABLE'] === 'Y') : true;
            $item['quantity']      = $av ? (float)$av['QUANTITY'] : null;
        }
        unset($item);
    }

    return ['products' => $out, 'total' => $total, 'limit' => $limit, 'offset' => $offset, 'section' => $sectionCode ?: null];
}

function loadProduct(int $id): ?array {
    $rs = CIBlockElement::GetList(
        [], ['IBLOCK_ID' => IBLOCK_ID, 'ACTIVE' => 'Y', 'ID' => $id],
        false, ['nTopCount' => 1],
        ['*']
    );
    $el = $rs->GetNextElement();
    if (!$el) return null;
    $f = $el->GetFields();
    $props = $el->GetProperties();

    $images = [];
    foreach ([(int)($f['PREVIEW_PICTURE'] ?? 0), (int)($f['DETAIL_PICTURE'] ?? 0)] as $iid) {
        if ($iid > 0) {
            $p = CFile::GetPath($iid);
            if ($p) $images[] = absUrl($p);
        }
    }

    $description = '';
    if (!empty($props['DETAIL_TEXT_CUSTOM']['VALUE'])) {
        $description = propText($props['DETAIL_TEXT_CUSTOM']['VALUE']);
    } elseif (!empty($f['DETAIL_TEXT'])) {
        $description = (string)$f['DETAIL_TEXT'];
    }

    // Price + availability + applied discounts
    $conn = \Bitrix\Main\Application::getConnection();
    $rs2 = $conn->query("SELECT PRICE, CURRENCY FROM b_catalog_price WHERE PRODUCT_ID = $id AND CATALOG_GROUP_ID = " . PRICE_GROUP);
    $pr = $rs2->fetch();
    $rs3 = $conn->query("SELECT AVAILABLE, QUANTITY FROM b_catalog_product WHERE ID = $id");
    $av = $rs3->fetch();
    // Применяем скидки
    $base = $pr ? (float)$pr['PRICE'] : null;
    $finalPrice = $base; $discountPercent = 0;
    if ($base !== null && class_exists('\CCatalogProduct')) {
        try {
            $opt = \CCatalogProduct::GetOptimalPrice($id, 1, [2], 'N');
            if ($opt && isset($opt['DISCOUNT_PRICE'])) {
                $finalPrice = (float)$opt['DISCOUNT_PRICE'];
                $rawBase = isset($opt['PRICE']['BASE_PRICE']) ? (float)$opt['PRICE']['BASE_PRICE'] : $base;
                if ($rawBase > $finalPrice && $rawBase > 0) {
                    $discountPercent = (int)round(($rawBase - $finalPrice) / $rawBase * 100);
                    $base = $rawBase;
                }
            }
        } catch (\Throwable $e) {}
    }

    return [
        'id'          => (int)$f['ID'],
        'name'        => htmlspecialchars_decode((string)$f['NAME']),
        'code'        => $f['CODE'],
        'section_id'  => (int)$f['IBLOCK_SECTION_ID'],
        'images'      => $images,
        'description' => $description,
        'description_text' => trim(strip_tags($description)),
        'preview'     => trim(strip_tags((string)$f['PREVIEW_TEXT'])) ?: trim(strip_tags(propText($props['PREVIEW_TEXT_CUSTOM']['VALUE'] ?? ''))),
        'price'       => $finalPrice,
        'oldPrice'    => $discountPercent > 0 ? $base : null,
        'discountPercent' => $discountPercent,
        'currency'    => $pr['CURRENCY'] ?? 'RUB',
        'available'   => $av ? ($av['AVAILABLE'] === 'Y') : true,
        'quantity'    => $av ? (float)$av['QUANTITY'] : null,
        'weight'      => firstStr($props['PROP_159']['VALUE'] ?? null),
        'persons'     => $props['PERSONS']['VALUE'] ?? null,
        'hit'         => !empty($props['HIT']['VALUE']),
        'filling'     => listValues($props['FILLING'] ?? null),
        'cake_type'   => listValues($props['CAKE_TYPE'] ?? null),
        'pie_type'    => listValues($props['PIE_TYPE'] ?? null),
        'dessert_type'=> listValues($props['DESSERT_TYPE'] ?? null),
        'occasion'    => listValues($props['OCCASION'] ?? null),
        'whom'        => listValues($props['WHOM'] ?? null),
        'url'         => absUrl($f['DETAIL_PAGE_URL']),
    ];
}

function searchCatalog(string $q, int $limit): array {
    $rs = CIBlockElement::GetList(
        ['SORT' => 'ASC', 'NAME' => 'ASC'],
        ['IBLOCK_ID' => IBLOCK_ID, 'ACTIVE' => 'Y', '?NAME' => $q],
        false,
        ['nTopCount' => $limit],
        ['ID', 'NAME', 'CODE', 'PREVIEW_PICTURE', 'DETAIL_PICTURE', 'IBLOCK_SECTION_ID', 'DETAIL_PAGE_URL', 'PROPERTY_PROP_159']
    );
    $out = [];
    $ids = [];
    while ($r = $rs->GetNext()) {
        $ids[] = (int)$r['ID'];
        $out[] = [
            'id'         => (int)$r['ID'],
            'name'       => htmlspecialchars_decode((string)$r['NAME']),
            'code'       => $r['CODE'],
            'section_id' => (int)$r['IBLOCK_SECTION_ID'],
            'image'      => pickImage((int)$r['PREVIEW_PICTURE'], (int)$r['DETAIL_PICTURE']),
            'weight'     => firstStr($r['PROPERTY_PROP_159_VALUE']),
            'url'        => absUrl($r['DETAIL_PAGE_URL']),
        ];
    }
    if (!empty($ids)) {
        $conn = \Bitrix\Main\Application::getConnection();
        $idsList = implode(',', array_map('intval', $ids));
        $rs2 = $conn->query("SELECT PRODUCT_ID, PRICE, CURRENCY FROM b_catalog_price WHERE PRODUCT_ID IN ($idsList) AND CATALOG_GROUP_ID = " . PRICE_GROUP);
        $priceById = [];
        while ($p = $rs2->fetch()) $priceById[(int)$p['PRODUCT_ID']] = $p;
        foreach ($out as &$item) {
            $pr = $priceById[$item['id']] ?? null;
            $base = $pr ? (float)$pr['PRICE'] : null;
            $finalPrice = $base; $discountPercent = 0;
            if ($base !== null && class_exists('\CCatalogProduct')) {
                try {
                    $opt = \CCatalogProduct::GetOptimalPrice($item['id'], 1, [2], 'N');
                    if ($opt && isset($opt['DISCOUNT_PRICE'])) {
                        $finalPrice = (float)$opt['DISCOUNT_PRICE'];
                        $rawBase = isset($opt['PRICE']['BASE_PRICE']) ? (float)$opt['PRICE']['BASE_PRICE'] : $base;
                        if ($rawBase > $finalPrice && $rawBase > 0) {
                            $discountPercent = (int)round(($rawBase - $finalPrice) / $rawBase * 100);
                            $base = $rawBase;
                        }
                    }
                } catch (\Throwable $e) {}
            }
            $item['price']    = $finalPrice;
            $item['oldPrice'] = $discountPercent > 0 ? $base : null;
            $item['discountPercent'] = $discountPercent;
            $item['currency'] = $pr['CURRENCY'] ?? 'RUB';
        }
    }
    return $out;
}


// ─── Helpers ───────────────────────────────────────────────────────────────

function pickImage(int $preview, int $detail): ?string {
    foreach ([$preview, $detail] as $iid) {
        if ($iid > 0) {
            $p = CFile::GetPath($iid);
            if ($p) return absUrl($p);
        }
    }
    return null;
}

function absUrl(?string $rel): ?string {
    if (!$rel) return null;
    if (preg_match('#^https?://#i', $rel)) return $rel;
    return 'https://www.maria-irk.ru' . $rel;
}

function propText($v): string {
    if (is_array($v)) $v = (string)($v['TEXT'] ?? '');
    return html_entity_decode((string)$v, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function firstStr($v): ?string {
    if (is_array($v)) return $v ? (string)reset($v) : null;
    return $v ? (string)$v : null;
}

function listValues($prop): array {
    if (!$prop) return [];
    $v = $prop['VALUE'] ?? null;
    if (!$v) return [];
    if (is_array($v)) return array_values(array_map('strval', $v));
    return [(string)$v];
}

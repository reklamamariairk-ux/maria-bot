<?php
/**
 * Эндпоинт для отдачи партнёров клуба «Мария для своих» в JSON.
 *
 * Куда положить:
 *   /local/api/partners.php
 *   доступен по https://www.maria-irk.ru/local/api/partners.php?token=XXX
 *
 * Источник данных: инфоблок «Привилегии для Своих» (IBLOCK_ID = 88, CODE = privilege).
 *
 * Реальная структура инфоблока:
 *   - NAME                  → name
 *   - DETAIL_TEXT           → desc + источник для perk/emoji эвристик
 *   - PROPERTY_SHILD   (612)→ category (Список: Здоровье/Красота/Рестораны/Отдых/Дом/Авто)
 *   - PROPERTY_LINK    (613)→ url
 *   - PROPERTY_LOGO    (616)→ logo_url (файл)
 *   - PROPERTY_LOGO_TEXT(617)→ резервное короткое описание, если заполнено
 *
 * Безопасность:
 *   ?token=... должен совпадать с PARTNERS_TOKEN ниже. Сменить токен можно прямо
 *   в файле — главное синхронизировать с env-переменной PARTNERS_TOKEN на Render.
 */

// ─── Конфиг ────────────────────────────────────────────────────────────────
const PARTNERS_TOKEN = 'da5d08353c26618f5aca4dbe185275e4981aaf2fbbc77d7317de5e89f9d1f94e';
const IBLOCK_ID      = 88;                           // «Привилегии для Своих»
const CACHE_TTL      = 300;                          // сек

// ─── Старт ─────────────────────────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('Access-Control-Allow-Origin: *');

if (($_GET['token'] ?? '') !== PARTNERS_TOKEN) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

require($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

if (!\Bitrix\Main\Loader::includeModule('iblock')) {
    http_response_code(500);
    echo json_encode(['error' => 'iblock_module_unavailable']);
    exit;
}

$cacheId = 'partners_v2_iblock_'.IBLOCK_ID;
$cache = \Bitrix\Main\Data\Cache::createInstance();
if ($cache->initCache(CACHE_TTL, $cacheId, '/partners')) {
    echo $cache->getVars();
    exit;
}

// ─── Чтение элементов ─────────────────────────────────────────────────────
$select = [
    'ID', 'NAME', 'DETAIL_TEXT', 'DETAIL_TEXT_TYPE',
    'PROPERTY_SHILD',
    'PROPERTY_LINK',
    'PROPERTY_LOGO',
    'PROPERTY_LOGO_TEXT',
];

$res = CIBlockElement::GetList(
    ['SORT' => 'ASC', 'NAME' => 'ASC'],
    ['IBLOCK_ID' => IBLOCK_ID, 'ACTIVE' => 'Y'],
    false,
    false,
    $select
);

$partners = [];
while ($el = $res->Fetch()) {
    $name        = trim((string)$el['NAME']);
    $descRaw     = (string)$el['DETAIL_TEXT'];
    $descIsHtml  = ($el['DETAIL_TEXT_TYPE'] ?? 'text') === 'html';
    $desc        = $descIsHtml ? trim(strip_tags($descRaw)) : trim($descRaw);

    $logoText = $el['PROPERTY_LOGO_TEXT_VALUE'];
    if (is_array($logoText)) $logoText = $logoText['TEXT'] ?? '';
    $logoText = trim((string)$logoText);

    $url = trim((string)($el['PROPERTY_LINK_VALUE'] ?? ''));
    $url = preg_replace('/\s+/', '', $url); // в данных встречаются пробелы/табы

    $logoFileId = (int)($el['PROPERTY_LOGO_VALUE'] ?? 0);
    $logoUrl    = '';
    if ($logoFileId > 0) {
        $path = CFile::GetPath($logoFileId);
        if ($path) $logoUrl = 'https://www.maria-irk.ru'.$path;
    }

    $category = trim((string)($el['PROPERTY_SHILD_VALUE'] ?? ''));

    [$emoji, $perk] = derivePerk($desc ?: $logoText, $category);

    $partners[] = [
        'name'     => $name,
        'emoji'    => $emoji,
        'perk'     => $perk,
        'desc'     => $desc ?: $logoText,
        'category' => $category ?: null,
        'url'      => $url ?: null,
        'logo_url' => $logoUrl ?: null,
    ];
}

$payload = [
    'updated'  => date('c'),
    'count'    => count($partners),
    'partners' => $partners,
];

if ($cache->startDataCache()) {
    $cache->endDataCache(json_encode($payload, JSON_UNESCAPED_UNICODE));
}
echo json_encode($payload, JSON_UNESCAPED_UNICODE);


// ─── Эвристики ─────────────────────────────────────────────────────────────
function derivePerk(string $text, string $category): array {
    $emojiByCat = [
        'Здоровье'  => '🩺',
        'Красота'   => '💅',
        'Рестораны' => '🍽',
        'Отдых'     => '🌴',
        'Дом'       => '🏠',
        'Авто'      => '🚗',
    ];
    $defaultEmoji = $emojiByCat[$category] ?? '🤝';

    if (preg_match('/(\d{1,3})\s*%/u', $text, $m)) {
        return ['🏷', '−'.$m[1].'%'];
    }
    if (preg_match('/\bподарок\b/iu', $text)) {
        return ['🎁', '🎁 Подарок'];
    }
    if (preg_match('/(\d[\d\s]{2,})\s*(?:бонусных\s+)?баллов?/iu', $text, $m)) {
        $n = preg_replace('/\s+/', '', $m[1]);
        return ['⭐', '+'.$n.' баллов'];
    }
    return [$defaultEmoji, ''];
}

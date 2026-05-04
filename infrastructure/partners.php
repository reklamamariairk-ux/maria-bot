<?php
/**
 * Эндпоинт для отдачи партнёров клуба «Мария для своих» в JSON.
 *
 * Куда положить:
 *   /local/api/partners.php
 *   доступен по https://www.maria-irk.ru/local/api/partners.php?token=XXX
 *
 * Что нужно:
 *   1) Создан Информационный блок с символьным кодом, указанным в IBLOCK_CODE ниже
 *      (или подставить ID в IBLOCK_ID и оставить IBLOCK_CODE = '').
 *   2) В элементе:
 *        - Название         → name
 *        - Картинка анонса  → не используется здесь (можно подключить позже)
 *        - Свойства:
 *            ICON_EMOJI       (Строка)  — эмодзи-логотип, например 🔬
 *            PERK             (Строка)  — текст бейджа, например «−35%»
 *            DESCRIPTION_FULL (HTML/текст) — описание привилегии
 *            CATEGORY         (Список)  — категория (опционально)
 *      Активные элементы (ACTIVE = Y) попадают в выдачу.
 *
 * Безопасность:
 *   Параметр ?token=... должен совпадать с константой PARTNERS_TOKEN ниже.
 *   Сменить токен можно прямо в файле — главное синхронизировать его с env-переменной
 *   PARTNERS_TOKEN на стороне бота (Render).
 */

// ─── Конфиг ────────────────────────────────────────────────────────────────
const PARTNERS_TOKEN = 'CHANGE_ME_TO_RANDOM_STRING'; // ← поменяй на любую длинную случайную строку
const IBLOCK_CODE    = 'partners_club';              // символьный код инфоблока
const IBLOCK_ID      = 0;                            // или поставь числовой ID (оставь 0, если используешь CODE)
const CACHE_TTL      = 300;                          // сек — серверный кеш ответа

// ─── Старт ─────────────────────────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('Access-Control-Allow-Origin: *');

// Проверка токена
$token = $_GET['token'] ?? '';
if ($token !== PARTNERS_TOKEN) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

// Загружаем Bitrix
require($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

if (!\Bitrix\Main\Loader::includeModule('iblock')) {
    http_response_code(500);
    echo json_encode(['error' => 'iblock_module_unavailable']);
    exit;
}

// Кеш
$cacheId = 'partners_v1';
$cache = \Bitrix\Main\Data\Cache::createInstance();
if ($cache->initCache(CACHE_TTL, $cacheId, '/partners')) {
    echo $cache->getVars();
    exit;
}

// Определяем фильтр по инфоблоку
$filter = ['ACTIVE' => 'Y'];
if (IBLOCK_ID > 0) {
    $filter['IBLOCK_ID'] = IBLOCK_ID;
} else {
    $filter['IBLOCK_CODE'] = IBLOCK_CODE;
}

// Поля и свойства
$select = [
    'ID', 'NAME', 'IBLOCK_ID',
    'PROPERTY_ICON_EMOJI',
    'PROPERTY_PERK',
    'PROPERTY_DESCRIPTION_FULL',
    'PROPERTY_CATEGORY',
];

$res = CIBlockElement::GetList(
    ['SORT' => 'ASC', 'NAME' => 'ASC'],
    $filter,
    false,
    false,
    $select
);

$partners = [];
while ($el = $res->Fetch()) {
    $desc = $el['PROPERTY_DESCRIPTION_FULL_VALUE'];
    if (is_array($desc)) {
        $desc = $desc['TEXT'] ?? '';
    }
    $partners[] = [
        'emoji'    => $el['PROPERTY_ICON_EMOJI_VALUE']  ?: '🤝',
        'name'     => $el['NAME']                        ?: '',
        'perk'     => $el['PROPERTY_PERK_VALUE']        ?: '',
        'desc'     => trim((string)$desc),
        'category' => $el['PROPERTY_CATEGORY_VALUE']    ?: null,
    ];
}

$payload = [
    'updated'  => date('c'),
    'count'    => count($partners),
    'partners' => $partners,
];

// Стартуем кеш + отдаём
if ($cache->startDataCache()) {
    $cache->endDataCache(json_encode($payload, JSON_UNESCAPED_UNICODE));
}
echo json_encode($payload, JSON_UNESCAPED_UNICODE);

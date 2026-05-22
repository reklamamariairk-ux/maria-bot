/* ── Общие фронт-утилиты ──────────────────────────────────────────────────────
   Подключается ПЕРВЫМ из user-скриптов в index.html — функции доступны как
   `window.escapeHtml` и т.п. до того как остальные скрипты грузятся.

   Безопасность: ИСПОЛЬЗУЙ escapeHtml для ЛЮБОГО значения, идущего в innerHTML
   как substitution `${value}`, если оно может быть строкой от пользователя
   или из API (имена, отзывы, превью, имена товаров — теоретически меняются
   менеджером и потенциально содержат HTML). Сам HTML, который мы пишем
   шаблоном — escape не нужен.
*/
(function(){
  const _ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => _ENT[c]);
  }

  function escapeAttr(s) {
    // Для значений в атрибутах — те же правила что для текста, плюс защита от
    // переноса строки в стиле / on-handler контексте.
    return escapeHtml(s).replace(/\r?\n/g, ' ');
  }

  /** Pluralize по-русски: pluralRu(n, ['день', 'дня', 'дней']) */
  function pluralRu(n, forms) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  /** ru-RU локализация числа: 1234 → "1 234" */
  function fmtRub(n) {
    return Number(n || 0).toLocaleString('ru-RU');
  }

  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.pluralRu = pluralRu;
  window.fmtRub = fmtRub;
})();

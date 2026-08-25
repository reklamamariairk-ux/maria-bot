"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidIsoDate = isValidIsoDate;
exports.isValidDayMonth = isValidDayMonth;
exports.normalizeDeliveryDate = normalizeDeliveryDate;
/** Строгая календарная проверка без нормализации вроде 31 февраля → 2 марта. */
function isValidIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return false;
    return validParts(Number(match[1]), Number(match[2]), Number(match[3]));
}
function isValidDayMonth(day, month) {
    // 2000 — високосный год, поэтому день рождения 29.02 допустим.
    return validParts(2000, month, day);
}
/** Принимает оба формата браузера/старого checkout и возвращает ДД.ММ.ГГГГ. */
function normalizeDeliveryDate(value) {
    const raw = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (iso && validParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))) {
        return `${iso[3]}.${iso[2]}.${iso[1]}`;
    }
    const display = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
    if (display && validParts(Number(display[3]), Number(display[2]), Number(display[1]))) {
        return raw;
    }
    return null;
}
function validParts(year, month, day) {
    if (!Number.isInteger(year) || year < 1 || year > 9999)
        return false;
    if (!Number.isInteger(month) || month < 1 || month > 12)
        return false;
    if (!Number.isInteger(day) || day < 1)
        return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
}

/**
 * Markdown-безопасность пушей.
 *
 * escapePushName (pigeons.ts) — имя юзера подставляется в Markdown-пуш получателю
 * голубя. Злой first_name вида "[Забери приз](https://phish)" без экранирования
 * превращает пуш от имени бота в фишинговую ссылку.
 *
 * stripMarkdown (links.ts) — VK messages.send не понимает Markdown: снимаем
 * жирный/курсив/code, [text](url) → "text url".
 */
import { describe, it, expect } from "vitest";
import { escapePushName } from "../src/pigeons";
import { stripMarkdown } from "../src/links";

describe("escapePushName — имя юзера в Markdown-пуше", () => {
  it("обычное имя проходит без изменений", () => {
    expect(escapePushName("Вася")).toBe("Вася");
    expect(escapePushName("Мария-Кондитер 2026")).toBe("Мария-Кондитер 2026");
  });

  it("фишинговая ссылка в first_name обезвреживается", () => {
    expect(escapePushName("[Забери приз](https://phish.example)"))
      .toBe("Забери призhttps://phish.example");
    // главное: не остаётся ни [ ] ни ( ) — ссылка не соберётся
    expect(escapePushName("[x](y)")).not.toMatch(/[[\]()]/);
  });

  it("метасимволы разметки * _ ` ~ вырезаются", () => {
    expect(escapePushName("*жирный*_курсив_`код`~зачёркнутый~")).toBe("жирныйкурсивкодзачёркнутый");
  });

  it("злое имя со всеми метасимволами сразу", () => {
    const evil = "Вася[*](`_привет_`)~";
    expect(escapePushName(evil)).toBe("Васяпривет");
  });

  it("эмодзи и пробелы не трогаем", () => {
    expect(escapePushName("Кот Василий 🐱")).toBe("Кот Василий 🐱");
  });
});

describe("stripMarkdown — VK не понимает Markdown", () => {
  it("жирный/курсив/code снимаются", () => {
    expect(stripMarkdown("*жирный*")).toBe("жирный");
    expect(stripMarkdown("_курсив_")).toBe("курсив");
    expect(stripMarkdown("`код`")).toBe("код");
  });

  it("[text](url) → «text url» — ссылка остаётся видимой", () => {
    expect(stripMarkdown("[Открыть голубятню](https://t.me/mariatortik_bot)"))
      .toBe("Открыть голубятню https://t.me/mariatortik_bot");
  });

  it("обычный текст не меняется", () => {
    const t = "Тебе прилетел голубь! Загляни в голубятню.";
    expect(stripMarkdown(t)).toBe(t);
  });

  it("смешанный пуш: разметка снята, содержимое цело", () => {
    expect(stripMarkdown("🎉 *Вася* пришёл по коду `MARIA-X1` — [детали](https://x.y)"))
      .toBe("🎉 Вася пришёл по коду MARIA-X1 — детали https://x.y");
  });
});

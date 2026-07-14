// src/pigeons.ts — «Голубиная почта»: коллекция пород, обмены, почта, гонка.
// Спека: docs/superpowers/specs/2026-07-14-pigeon-market-design.md
import { Pool, PoolClient } from "pg";

export type Rarity = "common" | "rare" | "epic" | "legendary";
export interface Breed { id: string; name: string; set: string; rarity: Rarity; }

// 4 сета × 4 + «Чемпион» вне сетов (только приз гонки)
export const PIGEON_BREEDS: Breed[] = [
  { id: "sizar",    name: "Сизарь",             set: "city",  rarity: "common" },
  { id: "belobok",  name: "Белобокий",          set: "city",  rarity: "common" },
  { id: "ryaboy",   name: "Рябой",              set: "city",  rarity: "common" },
  { id: "chubaty",  name: "Чубатый",            set: "city",  rarity: "common" },
  { id: "vanil",    name: "Ванильный",          set: "sweet", rarity: "rare" },
  { id: "shoko",    name: "Шоколадный",         set: "sweet", rarity: "rare" },
  { id: "karamel",  name: "Карамельный",        set: "sweet", rarity: "rare" },
  { id: "yagodny",  name: "Ягодный",            set: "sweet", rarity: "rare" },
  { id: "pochtar",  name: "Иркутский почтарь",  set: "post",  rarity: "epic" },
  { id: "baikal",   name: "Байкальский гонец",  set: "post",  rarity: "epic" },
  { id: "kurier",   name: "Ночной курьер",      set: "post",  rarity: "epic" },
  { id: "vozhak",   name: "Вожак стаи",         set: "post",  rarity: "epic" },
  { id: "svadebny", name: "Свадебный",          set: "fest",  rarity: "epic" },
  { id: "imeninny", name: "Именинный",          set: "fest",  rarity: "epic" },
  { id: "snezhny",  name: "Снежный",            set: "fest",  rarity: "epic" },
  { id: "zolotoy",  name: "Золотой голубь Василия", set: "fest", rarity: "legendary" },
  { id: "champion", name: "Чемпион",            set: "",      rarity: "legendary" }, // не дропается
];
export const BREED_BY_ID = new Map(PIGEON_BREEDS.map(b => [b.id, b]));

// Сеты: награда монетами (v1 — только игровое). Полный альбом = 16 сетовых пород.
export const PIGEON_SETS: { id: string; name: string; reward: number }[] = [
  { id: "city",  name: "Городские",        reward: 25000 },
  { id: "sweet", name: "Кондитерские",     reward: 50000 },
  { id: "post",  name: "Почтовые легенды", reward: 75000 },
  { id: "fest",  name: "Праздничные",      reward: 100000 },
];
export const ALBUM_PASSIVE_BONUS = 0.05; // +5% к пассиву за полный альбом (16/16)

// Стикер-фразы Василия (id = индекс). Свободного текста в системе нет.
export const STICKERS: string[] = [
  "Держи, пригодится!", "Сладкого дня!", "От Василия с любовью 🐾", "Такой красавец искал тебя!",
  "За вкусную неделю!", "Пусть воркует у тебя!", "Обменяемся ещё!", "Ты в отличной стае!",
  "Спасибо за игру!", "Гур-гур! (это комплимент)",
];

export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 70, rare: 20, epic: 8, legendary: 2 };
const FEST_SET = "fest";
const WEEK_BOOST = 3; // порода недели: вес породы ×3

// Детерминированная «порода недели» от ключа недели (week = "2026-W29" из weekKey()).
// Хэш — как cipher/combo в clicker.ts: простая свёртка кодов символов.
export function breedOfWeek(week: string): string {
  let h = 0;
  for (const c of week) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const droppable = PIGEON_BREEDS.filter(b => b.id !== "champion");
  return droppable[h % droppable.length].id;
}

// Выбор породы: r1/r2 ∈ [0,1) (Math.random со стороны вызывающего — чистота ради тестов).
// eventActive=false → праздничные (fest) исключаются из пула ПОЛНОСТЬЮ.
export function pickBreed(r1: number, r2: number, week: string, eventActive: boolean): string {
  const boost = breedOfWeek(week);
  const pool = PIGEON_BREEDS.filter(b =>
    b.id !== "champion" && (eventActive || b.set !== FEST_SET));
  // редкость с учётом того, какие редкости остались в пуле
  const present = [...new Set(pool.map(b => b.rarity))];
  const totalW = present.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
  let acc = 0; let rarity: Rarity = present[present.length - 1];
  for (const r of present) { acc += RARITY_WEIGHTS[r]; if (r1 * totalW < acc) { rarity = r; break; } }
  const inRarity = pool.filter(b => b.rarity === rarity);
  // порода недели ×WEEK_BOOST внутри своей редкости
  const weighted: string[] = [];
  for (const b of inRarity) for (let i = 0; i < (b.id === boost ? WEEK_BOOST : 1); i++) weighted.push(b.id);
  return weighted[Math.floor(r2 * weighted.length)];
}

// Гарантированный дроп за покупку: редкая+ (редкая 70 / эпик 25 / легенда 5), fest вне ивента исключён.
export function pickPurchaseBreed(r1: number, r2: number, eventActive: boolean): string {
  const w: [Rarity, number][] = [["rare", 70], ["epic", 25], ["legendary", 5]];
  let acc = 0; let rarity: Rarity = "rare";
  for (const [r, x] of w) { acc += x; if (r1 * 100 < acc) { rarity = r; break; } }
  let pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === rarity && (eventActive || b.set !== FEST_SET));
  if (!pool.length) pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === "rare"); // легенда вне ивента → фолбэк на редкую
  return pool[Math.floor(r2 * pool.length)].id;
}

// Звёзды: сколько дублей скормить до следующей звезды. ★1→★2 = 3, ★2→★3 = 5, ★3 = кап.
export function starTarget(stars: number): number | null {
  return stars === 1 ? 3 : stars === 2 ? 5 : null;
}

// Гонка: очки = базис редкости + звёзды + рандом (новичок может выиграть).
const RARITY_BASE: Record<Rarity, number> = { common: 10, rare: 16, epic: 22, legendary: 28 };
export function raceScore(breedId: string, stars: number, r: number): number {
  const b = BREED_BY_ID.get(breedId); if (!b) return 0;
  return RARITY_BASE[b.rarity] + (stars - 1) * 4 + Math.floor(r * 40);
}

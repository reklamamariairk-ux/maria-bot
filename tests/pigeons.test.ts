/**
 * «Голубиная почта» — чистая игровая логика (дроп пород, звёзды, гонка)
 * + входные guard'ы денежных операций (обмены/почта), которые отвечают
 * ДО первого похода в БД: живой Postgres не нужен.
 *
 * Что здесь НЕ тестируется (намертво вшито в SQL-транзакции, см. отчёт):
 * эскроу «только дубликат» (count>1 в UPDATE), канонический порядок FOR UPDATE,
 * TTL 7 дней (INTERVAL в expireTrades), лимиты 3 оффера / 1 письмо в день.
 */
import { describe, it, expect } from "vitest";
import {
  PIGEON_BREEDS, BREED_BY_ID, RARITY_WEIGHTS, STICKERS,
  breedOfWeek, pickBreed, pickPurchaseBreed, starTarget, raceScore,
  tuneCost, raceDivision, TUNE_MAX,
  createTrade, sendMail, thankMail, setShowcase, claimSet, enterRace,
  pigeonPrice, PIGEON_PRICE,
} from "../src/pigeons";

const droppable = PIGEON_BREEDS.filter(b => b.id !== "champion");

describe("pigeonPrice — цена гонщика в питомнике", () => {
  it("растёт с редкостью и очень высока для легендарки", () => {
    expect(PIGEON_PRICE.common).toBeLessThan(PIGEON_PRICE.rare);
    expect(PIGEON_PRICE.rare).toBeLessThan(PIGEON_PRICE.epic);
    expect(PIGEON_PRICE.epic).toBeLessThan(PIGEON_PRICE.legendary);
    expect(PIGEON_PRICE.legendary).toBeGreaterThanOrEqual(1_000_000); // «трудно купить»
  });
  it("любая коллекционная порода покупаема по цене своей редкости", () => {
    for (const b of droppable) expect(pigeonPrice(b.id)).toBe(PIGEON_PRICE[b.rarity]);
  });
  it("Чемпион не продаётся (только приз гонки), неизвестная порода — null", () => {
    expect(pigeonPrice("champion")).toBeNull();
    expect(pigeonPrice("no-such-breed")).toBeNull();
  });
});

describe("breedOfWeek — детерминированная порода недели", () => {
  it("одинаковый ключ недели → одинаковая порода", () => {
    expect(breedOfWeek("20648")).toBe(breedOfWeek("20648"));
  });

  it("никогда не выпадает champion, только дропаемые породы", () => {
    for (let w = 20000; w < 20100; w++) {
      const id = breedOfWeek(String(w));
      expect(id).not.toBe("champion");
      expect(droppable.some(b => b.id === id)).toBe(true);
    }
  });

  it("разные недели дают разные породы (хэш не константа)", () => {
    const seen = new Set<string>();
    for (let w = 20000; w < 20100; w++) seen.add(breedOfWeek(String(w)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("pickBreed — дроп пород по редкости", () => {
  it("вне ивента праздничные (fest) исключены полностью → легенда недостижима", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        seen.add(pickBreed(i / 40, j / 40, "20648", false));
      }
    }
    for (const id of seen) {
      const b = BREED_BY_ID.get(id)!;
      expect(b.set).not.toBe("fest");
      expect(b.rarity).not.toBe("legendary"); // единственная дропаемая легенда — в fest
      expect(id).not.toBe("champion");
    }
  });

  it("в ивент r1→1 даёт легенду, и это ровно «Золотой голубь Василия» (champion не дропается)", () => {
    expect(pickBreed(0.999, 0.5, "20648", true)).toBe("zolotoy");
  });

  it("r1=0 → common; граница common/rare без ивента = 70/98", () => {
    // пул без fest: common 70 + rare 20 + epic 8 = 98
    expect(BREED_BY_ID.get(pickBreed(0, 0.5, "20648", false))!.rarity).toBe("common");
    expect(BREED_BY_ID.get(pickBreed(69.9 / 98, 0.5, "20648", false))!.rarity).toBe("common");
    expect(BREED_BY_ID.get(pickBreed(70.1 / 98, 0.5, "20648", false))!.rarity).toBe("rare");
    expect(BREED_BY_ID.get(pickBreed(97.9 / 98, 0.5, "20648", false))!.rarity).toBe("epic");
  });

  it("порода недели весит ×3 внутри своей редкости", () => {
    const week = "20648";
    const boost = breedOfWeek(week);
    const b = BREED_BY_ID.get(boost)!;
    // r1, гарантированно попадающий в редкость породы недели (ивент включён —
    // так порода недели точно в пуле, даже если она fest)
    const present = [...new Set(droppable.map(x => x.rarity))];
    const totalW = present.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
    let acc = 0; let r1 = 0;
    for (const r of present) {
      if (r === b.rarity) { r1 = (acc + 0.5) / totalW; break; }
      acc += RARITY_WEIGHTS[r];
    }
    const inRarity = droppable.filter(x => x.rarity === b.rarity);
    const slots = inRarity.length + 2; // порода недели занимает 3 слота вместо 1
    const counts = new Map<string, number>();
    for (let j = 0; j < slots; j++) {
      const id = pickBreed(r1, (j + 0.5) / slots, week, true);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get(boost)).toBe(3);
    for (const [id, n] of counts) if (id !== boost) expect(n).toBe(1);
  });
});

describe("pickPurchaseBreed — гарантированный дроп rare+ за покупки", () => {
  it("границы редкостей: 70 → rare, 70..95 → epic, 95+ → legendary (в ивент)", () => {
    expect(BREED_BY_ID.get(pickPurchaseBreed(0, 0, true))!.rarity).toBe("rare");
    expect(BREED_BY_ID.get(pickPurchaseBreed(0.6999, 0, true))!.rarity).toBe("rare");
    expect(BREED_BY_ID.get(pickPurchaseBreed(0.7, 0, true))!.rarity).toBe("epic");
    expect(BREED_BY_ID.get(pickPurchaseBreed(0.9499, 0, true))!.rarity).toBe("epic");
    expect(pickPurchaseBreed(0.95, 0, true)).toBe("zolotoy");
  });

  it("легенда вне ивента → фолбэк на rare (пустой пул не роняет дроп)", () => {
    const id = pickPurchaseBreed(0.99, 0.5, false);
    expect(BREED_BY_ID.get(id)!.rarity).toBe("rare");
  });

  it("вне ивента epic-пул без праздничных пород", () => {
    for (let j = 0; j < 20; j++) {
      const b = BREED_BY_ID.get(pickPurchaseBreed(0.8, j / 20, false))!;
      expect(b.rarity).toBe("epic");
      expect(b.set).not.toBe("fest");
    }
  });

  it("common не выпадает никогда — дроп за покупку всегда rare+", () => {
    for (let i = 0; i < 50; i++) {
      const b = BREED_BY_ID.get(pickPurchaseBreed(i / 50, 0.3, false))!;
      expect(b.rarity).not.toBe("common");
    }
  });
});

describe("starTarget / raceScore", () => {
  it("звёзды: ★1→★2 = 3 дубля, ★2→★3 = 5, ★3 — кап (null)", () => {
    expect(starTarget(1)).toBe(3);
    expect(starTarget(2)).toBe(5);
    expect(starTarget(3)).toBeNull();
  });

  it("очки гонки: базис редкости + звёзды + тюнинг + рывок(удача)", () => {
    // common ★1, без прокачки, r=0 → только базис редкости
    expect(raceScore("sizar", 1, 0, 0, 0, 0)).toBe(10);
    // +4 за звезду
    expect(raceScore("vanil", 2, 0, 0, 0, 0) - raceScore("vanil", 1, 0, 0, 0, 0)).toBe(4);
    // +6 за уровень скорости, +6 за выносливость
    expect(raceScore("sizar", 1, 5, 0, 0, 0)).toBe(10 + 30);
    expect(raceScore("sizar", 1, 0, 5, 0, 0)).toBe(10 + 30);
  });

  it("рывок зависит от удачи: без удачи 0..3, с удачей 10 — 0..23", () => {
    expect(raceScore("sizar", 1, 0, 0, 0, 0.9999)).toBe(10 + 2);   // floor(0.9999*3)=2
    expect(raceScore("sizar", 1, 0, 0, 10, 0.9999)).toBe(10 + 22); // floor(0.9999*23)=22
    expect(raceScore("sizar", 1, 0, 0, 0, 0)).toBe(10);            // r=0 → рывок 0
  });

  it("почти детерминированно: прокачанный common обходит непрокачанного legendary при r=0", () => {
    const commonMax = raceScore("sizar", 1, 10, 10, 0, 0);   // 10 + 120
    const legendRaw = raceScore("zolotoy", 3, 0, 0, 0, 0);   // 28 + 8
    expect(commonMax).toBeGreaterThan(legendRaw);
  });

  it("на потолке тюнинга редкость второстепенна: разрыв common↔legendary = только базис редкости", () => {
    // sizar(common,10) и zolotoy(legendary,28), оба maxed 10/10, ★1, r=0 — разница = 28−10=18
    // (=RARITY_BASE), ничтожная на фоне 120 очков тюнинга → вложение доминирует над редкостью
    const commonMax = raceScore("sizar", 1, 10, 10, 0, 0);
    const legendMax = raceScore("zolotoy", 1, 10, 10, 0, 0);
    expect(legendMax - commonMax).toBe(18);
    expect(commonMax).toBeGreaterThan(legendMax * 0.85); // разрыв <15% → редкость не решает
  });

  it("неизвестная порода → 0 очков", () => {
    expect(raceScore("kotopyos", 1, 0, 0, 0, 0.5)).toBe(0);
  });
});

describe("tuneCost / raceDivision — тюнинг и дивизионы", () => {
  it("цена уровня: 500 × 1.7^level, floor; на потолке (10) → null", () => {
    expect(tuneCost(0)).toBe(500);
    expect(tuneCost(1)).toBe(850);
    expect(tuneCost(2)).toBe(1444); // 1.7² = 2.8899…, ×500 = 1444.99…, floor
    expect(tuneCost(TUNE_MAX)).toBeNull();
    expect(tuneCost(TUNE_MAX + 1)).toBeNull();
  });

  it("дивизион по рейтингу силы: 0–8 бронза, 9–17 серебро, 18–30 золото", () => {
    expect(raceDivision(0)).toBe("bronze");
    expect(raceDivision(8)).toBe("bronze");
    expect(raceDivision(9)).toBe("silver");
    expect(raceDivision(17)).toBe("silver");
    expect(raceDivision(18)).toBe("gold");
    expect(raceDivision(30)).toBe("gold");
  });
});

describe("guard'ы обменов/почты — отвечают до похода в БД", () => {
  it("createTrade: неизвестная порода или give=want → bad_input", async () => {
    expect((await createTrade(1, "kotopyos", "vanil")).reason).toBe("bad_input");
    expect((await createTrade(1, "vanil", "kotopyos")).reason).toBe("bad_input");
    expect((await createTrade(1, "vanil", "vanil")).reason).toBe("bad_input");
  });

  it("createTrade: адресный оффер самому себе → self", async () => {
    expect((await createTrade(42, "sizar", "vanil", 42)).reason).toBe("self");
  });

  it("sendMail: неизвестная порода → bad_breed", async () => {
    expect((await sendMail(1, "kotopyos", 2, 0)).reason).toBe("bad_breed");
  });

  it("sendMail: стикер вне диапазона или дробный → bad_sticker", async () => {
    expect((await sendMail(1, "sizar", 2, STICKERS.length)).reason).toBe("bad_sticker");
    expect((await sendMail(1, "sizar", 2, -1)).reason).toBe("bad_sticker");
    expect((await sendMail(1, "sizar", 2, 1.5)).reason).toBe("bad_sticker");
  });

  it("sendMail: получатель не пресет и не целое число → bad_input", async () => {
    expect((await sendMail(1, "sizar", 2.5 as unknown as number, 0)).reason).toBe("bad_input");
  });

  it("thankMail: кривой стикер → bad_sticker", async () => {
    expect((await thankMail(1, 5, STICKERS.length)).reason).toBe("bad_sticker");
    expect((await thankMail(1, 5, NaN)).reason).toBe("bad_sticker");
  });

  it("setShowcase: больше 3 пород → bad_input, неизвестная порода → unknown_breed", async () => {
    expect((await setShowcase(1, ["sizar", "vanil", "shoko", "ryaboy"])).reason).toBe("bad_input");
    expect((await setShowcase(1, ["kotopyos"])).reason).toBe("unknown_breed");
  });

  it("claimSet: неизвестный сет → unknown_set", async () => {
    expect((await claimSet(1, "kotoset")).reason).toBe("unknown_set");
  });

  it("enterRace: гонка за флагом PIGEON_RACE_ENABLED → disabled по умолчанию", async () => {
    expect((await enterRace(1, "sizar")).reason).toBe("disabled");
  });
});

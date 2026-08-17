import { describe, expect, it } from "vitest";
import {
  BUSINESS_MAX_LEVEL,
  GIFTS_ENABLED,
  isReferralEligibleState,
  normalizeAdminPassiveBonus,
} from "../src/clicker";
import { gameStarsForScore } from "../src/club";

describe("economy safety guards", () => {
  it("keeps real-value achievement gifts disabled by default", () => {
    expect(GIFTS_ENABLED).toBe(false);
  });

  it("accepts a configured administrative passive-income bonus without an artificial cap", () => {
    expect(normalizeAdminPassiveBonus(-1)).toBe(0);
    expect(normalizeAdminPassiveBonus(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeAdminPassiveBonus(25_000)).toBe(25_000);
    expect(normalizeAdminPassiveBonus(25_000_000)).toBe(25_000_000);
  });

  it("keeps business progression finite", () => {
    expect(BUSINESS_MAX_LEVEL).toBe(20);
  });

  it("does not award convertible stars from client-reported game scores", () => {
    for (const game of ["flappy_cake", "memory", "bakery", "cat_catch", "cat_feed"]) {
      expect(gameStarsForScore(game, 5_000)).toBe(0);
    }
  });

  it("allows a referral bonus only for a fresh account", () => {
    expect(isReferralEligibleState(0, 0, null)).toBe(true);
    expect(isReferralEligibleState(5_000, 10, null)).toBe(true);
    expect(isReferralEligibleState(5_001, 0, null)).toBe(false);
    expect(isReferralEligibleState(0, 11, null)).toBe(false);
    expect(isReferralEligibleState(0, 0, 123)).toBe(false);
  });
});

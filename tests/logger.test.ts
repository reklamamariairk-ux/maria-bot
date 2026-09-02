import { describe, expect, it } from "vitest";
import { redactTelegramToken } from "../src/logger";

describe("secret-safe logging", () => {
  it("redacts Telegram bot tokens from SDK URLs and messages", () => {
    const value = "request to https://api.telegram.org/bot123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKK/setWebhook failed";
    expect(redactTelegramToken(value)).toBe(
      "request to https://api.telegram.org/bot[REDACTED_TELEGRAM_TOKEN]/setWebhook failed",
    );
  });
});

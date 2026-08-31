/** VK Mini Apps: launch-подпись и подпись номера телефона. */
import crypto from "crypto";
import { beforeAll, describe, expect, it } from "vitest";

const TEST_SECRET = "vk-test-secret";
const TEST_APP_ID = 123456;
process.env.VK_APP_SECRET = TEST_SECRET;
process.env.VK_APP_ID = String(TEST_APP_ID);

function signLaunch(params: URLSearchParams): string {
  const signedString = [...params.entries()]
    .filter(([key]) => key.startsWith("vk_"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return crypto.createHmac("sha256", TEST_SECRET).update(signedString).digest("base64url");
}

function buildLaunch(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    vk_app_id: String(TEST_APP_ID),
    vk_user_id: "11223344",
    vk_ts: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  });
  params.set("sign", signLaunch(params));
  return params.toString();
}

describe("auth-vk.ts", () => {
  let verifyVkLaunchParams: typeof import("../src/auth-vk").verifyVkLaunchParams;
  let verifyVkPhoneSign: typeof import("../src/auth-vk").verifyVkPhoneSign;

  beforeAll(async () => {
    ({ verifyVkLaunchParams, verifyVkPhoneSign } = await import("../src/auth-vk"));
  });

  it("принимает свежую launch-подпись своего приложения", () => {
    expect(verifyVkLaunchParams(buildLaunch())).toEqual({ vkUserId: 11223344, appId: TEST_APP_ID });
  });

  it("отклоняет подменённые, старые и будущие параметры", () => {
    expect(verifyVkLaunchParams(buildLaunch().replace("11223344", "11223345"))).toBeNull();
    expect(verifyVkLaunchParams(buildLaunch({ vk_ts: "1" }))).toBeNull();
    expect(verifyVkLaunchParams(buildLaunch({ vk_ts: String(Math.floor(Date.now() / 1000) + 301) }))).toBeNull();
  });

  it("отклоняет чужое приложение, дубли и некорректные ID", () => {
    expect(verifyVkLaunchParams(buildLaunch({ vk_app_id: "999999" }))).toBeNull();
    expect(verifyVkLaunchParams(`${buildLaunch()}&vk_user_id=11223344`)).toBeNull();
    expect(verifyVkLaunchParams(buildLaunch({ vk_user_id: "-1" }))).toBeNull();
    expect(verifyVkLaunchParams("vk_app_id=123456&vk_user_id=1&vk_ts=1")).toBeNull();
  });

  it("проверяет подпись номера телефона", () => {
    const phone = "+79991234567";
    const userId = 11223344;
    const sign = crypto
      .createHash("sha256")
      .update(`${TEST_APP_ID}${TEST_SECRET}${userId}phone_number${phone}`)
      .digest("hex");
    expect(verifyVkPhoneSign(phone, userId, sign)).toBe(true);
    expect(verifyVkPhoneSign("+79991234568", userId, sign)).toBe(false);
  });
});

import { initAccountLinkSchema } from "./account-link";
import { initAnalyticsSchema } from "./analytics";
import { initBonusSchema } from "./bonus1c";
import { initClickerPushSchema } from "./clicker-push";
import { initClickerSchema, initCustomSquadSchema, initSquadBankSchema } from "./clicker";
import { initClubSchema } from "./club";
import { initDb } from "./db";
import { initPigeonSchema } from "./pigeons";
import { initPurchaseSchema } from "./purchase1c";
import { initAppAuthSchema } from "./routes/app-auth";

/** Единственная последовательность schema-init для deploy/migrate и legacy all-in-one запуска. */
export async function initSchema(): Promise<void> {
  await initDb();
  await initClubSchema();
  await initClickerSchema();
  await initPigeonSchema();
  await initAnalyticsSchema();
  await initClickerPushSchema();
  await initBonusSchema();
  await initPurchaseSchema();
  await initAppAuthSchema();
  await initAccountLinkSchema();
  await initSquadBankSchema();
  await initCustomSquadSchema();
}

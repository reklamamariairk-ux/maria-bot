import "dotenv/config";
import { pool } from "./db";
import { log } from "./logger";
import { initSchema } from "./schema";

async function main(): Promise<void> {
  await initSchema();
  log.info("schema migration complete");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    log.fatal({ err: error }, "schema migration failed");
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });

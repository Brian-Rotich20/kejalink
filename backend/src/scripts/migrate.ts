/**
 * Apply pending migrations with drizzle-orm's migrator (no drizzle-kit needed),
 * for the production image / release step:
 *
 *   node dist/scripts/migrate.js        (or: npm run db:migrate:prod)
 *
 * Development uses `npm run db:migrate` (drizzle-kit). Never use `push`.
 */
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, db } from "../db/client";
import { logger } from "../lib/logger";

const migrationsFolder = path.resolve(process.cwd(), "src/db/migrations");

async function main() {
  try {
    await migrate(db, { migrationsFolder });
    logger.info({ migrationsFolder }, "Migrations applied");
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Migration failed");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();

/**
 * Apply pending migrations with drizzle-orm's migrator (no drizzle-kit needed).
 *
 *   node dist/scripts/migrate.js        (or: npm run db:migrate:prod)
 *
 * The server also calls runMigrations() at boot when MIGRATE_ON_START=true
 * (for hosts without a pre-deploy step, e.g. Render's free plan).
 * Development uses `npm run db:migrate` (drizzle-kit). Never use `push`.
 */
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, db } from "../db/client";
import { logger } from "../lib/logger";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "src/db/migrations");

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info({ migrationsFolder: MIGRATIONS_FOLDER }, "Migrations applied");
}

async function main() {
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Migration failed");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

// Run only when executed directly (not when imported by the server or tests).
if (typeof require !== "undefined" && require.main === module) void main();

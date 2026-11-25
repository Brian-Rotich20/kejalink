import { buildApp } from "./app";
import { env } from "./config/env";
import { closeDb } from "./db/client";
import { logger } from "./lib/logger";
import { runMigrations } from "./scripts/migrate";

const SHUTDOWN_TIMEOUT_MS = 10_000;

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

const start = async () => {
  // Hosts without a pre-deploy step (e.g. Render free plan) migrate at boot.
  // A failed migration stops the boot, so a broken schema never serves traffic.
  if (env.MIGRATE_ON_START) {
    try {
      await runMigrations();
    } catch (err) {
      logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "Migration failed; not starting");
      await closeDb();
      process.exit(1);
    }
  }

  const app = await buildApp();

  try {
    // PORT and HOST come from env: Render injects PORT; HOST defaults to 0.0.0.0 in production.
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error({ err }, "Failed to start");
    await closeDb();
    process.exit(1);
  }

  // Graceful shutdown: stop accepting requests, drain, then close the DB pool.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => {
      app.log.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    try {
      await app.close();
      await closeDb();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

void start();

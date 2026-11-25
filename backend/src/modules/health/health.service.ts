import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { ServiceUnavailableError } from "../../lib/errors";

export const READINESS_TIMEOUT_MS = 2_000;

/** Readiness: the database answers `select 1` within the timeout. */
export async function checkReadiness(timeoutMs = READINESS_TIMEOUT_MS): Promise<{ database: "ok" }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Database readiness check timed out")), timeoutMs);
  });

  try {
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return { database: "ok" };
  } catch {
    throw new ServiceUnavailableError("Database is not reachable", "DATABASE_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}

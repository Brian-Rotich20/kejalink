/**
 * Create (or promote) the first ADMIN account.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npm run seed:admin
 *
 * Credentials are read from the environment only (never argv, never logged).
 * The user is created through Better Auth so the password is hashed in
 * `account`, as SEEKER (public sign-up never allows ADMIN), then promoted with
 * Drizzle. Idempotent: an existing email is simply promoted.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../config/auth/better-auth";
import { closeDb, db } from "../db/client";
import { session, user } from "../db/schema";
import { logger } from "../lib/logger";

export const seedAdminInputSchema = z.object({
  ADMIN_EMAIL: z.email().transform((e) => e.toLowerCase()),
  ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters").max(128),
  ADMIN_NAME: z.string().trim().min(1).max(100).default("Administrator"),
});

export type SeedAdminResult = { userId: string; created: boolean };

export async function seedAdmin(source: NodeJS.ProcessEnv): Promise<SeedAdminResult> {
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const parsed = seedAdminInputSchema.safeParse(defined);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid admin seed configuration:\n${problems}`);
  }
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_NAME: name } = parsed.data;

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  let userId: string;
  let created = false;

  if (existing) {
    userId = existing.id;
  } else {
    const result = await auth.api.signUpEmail({ body: { name, email, password } });
    userId = result.user.id;
    created = true;
    // autoSignIn opened a session nobody will use.
    await db.delete(session).where(eq(session.userId, userId));
  }

  await db.update(user).set({ role: "ADMIN" }).where(eq(user.id, userId));
  return { userId, created };
}

async function main() {
  try {
    const { userId, created } = await seedAdmin(process.env);
    logger.info({ userId, created }, created ? "Admin account created" : "Existing account promoted to ADMIN");
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Admin seed failed");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

// Run only when executed directly (not when imported by tests).
if (typeof require !== "undefined" && require.main === module) void main();

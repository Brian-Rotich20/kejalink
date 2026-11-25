import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, signIn, signUp, type TestApp } from "./helpers";
import { testSql } from "./test-db";

let t: TestApp;
let seedAdmin: (source: NodeJS.ProcessEnv) => Promise<{ userId: string; created: boolean }>;

beforeAll(async () => {
  t = await createTestApp();
  ({ seedAdmin } = await import("../src/scripts/seed-admin"));
});
afterAll(async () => {
  await t.app.close();
});

const env = (overrides: Record<string, string> = {}) => ({
  ADMIN_EMAIL: "Root@Example.test",
  ADMIN_PASSWORD: "a-long-admin-password",
  ADMIN_NAME: "Root Admin",
  ...overrides,
});

describe("seed:admin", () => {
  it("creates an ADMIN with a hashed password and no leftover session; can sign in", async () => {
    const result = await seedAdmin(env());
    expect(result.created).toBe(true);
    const [row] = await testSql()`SELECT role, status, email FROM "user" WHERE id = ${result.userId}`;
    expect(row).toEqual({ role: "ADMIN", status: "ACTIVE", email: "root@example.test" });
    const [account] = await testSql()`SELECT password FROM account WHERE user_id = ${result.userId}`;
    expect(account!.password).toBeTruthy();
    expect(account!.password).not.toContain("a-long-admin-password");
    const sessions = await testSql()`SELECT id FROM session WHERE user_id = ${result.userId}`;
    expect(sessions).toHaveLength(0);
    expect((await signIn(t.app, "root@example.test", "a-long-admin-password")).status).toBe(200);
  });

  it("is idempotent and promotes an existing account", async () => {
    const existing = await signUp(t.app, { email: "existing@example.test" });
    const result = await seedAdmin(env({ ADMIN_EMAIL: "existing@example.test" }));
    expect(result).toEqual({ userId: existing.id, created: false });
    const again = await seedAdmin(env({ ADMIN_EMAIL: "existing@example.test" }));
    expect(again.created).toBe(false);
    const rows = await testSql()`SELECT role FROM "user" WHERE email = 'existing@example.test'`;
    expect(rows).toEqual([{ role: "ADMIN" }]);
  });

  it("validates input and never echoes the password", async () => {
    await expect(seedAdmin(env({ ADMIN_PASSWORD: "short" }))).rejects.toThrow(/ADMIN_PASSWORD/);
    await expect(seedAdmin(env({ ADMIN_EMAIL: "not-an-email" }))).rejects.toThrow(/ADMIN_EMAIL/);
    const err = await seedAdmin(env({ ADMIN_PASSWORD: "short" })).catch((e: Error) => e);
    expect(String(err)).not.toContain("short\"");
    expect(String(err)).not.toMatch(/: short$/m);
  });
});

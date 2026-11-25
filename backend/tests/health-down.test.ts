import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, type TestApp } from "./helpers";

// Point the APP (not the test harness) at a closed port before it is imported.
process.env.DATABASE_URL = "postgresql://postgres:test@127.0.0.1:1/unreachable_test";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

describe("database unreachable", () => {
  it("liveness stays 200; readiness returns 503 DATABASE_UNAVAILABLE within the timeout", async () => {
    expect((await api(t.app, "GET", "/api/health")).status).toBe(200);
    const started = Date.now();
    const res = await api(t.app, "GET", "/api/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

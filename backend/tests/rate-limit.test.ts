import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, type TestApp } from "./helpers";

// Before the app is imported: 3 auth requests/min, one trusted proxy hop.
process.env.AUTH_RATE_LIMIT_MAX = "3";
process.env.TRUST_PROXY = "1";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ rateLimitMax: 5 });
});
afterAll(async () => {
  await t.app.close();
});

const signInFrom = (forwardedFor: string) =>
  api(t.app, "POST", "/api/auth/sign-in/email", {
    body: { email: "nobody@example.test", password: "wrongwrong" },
    headers: { "x-forwarded-for": forwardedFor },
  });

describe("rate limiting behind one proxy hop", () => {
  it("auth routes: 429 after the limit; rotating spoofed X-Forwarded-For entries do not bypass it", async () => {
    // The proxy appends the real client (10.0.0.9); the left part is attacker-controlled.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await signInFrom(`6.6.6.${i}, 10.0.0.9`)).status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);

    // A different real client has its own bucket.
    expect((await signInFrom("10.0.0.10")).status).toBe(401);
  });

  it("global limit returns the app envelope with 429", async () => {
    const results: number[] = [];
    for (let i = 0; i < 7; i++) {
      results.push((await api(t.app, "GET", "/api/properties", { headers: { "x-forwarded-for": `7.7.7.${i}, 10.0.0.50` } })).status);
    }
    expect(results.slice(0, 5).every((s) => s === 200)).toBe(true);
    const limited = await api(t.app, "GET", "/api/properties", { headers: { "x-forwarded-for": "10.0.0.50" } });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("TOO_MANY_REQUESTS");
  });
});

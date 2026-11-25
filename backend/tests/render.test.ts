import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createAdmin, createSeeker, createTestApp, ORIGIN, type TestApp } from "./helpers";

// Render-like production settings, applied before the app is imported:
// https API URL, frontend on another site, one trusted proxy hop.
process.env.BETTER_AUTH_URL = "https://kejalink-api.onrender.com";
process.env.CROSS_SITE_COOKIES = "true";
process.env.TRUST_PROXY = "1";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

describe("Render deployment settings", () => {
  it("CROSS_SITE_COOKIES: session cookie is SameSite=None; Secure; Partitioned, and still works", async () => {
    const res = await api(t.app, "POST", "/api/auth/sign-up/email", {
      body: { name: "Cross Site", email: "cross@example.test", password: "password123" },
    });
    expect(res.status).toBe(200);
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw : [String(raw)]).find((c) => c.includes("session_token="))!;
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/Partitioned/i);
    expect(cookie).toMatch(/HttpOnly/i);

    const me = await api(t.app, "GET", "/api/users/me", { cookie: cookie.split(";", 1)[0] });
    expect(me.status).toBe(200);
  });

  it("CSRF still holds with SameSite=None: cross-origin cookie mutations are refused", async () => {
    const user = await createSeeker(t.app);
    const res = await api(t.app, "PATCH", "/api/users/me", {
      cookie: user.cookie,
      body: { name: "csrf" },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("INVALID_ORIGIN");
  });

  it("admin request diagnostics show the client IP resolved behind one proxy hop", async () => {
    const admin = await createAdmin(t.app);
    const res = await api(t.app, "GET", "/api/admin/diagnostics/request", {
      cookie: admin.cookie,
      headers: { origin: ORIGIN, "x-forwarded-for": "6.6.6.6, 102.0.2.7" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.ip).toBe("102.0.2.7"); // the entry appended by the proxy, not the spoofed one
    expect(res.body.data.headers["x-forwarded-for"]).toBe("6.6.6.6, 102.0.2.7");

    const seeker = await createSeeker(t.app);
    expect((await api(t.app, "GET", "/api/admin/diagnostics/request", { cookie: seeker.cookie })).status).toBe(403);
  });

  it("runMigrations() is idempotent (safe with MIGRATE_ON_START on every boot)", async () => {
    const { runMigrations } = await import("../src/scripts/migrate");
    await expect(runMigrations()).resolves.toBeUndefined();
    await expect(runMigrations()).resolves.toBeUndefined();
  });
});

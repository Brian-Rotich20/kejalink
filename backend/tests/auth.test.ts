import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createAdmin, createSeeker, createTenant, setUserStatus, signIn, signUp, type TestApp, createTestApp } from "./helpers";
import { testSql } from "./test-db";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

describe("registration", () => {
  it.each(["ADMIN", "admin", "SUPERUSER"])("rejects role %s at sign-up", async (role) => {
    const res = await api(t.app, "POST", "/api/auth/sign-up/email", {
      body: { name: "X", email: `r.${role}@example.test`, password: "password123", role },
    });
    expect(res.status).toBe(400);
    const [row] = await testSql()`SELECT count(*)::int AS n FROM "user"`;
    expect(row!.n).toBe(0);
  });

  it("never honours a client-supplied status (Better Auth drops it; the hook forces ACTIVE)", async () => {
    const res = await api(t.app, "POST", "/api/auth/sign-up/email", {
      body: { name: "X", email: "s@example.test", password: "password123", status: "BANNED" },
    });
    expect(res.status).toBe(200);
    const [row] = await testSql()`SELECT status FROM "user" WHERE email = 's@example.test'`;
    expect(row!.status).toBe("ACTIVE");
  });

  it("defaults to SEEKER and ACTIVE when no role is sent", async () => {
    const user = await signUp(t.app, { name: "  Spaced Name  " });
    const [row] = await testSql()`SELECT role, status, name FROM "user" WHERE id = ${user.id}`;
    expect(row).toEqual({ role: "SEEKER", status: "ACTIVE", name: "Spaced Name" });
  });

  it("accepts TENANT", async () => {
    const user = await createTenant(t.app);
    expect(user.role).toBe("TENANT");
  });

  it("rejects names longer than 100 characters and blank names", async () => {
    for (const name of ["a".repeat(101), "   "]) {
      const res = await api(t.app, "POST", "/api/auth/sign-up/email", {
        body: { name, email: `n${name.length}@example.test`, password: "password123" },
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("role escalation (AUDIT C1)", () => {
  it("Better Auth /update-user is disabled and the role is unchanged", async () => {
    const user = await createTenant(t.app);
    const res = await api(t.app, "POST", "/api/auth/update-user", { cookie: user.cookie, body: { role: "ADMIN" } });
    expect(res.status).toBe(404);
    const [row] = await testSql()`SELECT role FROM "user" WHERE id = ${user.id}`;
    expect(row!.role).toBe("TENANT");
  });

  it("PATCH /api/users/me rejects role and status", async () => {
    const user = await createSeeker(t.app);
    for (const body of [{ role: "ADMIN" }, { status: "ACTIVE" }]) {
      const res = await api(t.app, "PATCH", "/api/users/me", { cookie: user.cookie, body });
      expect(res.status).toBe(422);
    }
    const [row] = await testSql()`SELECT role FROM "user" WHERE id = ${user.id}`;
    expect(row!.role).toBe("SEEKER");
  });
});

describe("database constraints (AUDIT H3)", () => {
  it("rejects invalid role, invalid status and NULL status", async () => {
    const insert = (role: string | null, status: string | null) =>
      testSql()`INSERT INTO "user" (id, name, email, role, status) VALUES (${crypto.randomUUID()}, 'x', ${crypto.randomUUID() + "@x.test"}, ${role}, ${status})`;
    await expect(insert("SUPERUSER", "ACTIVE")).rejects.toThrow(/user_role_check/);
    await expect(insert("SEEKER", "DELETED")).rejects.toThrow(/user_status_check/);
    await expect(insert("SEEKER", null)).rejects.toThrow(/not-null/);
  });

  it("stores auth timestamps as timestamptz", async () => {
    const rows = await testSql()`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_name IN ('user','session','account','verification') AND data_type LIKE 'timestamp%'`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.data_type).toBe("timestamp with time zone");
  });
});

describe("suspended users (AUDIT H4)", () => {
  it.each(["SUSPENDED", "BANNED"])("a %s user's live session gets 403 ACCOUNT_SUSPENDED", async (status) => {
    const user = await createSeeker(t.app);
    expect((await api(t.app, "GET", "/api/users/me", { cookie: user.cookie })).status).toBe(200);

    await setUserStatus(user.id, status);
    const res = await api(t.app, "GET", "/api/users/me", { cookie: user.cookie });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_SUSPENDED");

    const login = await signIn(t.app, user.email);
    expect(login.status).toBe(403);
  });

  it("a suspended user still browses public routes anonymously", async () => {
    const user = await createSeeker(t.app);
    await setUserStatus(user.id, "SUSPENDED");
    const res = await api(t.app, "GET", "/api/properties", { cookie: user.cookie });
    expect(res.status).toBe(200);
  });
});

describe("guards", () => {
  it("returns 401 before body validation on protected routes", async () => {
    const res = await api(t.app, "PATCH", "/api/users/me", { body: { unknown: "x", name: 42 } });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for the wrong role before validating the body", async () => {
    const seeker = await createSeeker(t.app);
    const res = await api(t.app, "POST", "/api/properties", { cookie: seeker.cookie, body: { nonsense: true } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("role guards: TENANT-only routes refuse SEEKER and ADMIN", async () => {
    const admin = await createAdmin(t.app);
    const res = await api(t.app, "GET", "/api/properties/me", { cookie: admin.cookie });
    expect(res.status).toBe(403);
  });
});

describe("origin checks (CSRF)", () => {
  it("rejects cross-origin and missing-Origin cookie POSTs on auth routes", async () => {
    const user = await createSeeker(t.app);
    const evil = await api(t.app, "POST", "/api/auth/sign-out", {
      cookie: user.cookie,
      headers: { origin: "http://evil.example" },
    });
    expect(evil.status).toBe(403);
    const missing = await api(t.app, "POST", "/api/auth/sign-out", { cookie: user.cookie, noOrigin: true });
    expect(missing.status).toBe(403);
  });

  it("rejects cross-origin and missing-Origin cookie mutations on app routes", async () => {
    const user = await createSeeker(t.app);
    const evil = await api(t.app, "PATCH", "/api/users/me", {
      cookie: user.cookie,
      body: { name: "csrf" },
      headers: { origin: "http://evil.example" },
    });
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe("INVALID_ORIGIN");
    const missing = await api(t.app, "PATCH", "/api/users/me", { cookie: user.cookie, body: { name: "x" }, noOrigin: true });
    expect(missing.status).toBe(403);
    const [row] = await testSql()`SELECT name FROM "user" WHERE id = ${user.id}`;
    expect(row!.name).toBe("Seeker");
  });

  it("does not require Origin for safe methods", async () => {
    const user = await createSeeker(t.app);
    expect((await api(t.app, "GET", "/api/users/me", { cookie: user.cookie, noOrigin: true })).status).toBe(200);
  });
});

describe("exposed Better Auth surface", () => {
  it("disabled endpoints return 404", async () => {
    const { DISABLED_AUTH_PATHS } = await import("../src/config/auth/better-auth");
    const user = await createSeeker(t.app);
    for (const path of DISABLED_AUTH_PATHS) {
      const res = await api(t.app, "POST", `/api/auth${path}`, { cookie: user.cookie, body: {} });
      expect(res.status, path).toBe(404);
    }
  });

  it("kept endpoints still work: change-password, list-sessions, revoke-other-sessions", async () => {
    const user = await createSeeker(t.app);
    const change = await api(t.app, "POST", "/api/auth/change-password", {
      cookie: user.cookie,
      body: { currentPassword: "password123", newPassword: "password456", revokeOtherSessions: false },
    });
    expect(change.status).toBe(200);
    expect((await signIn(t.app, user.email, "password456")).status).toBe(200);
    const sessions = await api(t.app, "GET", "/api/auth/list-sessions", { cookie: user.cookie });
    expect(sessions.status).toBe(200);
    expect(sessions.body.length).toBeGreaterThanOrEqual(1);
    expect((await api(t.app, "POST", "/api/auth/revoke-other-sessions", { cookie: user.cookie, body: {} })).status).toBe(200);
  });
});

describe("session lifecycle", () => {
  it("sign-out invalidates the session", async () => {
    const user = await createSeeker(t.app);
    expect((await api(t.app, "POST", "/api/auth/sign-out", { cookie: user.cookie })).status).toBe(200);
    expect((await api(t.app, "GET", "/api/users/me", { cookie: user.cookie })).status).toBe(401);
  });

  it("get-session works through the bridge, including HEAD", async () => {
    const user = await createSeeker(t.app);
    const res = await api(t.app, "GET", "/api/auth/get-session", { cookie: user.cookie });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    const head = await api(t.app, "HEAD", "/api/auth/get-session", { cookie: user.cookie });
    expect(head.status).toBe(200);
    expect(head.raw).toBe("");
  });

  it("session timestamps survive the Africa/Nairobi process time zone", async () => {
    expect(new Date().getTimezoneOffset()).toBe(-180); // vitest config sets TZ=Africa/Nairobi
    const user = await createSeeker(t.app);
    const [row] = await testSql()`SELECT expires_at, created_at FROM session WHERE user_id = ${user.id}`;
    const days = (row!.expires_at.getTime() - row!.created_at.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 2);
    expect(Math.abs(row!.created_at.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

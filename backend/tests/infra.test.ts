import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTenant, createTestApp, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({
    beforeReady: (app) => {
      app.get("/api/__test/boom", async () => {
        throw new Error("secret internal detail at /srv/app.ts:42");
      });
      app.get("/api/__test/pg-unique", async () => {
        throw Object.assign(new Error("Failed query: insert ... params: a@b.c"), {
          cause: Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "x" }),
        });
      });
      app.get("/api/__test/pg-check", async () => {
        throw Object.assign(new Error("Failed query"), { cause: { code: "23514" } });
      });
    },
  });
});
afterAll(async () => {
  await t.app.close();
});

describe("error envelope", () => {
  it("malformed JSON -> 400 BAD_REQUEST", async () => {
    const res = await api(t.app, "POST", "/api/auth/sign-in/email", {
      payload: '{"email":',
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: "BAD_REQUEST", details: null } });
  });

  it("Zod failure -> 422 VALIDATION_ERROR with field details", async () => {
    const res = await api(t.app, "GET", "/api/properties?limit=500&page=0");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const fields = res.body.error.details.map((d: any) => d.field).sort();
    expect(fields).toEqual(["limit", "page"]);
  });

  it("unknown route -> 404 NOT_FOUND without echoing the query string", async () => {
    const res = await api(t.app, "GET", "/api/nope?token=abc");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).not.toContain("token");
  });

  it("unexpected error -> 500 INTERNAL_SERVER_ERROR, generic message, no stack", async () => {
    const res = await api(t.app, "GET", "/api/__test/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong", details: null },
    });
    expect(res.raw).not.toContain("secret internal detail");
    expect(res.raw).not.toContain("app.ts");
  });

  it("Postgres unique violation -> 409 CONFLICT; check violation -> 422; no SQL or params leak", async () => {
    const unique = await api(t.app, "GET", "/api/__test/pg-unique");
    expect(unique.status).toBe(409);
    expect(unique.body.error.code).toBe("CONFLICT");
    expect(unique.raw).not.toContain("a@b.c");
    expect(unique.raw).not.toContain("insert");
    const check = await api(t.app, "GET", "/api/__test/pg-check");
    expect(check.status).toBe(422);
  });

  it("form-encoded bodies are refused (415) once past the auth guard", async () => {
    const tenant = await createTenant(t.app);
    const res = await api(t.app, "POST", "/api/properties", {
      cookie: tenant.cookie,
      payload: "a=1",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("Better Auth keeps its native error format under /api/auth/*", async () => {
    const res = await api(t.app, "POST", "/api/auth/sign-in/email", { body: { email: "nobody@example.test", password: "wrongwrong" } });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("code", "INVALID_EMAIL_OR_PASSWORD");
    expect(res.body).not.toHaveProperty("success");
  });
});

describe("health", () => {
  it("liveness and readiness are 200 with a reachable database", async () => {
    expect((await api(t.app, "GET", "/api/health")).body).toEqual({ success: true, data: { status: "ok" } });
    const ready = await api(t.app, "GET", "/api/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.data).toEqual({ status: "ok", database: "ok" });
  });

  it("the app's DB sessions carry statement and idle-in-transaction timeouts", async () => {
    const { db } = await import("../src/db/client");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql`select current_setting('statement_timeout') as st, current_setting('idle_in_transaction_session_timeout') as it`,
    );
    expect(rows[0]).toEqual({ st: "10s", it: "15s" });
  });
});

describe("security headers & CORS", () => {
  it("CORS allows the configured origin with credentials only", async () => {
    const ok = await api(t.app, "GET", "/api/health", { headers: { origin: "http://localhost:3000" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await api(t.app, "GET", "/api/health", { headers: { origin: "http://evil.example" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

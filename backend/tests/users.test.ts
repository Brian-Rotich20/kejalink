import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createSeeker, createTestApp, type TestApp } from "./helpers";
import { testSql } from "./test-db";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

describe("GET /api/users/me", () => {
  it("returns whitelisted profile fields only", async () => {
    const user = await createSeeker(t.app);
    const res = await api(t.app, "GET", "/api/users/me", { cookie: user.cookie });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ["id", "name", "email", "emailVerified", "image", "role", "status", "createdAt", "updatedAt"].sort(),
    );
  });
});

describe("PATCH /api/users/me", () => {
  it("updates name and image", async () => {
    const user = await createSeeker(t.app);
    const res = await api(t.app, "PATCH", "/api/users/me", {
      cookie: user.cookie,
      body: { name: "  New Name ", image: "https://cdn.example.test/me.png" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "New Name", image: "https://cdn.example.test/me.png" });
    const cleared = await api(t.app, "PATCH", "/api/users/me", { cookie: user.cookie, body: { image: null } });
    expect(cleared.body.data.image).toBeNull();
  });

  it("empty body is a no-op that returns the current profile", async () => {
    const user = await createSeeker(t.app);
    const res = await api(t.app, "PATCH", "/api/users/me", { cookie: user.cookie, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Seeker");
  });

  it.each([
    ["javascript: image", { image: "javascript:alert(1)" }],
    ["data: image", { image: "data:text/html,x" }],
    ["http image", { image: "http://cdn.example.test/me.png" }],
    ["blank name", { name: "   " }],
    ["long name", { name: "a".repeat(101) }],
    ["email change", { email: "other@example.test" }],
    ["unknown key", { phone: "0712345678" }],
  ])("rejects %s (422)", async (_label, body) => {
    const user = await createSeeker(t.app);
    const res = await api(t.app, "PATCH", "/api/users/me", { cookie: user.cookie, body });
    expect(res.status).toBe(422);
    const [row] = await testSql()`SELECT name, image, email FROM "user" WHERE id = ${user.id}`;
    expect(row).toEqual({ name: "Seeker", image: null, email: user.email });
  });
});

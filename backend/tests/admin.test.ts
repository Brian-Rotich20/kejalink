import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  createAdmin,
  createBooking,
  createProperty,
  createSeeker,
  createTenant,
  createTestApp,
  signIn,
  type TestApp,
} from "./helpers";
import { testSql } from "./test-db";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

const ADMIN_ROUTES: [method: "GET" | "PATCH" | "DELETE", url: string][] = [
  ["GET", "/api/admin/users"],
  ["GET", "/api/admin/users/some-id"],
  ["PATCH", "/api/admin/users/some-id"],
  ["GET", "/api/admin/properties"],
  ["PATCH", `/api/admin/properties/${randomUUID()}/reject`],
  ["PATCH", `/api/admin/properties/${randomUUID()}/restore`],
  ["DELETE", `/api/admin/properties/${randomUUID()}`],
  ["GET", "/api/admin/bookings"],
];

describe("admin access", () => {
  it("every admin route: 401 anonymous, 403 for TENANT and SEEKER (before validation)", async () => {
    const tenant = await createTenant(t.app);
    const seeker = await createSeeker(t.app);
    for (const [method, url] of ADMIN_ROUTES) {
      expect((await api(t.app, method, url, { body: {} })).status, `${method} ${url}`).toBe(401);
      for (const user of [tenant, seeker]) {
        expect((await api(t.app, method, url, { cookie: user.cookie, body: {} })).status, `${method} ${url}`).toBe(403);
      }
    }
  });
});

describe("admin users", () => {
  it("lists with filters and search (wildcards escaped), and gets by id", async () => {
    const admin = await createAdmin(t.app);
    const tenant = await createTenant(t.app, "Wanjiru Kamau");
    await createSeeker(t.app, "Otieno");

    const all = await api(t.app, "GET", "/api/admin/users", { cookie: admin.cookie });
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(3);
    expect(all.body.data[0]).not.toHaveProperty("password");

    const tenants = await api(t.app, "GET", "/api/admin/users?role=TENANT", { cookie: admin.cookie });
    expect(tenants.body.data.map((u: any) => u.id)).toEqual([tenant.id]);
    const search = await api(t.app, "GET", "/api/admin/users?q=wanjiru", { cookie: admin.cookie });
    expect(search.body.data.map((u: any) => u.id)).toEqual([tenant.id]);
    const wildcard = await api(t.app, "GET", `/api/admin/users?q=${encodeURIComponent("%")}`, { cookie: admin.cookie });
    expect(wildcard.body.data).toEqual([]);

    const one = await api(t.app, "GET", `/api/admin/users/${tenant.id}`, { cookie: admin.cookie });
    expect(one.body.data).toMatchObject({ id: tenant.id, role: "TENANT", status: "ACTIVE", email: tenant.email });
    expect((await api(t.app, "GET", "/api/admin/users/missing", { cookie: admin.cookie })).status).toBe(404);
    expect((await api(t.app, "GET", "/api/admin/users?role=OWNER", { cookie: admin.cookie })).status).toBe(422);
  });

  it.each(["SUSPENDED", "BANNED"])("%s deletes the user's sessions in the same transaction", async (status) => {
    const admin = await createAdmin(t.app);
    const seeker = await createSeeker(t.app);
    await signIn(t.app, seeker.email); // a second session
    const before = await testSql()`SELECT count(*)::int AS n FROM session WHERE user_id = ${seeker.id}`;
    expect(before[0]!.n).toBe(2);

    const res = await api(t.app, "PATCH", `/api/admin/users/${seeker.id}`, { cookie: admin.cookie, body: { status } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ user: { id: seeker.id, status }, sessionsRevoked: 2 });
    const after = await testSql()`SELECT count(*)::int AS n FROM session WHERE user_id = ${seeker.id}`;
    expect(after[0]!.n).toBe(0);

    expect((await api(t.app, "GET", "/api/users/me", { cookie: seeker.cookie })).status).toBe(401);
    expect((await signIn(t.app, seeker.email)).status).toBe(403);

    const reactivate = await api(t.app, "PATCH", `/api/admin/users/${seeker.id}`, { cookie: admin.cookie, body: { status: "ACTIVE" } });
    expect(reactivate.body.data.user.status).toBe("ACTIVE");
    expect((await signIn(t.app, seeker.email)).status).toBe(200);
  });

  it("cannot target themselves or another ADMIN (403 CANNOT_MODIFY_ADMIN)", async () => {
    const admin = await createAdmin(t.app);
    const other = await createAdmin(t.app);
    for (const target of [admin, other]) {
      const res = await api(t.app, "PATCH", `/api/admin/users/${target.id}`, { cookie: admin.cookie, body: { status: "BANNED" } });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CANNOT_MODIFY_ADMIN");
    }
  });

  it("role is never changeable; body is strict", async () => {
    const admin = await createAdmin(t.app);
    const seeker = await createSeeker(t.app);
    for (const body of [{ role: "ADMIN" }, { status: "ACTIVE", role: "ADMIN" }, { status: "DELETED" }, {}]) {
      expect((await api(t.app, "PATCH", `/api/admin/users/${seeker.id}`, { cookie: admin.cookie, body })).status).toBe(422);
    }
    const [row] = await testSql()`SELECT role FROM "user" WHERE id = ${seeker.id}`;
    expect(row!.role).toBe("SEEKER");
    expect((await api(t.app, "PATCH", "/api/admin/users/missing", { cookie: admin.cookie, body: { status: "BANNED" } })).status).toBe(404);
  });
});

describe("admin properties", () => {
  it("lists with filters; deleted hidden unless includeDeleted=true", async () => {
    const admin = await createAdmin(t.app);
    const tenant = await createTenant(t.app);
    const other = await createTenant(t.app);
    const live = await createProperty(t.app, tenant);
    const gone = await createProperty(t.app, tenant);
    const rejected = await createProperty(t.app, other);
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${gone.id}`;
    await testSql()`UPDATE properties SET status = 'REJECTED' WHERE id = ${rejected.id}`;

    const ids = async (qs: string) =>
      (await api(t.app, "GET", `/api/admin/properties${qs}`, { cookie: admin.cookie })).body.data.map((p: any) => p.id).sort();
    expect(await ids("")).toEqual([live.id, rejected.id].sort());
    expect(await ids("?includeDeleted=true")).toEqual([live.id, gone.id, rejected.id].sort());
    expect(await ids("?status=REJECTED")).toEqual([rejected.id]);
    expect(await ids(`?tenantId=${tenant.id}`)).toEqual([live.id]);

    const [item] = (await api(t.app, "GET", `/api/admin/properties?status=REJECTED`, { cookie: admin.cookie })).body.data;
    expect(item.tenant).toMatchObject({ id: other.id, email: other.email, status: "ACTIVE" });
  });

  it("reject: REJECTED with reason, hidden from discovery, pending bookings rejected; restore reverses it", async () => {
    const admin = await createAdmin(t.app);
    const tenant = await createTenant(t.app);
    const seeker = await createSeeker(t.app);
    const property = await createProperty(t.app, tenant);
    const booking = await createBooking(t.app, seeker, property.id);

    expect((await api(t.app, "PATCH", `/api/admin/properties/${property.id}/reject`, { cookie: admin.cookie, body: { reason: "x" } })).status).toBe(422);
    expect((await api(t.app, "PATCH", `/api/admin/properties/${property.id}/reject`, { cookie: admin.cookie })).status).toBe(422);

    const res = await api(t.app, "PATCH", `/api/admin/properties/${property.id}/reject`, {
      cookie: admin.cookie,
      body: { reason: "Misleading photos" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      property: { status: "REJECTED", rejectionReason: "Misleading photos" },
      bookingsRejected: 1,
    });
    const [b] = await testSql()`SELECT status, decision_reason FROM bookings WHERE id = ${booking.id}`;
    expect(b).toEqual({ status: "REJECTED", decision_reason: "This listing was removed by an administrator" });
    expect((await api(t.app, "GET", "/api/properties")).body.data).toEqual([]);

    // The owner still sees it, with the reason.
    const ownerView = await api(t.app, "GET", `/api/properties/${property.id}`, { cookie: tenant.cookie });
    expect(ownerView.body.data.rejectionReason).toBe("Misleading photos");

    const restored = await api(t.app, "PATCH", `/api/admin/properties/${property.id}/restore`, { cookie: admin.cookie });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ status: "PUBLISHED", rejectionReason: null });
    expect((await api(t.app, "GET", "/api/properties")).body.data).toHaveLength(1);

    const again = await api(t.app, "PATCH", `/api/admin/properties/${property.id}/restore`, { cookie: admin.cookie });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("PROPERTY_NOT_REJECTED");
  });

  it("delete: soft delete, pending REJECTED, confirmed CANCELLED (with reason)", async () => {
    const admin = await createAdmin(t.app);
    const tenant = await createTenant(t.app);
    const [s1, s2] = [await createSeeker(t.app), await createSeeker(t.app)];
    const property = await createProperty(t.app, tenant);
    const confirmed = await createBooking(t.app, s1, property.id);
    await api(t.app, "PATCH", `/api/bookings/${confirmed.id}/confirm`, { cookie: tenant.cookie });
    // A new pending request cannot exist after confirm (property unavailable): insert one directly.
    await testSql()`INSERT INTO bookings (property_id, seeker_id) VALUES (${property.id}, ${s2.id})`;

    const res = await api(t.app, "DELETE", `/api/admin/properties/${property.id}`, { cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: property.id, bookingsRejected: 1, bookingsCancelled: 1 });
    const rows = await testSql()`SELECT status, decision_reason FROM bookings WHERE property_id = ${property.id} ORDER BY status::text`;
    expect(rows).toEqual([
      { status: "CANCELLED", decision_reason: "This listing was removed by an administrator" },
      { status: "REJECTED", decision_reason: "This listing was removed by an administrator" },
    ]);
    const [p] = await testSql()`SELECT deleted_at FROM properties WHERE id = ${property.id}`;
    expect(p!.deleted_at).not.toBeNull();
    expect((await api(t.app, "DELETE", `/api/admin/properties/${property.id}`, { cookie: admin.cookie })).status).toBe(404);
  });

  it("unknown property ids: 404; malformed ids: 422", async () => {
    const admin = await createAdmin(t.app);
    expect((await api(t.app, "PATCH", `/api/admin/properties/${randomUUID()}/restore`, { cookie: admin.cookie })).status).toBe(404);
    expect((await api(t.app, "DELETE", "/api/admin/properties/123", { cookie: admin.cookie })).status).toBe(422);
  });
});

describe("admin bookings", () => {
  it("read-only list with status/property/seeker filters", async () => {
    const admin = await createAdmin(t.app);
    const tenant = await createTenant(t.app);
    const [s1, s2] = [await createSeeker(t.app), await createSeeker(t.app)];
    const p1 = await createProperty(t.app, tenant);
    const p2 = await createProperty(t.app, tenant);
    const b1 = await createBooking(t.app, s1, p1.id);
    const b2 = await createBooking(t.app, s2, p2.id);
    await api(t.app, "PATCH", `/api/bookings/${b2.id}/reject`, { cookie: tenant.cookie });

    const ids = async (qs: string) =>
      (await api(t.app, "GET", `/api/admin/bookings${qs}`, { cookie: admin.cookie })).body.data.map((b: any) => b.id).sort();
    expect(await ids("")).toEqual([b1.id, b2.id].sort());
    expect(await ids("?status=REJECTED")).toEqual([b2.id]);
    expect(await ids(`?propertyId=${p1.id}`)).toEqual([b1.id]);
    expect(await ids(`?seekerId=${s2.id}`)).toEqual([b2.id]);
    const [item] = (await api(t.app, "GET", "/api/admin/bookings?status=PENDING", { cookie: admin.cookie })).body.data;
    expect(item.tenant.email).toBe(tenant.email);
    // Admins cannot decide bookings on a tenant's behalf.
    expect((await api(t.app, "PATCH", `/api/bookings/${b1.id}/confirm`, { cookie: admin.cookie })).status).toBe(403);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  api,
  createAdmin,
  createProperty,
  createSeeker,
  createTenant,
  createTestApp,
  setUserStatus,
  uploadImage,
  validProperty,
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

describe("POST /api/properties", () => {
  it("creates a PUBLISHED listing with numeric price (201)", async () => {
    const tenant = await createTenant(t.app);
    const res = await api(t.app, "POST", "/api/properties", { cookie: tenant.cookie, body: validProperty() });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: "PUBLISHED",
      isAvailable: true,
      priceAmount: 45000,
      tenantId: tenant.id,
      tenant: { id: tenant.id, name: "Tenant" },
      uploads: [],
      rejectionReason: null,
    });
  });

  it.each([
    ["status", { status: "REJECTED" }],
    ["tenantId", { tenantId: "someone-else" }],
    ["rejectionReason", { rejectionReason: "x" }],
    ["unknown key", { foo: 1 }],
  ])("rejects %s (422)", async (_label, extra) => {
    const tenant = await createTenant(t.app);
    const res = await api(t.app, "POST", "/api/properties", { cookie: tenant.cookie, body: validProperty(extra) });
    expect(res.status).toBe(422);
  });

  it.each([
    ["title too short", { title: "ab" }],
    ["description too short", { description: "short" }],
    ["price zero", { priceAmount: 0 }],
    ["price too large", { priceAmount: 100_000_001 }],
    ["price as string", { priceAmount: "45000" }],
    ["bedrooms fractional", { bedrooms: 1.5 }],
    ["bedrooms too many", { bedrooms: 51 }],
    ["bad type", { propertyType: "CASTLE" }],
    ["too many amenities", { amenities: Array.from({ length: 31 }, (_, i) => `a${i}`) }],
    ["amenity too long", { amenities: ["x".repeat(51)] }],
    ["address too long", { addressText: "x".repeat(256) }],
  ])("validates: %s (422 with field details)", async (_label, extra) => {
    const tenant = await createTenant(t.app);
    const res = await api(t.app, "POST", "/api/properties", { cookie: tenant.cookie, body: validProperty(extra) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it("is TENANT-only", async () => {
    const seeker = await createSeeker(t.app);
    expect((await api(t.app, "POST", "/api/properties", { cookie: seeker.cookie, body: validProperty() })).status).toBe(403);
    expect((await api(t.app, "POST", "/api/properties", { body: validProperty() })).status).toBe(401);
  });
});

describe("GET /api/properties (discovery)", () => {
  it("lists only published, non-deleted listings of ACTIVE tenants", async () => {
    const tenant = await createTenant(t.app);
    const suspended = await createTenant(t.app, "Suspended");
    const visible = await createProperty(t.app, tenant, { title: "Visible listing" });
    const rejected = await createProperty(t.app, tenant, { title: "Rejected listing" });
    const deleted = await createProperty(t.app, tenant, { title: "Deleted listing" });
    await createProperty(t.app, suspended, { title: "Suspended tenant listing" });
    await testSql()`UPDATE properties SET status = 'REJECTED' WHERE id = ${rejected.id}`;
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${deleted.id}`;
    await setUserStatus(suspended.id, "SUSPENDED");

    const res = await api(t.app, "GET", "/api/properties");
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: any) => p.id)).toEqual([visible.id]);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      [
        "id", "tenantId", "title", "propertyType", "priceAmount", "priceCurrency", "bedrooms", "bathrooms",
        "county", "area", "isAvailable", "primaryImageUrl", "createdAt",
      ].sort(),
    );
  });

  it("filters by q, county, area, type, price range, bedrooms and availability", async () => {
    const tenant = await createTenant(t.app);
    const a = await createProperty(t.app, tenant, {
      title: "Garden bedsitter", county: "Nairobi", area: "Kileleshwa", propertyType: "BEDSITTER",
      priceAmount: 15000, bedrooms: 0,
    });
    const b = await createProperty(t.app, tenant, {
      title: "Family house", county: "Mombasa", area: "Nyali", propertyType: "HOUSE", priceAmount: 120000, bedrooms: 4,
    });
    await testSql()`UPDATE properties SET is_available = false WHERE id = ${b.id}`;

    const ids = async (qs: string) => (await api(t.app, "GET", `/api/properties?${qs}`)).body.data.map((p: any) => p.id);
    expect(await ids("q=garden")).toEqual([a.id]);
    expect(await ids("q=NYALI")).toEqual([b.id]);
    expect(await ids("county=nairobi")).toEqual([a.id]);
    expect(await ids("county=Nair")).toEqual([]); // county is exact (case-insensitive)
    expect(await ids("area=lesh")).toEqual([a.id]); // area is partial
    expect(await ids("propertyType=HOUSE")).toEqual([b.id]);
    expect(await ids("minPrice=20000")).toEqual([b.id]);
    expect(await ids("maxPrice=20000")).toEqual([a.id]);
    expect(await ids("minPrice=15000&maxPrice=15000")).toEqual([a.id]);
    expect(await ids("bedrooms=4")).toEqual([b.id]);
    expect(await ids("available=false")).toEqual([b.id]);
    expect(await ids("available=true")).toEqual([a.id]);
  });

  it("escapes LIKE wildcards: q=% and q=_ match nothing", async () => {
    const tenant = await createTenant(t.app);
    await createProperty(t.app, tenant);
    for (const q of ["%", "_", "\\"]) {
      const res = await api(t.app, "GET", `/api/properties?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    }
    const literal = await createProperty(t.app, tenant, { title: "100% furnished flat" });
    const res = await api(t.app, "GET", `/api/properties?q=${encodeURIComponent("100%")}`);
    expect(res.body.data.map((p: any) => p.id)).toEqual([literal.id]);
  });

  it("validates query params (422)", async () => {
    for (const qs of [
      "minPrice=500&maxPrice=100", "page=0", "limit=51", "limit=abc", "sort=random",
      "available=yes", "propertyType=CASTLE", "bedrooms=-1",
    ]) {
      const res = await api(t.app, "GET", `/api/properties?${qs}`);
      expect(res.status, qs).toBe(422);
    }
  });

  it("sorts by price and newest, with stable pagination", async () => {
    const tenant = await createTenant(t.app);
    const created: any[] = [];
    for (const price of [30000, 10000, 20000, 20000, 50000]) {
      created.push(await createProperty(t.app, tenant, { priceAmount: price }));
    }
    // Identical created_at for all: ordering must still be deterministic (id tiebreaker).
    await testSql()`UPDATE properties SET created_at = '2026-01-01T00:00:00Z'`;

    const asc = (await api(t.app, "GET", "/api/properties?sort=price_asc")).body.data.map((p: any) => p.priceAmount);
    expect(asc).toEqual([10000, 20000, 20000, 30000, 50000]);
    const desc = (await api(t.app, "GET", "/api/properties?sort=price_desc")).body.data.map((p: any) => p.priceAmount);
    expect(desc).toEqual([50000, 30000, 20000, 20000, 10000]);

    const pages: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await api(t.app, "GET", `/api/properties?limit=2&page=${page}`);
      expect(res.body.meta).toEqual({ page, limit: 2, total: 5, totalPages: 3 });
      pages.push(...res.body.data.map((p: any) => p.id));
    }
    expect(new Set(pages).size).toBe(5);
    const expected = created.map((p) => p.id).sort().reverse();
    expect(pages).toEqual(expected);
  });

  it("returns newest first by default", async () => {
    const tenant = await createTenant(t.app);
    const older = await createProperty(t.app, tenant);
    const newer = await createProperty(t.app, tenant);
    await testSql()`UPDATE properties SET created_at = now() - interval '1 day' WHERE id = ${older.id}`;
    const ids = (await api(t.app, "GET", "/api/properties")).body.data.map((p: any) => p.id);
    expect(ids).toEqual([newer.id, older.id]);
  });

  it("includes the primary image url", async () => {
    const tenant = await createTenant(t.app);
    const property = await createProperty(t.app, tenant);
    expect((await uploadImage(t.app, tenant, property.id)).status).toBe(201);
    const [item] = (await api(t.app, "GET", "/api/properties")).body.data;
    expect(item.primaryImageUrl).toMatch(/^https:\/\/res\.cloudinary\.test\//);
  });
});

describe("GET /api/properties/me", () => {
  it("is not captured by /:id and returns the tenant's own non-deleted listings with status", async () => {
    const tenant = await createTenant(t.app);
    const other = await createTenant(t.app);
    const mine = await createProperty(t.app, tenant);
    const rejected = await createProperty(t.app, tenant);
    const deleted = await createProperty(t.app, tenant);
    await createProperty(t.app, other);
    await testSql()`UPDATE properties SET status = 'REJECTED', rejection_reason = 'Blurry photos' WHERE id = ${rejected.id}`;
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${deleted.id}`;

    const res = await api(t.app, "GET", "/api/properties/me", { cookie: tenant.cookie });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.map((p: any) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual([mine.id, rejected.id].sort());
    expect(byId[rejected.id]).toMatchObject({ status: "REJECTED", rejectionReason: "Blurry photos" });
    expect(byId[mine.id].updatedAt).toBeDefined();
    expect(res.body.meta.total).toBe(2);
  });

  it("requires TENANT", async () => {
    const seeker = await createSeeker(t.app);
    expect((await api(t.app, "GET", "/api/properties/me", { cookie: seeker.cookie })).status).toBe(403);
    expect((await api(t.app, "GET", "/api/properties/me")).status).toBe(401);
  });
});

describe("GET /api/properties/:id visibility", () => {
  it("bad ids are 422, unknown ids 404", async () => {
    expect((await api(t.app, "GET", "/api/properties/not-a-uuid")).status).toBe(422);
    const res = await api(t.app, "GET", `/api/properties/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROPERTY_NOT_FOUND");
  });

  it("published: public detail without rejectionReason, with tenant and ordered uploads", async () => {
    const tenant = await createTenant(t.app);
    const property = await createProperty(t.app, tenant);
    await uploadImage(t.app, tenant, property.id);
    await uploadImage(t.app, tenant, property.id);
    const res = await api(t.app, "GET", `/api/properties/${property.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("rejectionReason");
    expect(res.body.data).not.toHaveProperty("deletedAt");
    expect(res.body.data.tenant).toEqual({ id: tenant.id, name: "Tenant", image: null });
    expect(res.body.data.tenant).not.toHaveProperty("email");
    expect(res.body.data.uploads.map((u: any) => u.displayOrder)).toEqual([1, 2]);
    expect(res.body.data.uploads[0]).not.toHaveProperty("cloudinaryPublicId");
  });

  it("matrix: rejected, deleted and suspended-tenant listings", async () => {
    const owner = await createTenant(t.app);
    const otherTenant = await createTenant(t.app);
    const seeker = await createSeeker(t.app);
    const admin = await createAdmin(t.app);
    const rejected = await createProperty(t.app, owner);
    const deleted = await createProperty(t.app, owner);
    await testSql()`UPDATE properties SET status = 'REJECTED', rejection_reason = 'Spam' WHERE id = ${rejected.id}`;
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${deleted.id}`;

    const status = async (id: string, cookie?: string) => (await api(t.app, "GET", `/api/properties/${id}`, { cookie })).status;

    // REJECTED: owner + admin only
    expect(await status(rejected.id)).toBe(404);
    expect(await status(rejected.id, seeker.cookie)).toBe(404);
    expect(await status(rejected.id, otherTenant.cookie)).toBe(404);
    const ownerView = await api(t.app, "GET", `/api/properties/${rejected.id}`, { cookie: owner.cookie });
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data.rejectionReason).toBe("Spam");
    expect(await status(rejected.id, admin.cookie)).toBe(200);

    // deleted: admin only
    expect(await status(deleted.id, owner.cookie)).toBe(404);
    const adminView = await api(t.app, "GET", `/api/properties/${deleted.id}`, { cookie: admin.cookie });
    expect(adminView.status).toBe(200);
    expect(adminView.body.data.deletedAt).not.toBeNull();

    // suspended tenant: hidden from the public
    const live = await createProperty(t.app, otherTenant);
    await setUserStatus(otherTenant.id, "SUSPENDED");
    expect(await status(live.id)).toBe(404);
    expect(await status(live.id, admin.cookie)).toBe(200);
  });
});

describe("PATCH /api/properties/:id", () => {
  it("updates fields, keeps status, and treats an empty body as a no-op", async () => {
    const tenant = await createTenant(t.app);
    const property = await createProperty(t.app, tenant);
    const res = await api(t.app, "PATCH", `/api/properties/${property.id}`, {
      cookie: tenant.cookie,
      body: { title: "Renamed listing", priceAmount: 50000.5, bedrooms: null, isAvailable: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Renamed listing", priceAmount: 50000.5, bedrooms: null, isAvailable: false });

    const noop = await api(t.app, "PATCH", `/api/properties/${property.id}`, { cookie: tenant.cookie, body: {} });
    expect(noop.status).toBe(200);
    expect(noop.body.data.title).toBe("Renamed listing");
  });

  it("rejected listings stay editable and stay REJECTED", async () => {
    const tenant = await createTenant(t.app);
    const property = await createProperty(t.app, tenant);
    await testSql()`UPDATE properties SET status = 'REJECTED' WHERE id = ${property.id}`;
    const res = await api(t.app, "PATCH", `/api/properties/${property.id}`, { cookie: tenant.cookie, body: { title: "Fixed title" } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REJECTED");
  });

  it("rejects status / tenantId and unknown keys", async () => {
    const tenant = await createTenant(t.app);
    const property = await createProperty(t.app, tenant);
    for (const body of [{ status: "PUBLISHED" }, { tenantId: "x" }, { rejectionReason: null }, { nope: 1 }]) {
      expect((await api(t.app, "PATCH", `/api/properties/${property.id}`, { cookie: tenant.cookie, body })).status).toBe(422);
    }
  });

  it("non-owner 403, deleted 404, unknown 404", async () => {
    const owner = await createTenant(t.app);
    const other = await createTenant(t.app);
    const property = await createProperty(t.app, owner);
    const forbidden = await api(t.app, "PATCH", `/api/properties/${property.id}`, { cookie: other.cookie, body: { title: "Hijacked" } });
    expect(forbidden.status).toBe(403);
    const [row] = await testSql()`SELECT title FROM properties WHERE id = ${property.id}`;
    expect(row!.title).toBe("Modern two bedroom apartment");

    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${property.id}`;
    expect((await api(t.app, "PATCH", `/api/properties/${property.id}`, { cookie: owner.cookie, body: { title: "Again title" } })).status).toBe(404);
    expect((await api(t.app, "PATCH", `/api/properties/${randomUUID()}`, { cookie: owner.cookie, body: {} })).status).toBe(404);
  });
});

describe("DELETE /api/properties/:id", () => {
  it("soft deletes; the listing disappears from discovery and /me", async () => {
    const tenant = await createTenant(t.app);
    const property = await createProperty(t.app, tenant);
    const res = await api(t.app, "DELETE", `/api/properties/${property.id}`, { cookie: tenant.cookie });
    expect(res.status).toBe(200);
    const [row] = await testSql()`SELECT deleted_at FROM properties WHERE id = ${property.id}`;
    expect(row!.deleted_at).not.toBeNull();
    expect((await api(t.app, "GET", "/api/properties")).body.data).toEqual([]);
    expect((await api(t.app, "GET", "/api/properties/me", { cookie: tenant.cookie })).body.data).toEqual([]);
    expect((await api(t.app, "DELETE", `/api/properties/${property.id}`, { cookie: tenant.cookie })).status).toBe(404);
  });

  it("non-owner 403", async () => {
    const owner = await createTenant(t.app);
    const other = await createTenant(t.app);
    const property = await createProperty(t.app, owner);
    expect((await api(t.app, "DELETE", `/api/properties/${property.id}`, { cookie: other.cookie })).status).toBe(403);
  });
});

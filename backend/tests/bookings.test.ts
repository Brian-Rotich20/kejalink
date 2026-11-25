import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInNairobi } from "../src/lib/validation";
import {
  api,
  createAdmin,
  createBooking,
  createProperty,
  createSeeker,
  createTenant,
  createTestApp,
  setUserStatus,
  type TestApp,
  type TestUser,
} from "./helpers";
import { testSql } from "./test-db";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function scenario(): Promise<{ tenant: TestUser; seeker: TestUser; property: any }> {
  const tenant = await createTenant(t.app);
  const seeker = await createSeeker(t.app);
  const property = await createProperty(t.app, tenant);
  return { tenant, seeker, property };
}

const bookingRow = async (id: string) =>
  (await testSql()`SELECT status, decision_reason, decided_at FROM bookings WHERE id = ${id}`)[0]!;
const propertyAvailable = async (id: string) =>
  (await testSql()`SELECT is_available FROM properties WHERE id = ${id}`)[0]!.is_available as boolean;

describe("POST /api/bookings", () => {
  it("creates a PENDING request (201); tenant email hidden from the seeker", async () => {
    const { tenant, seeker, property } = await scenario();
    const res = await api(t.app, "POST", "/api/bookings", {
      cookie: seeker.cookie,
      body: { propertyId: property.id, preferredMoveInDate: shiftDate(todayInNairobi(), 30), message: "Hello" },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: "PENDING",
      message: "Hello",
      property: { id: property.id, priceAmount: 45000, isAvailable: true },
      seeker: { id: seeker.id, email: seeker.email },
      tenant: { id: tenant.id, name: "Tenant" },
    });
    expect(res.body.data.tenant).not.toHaveProperty("email");
  });

  it("validates the body", async () => {
    const { seeker, property } = await scenario();
    const bodies = [
      { propertyId: "nope" },
      { propertyId: property.id, preferredMoveInDate: "2026-02-30" },
      { propertyId: property.id, preferredMoveInDate: "01/10/2026" },
      { propertyId: property.id, message: "x".repeat(1001) },
      { propertyId: property.id, message: "   " },
      { propertyId: property.id, status: "CONFIRMED" },
    ];
    for (const body of bodies) {
      expect((await api(t.app, "POST", "/api/bookings", { cookie: seeker.cookie, body })).status).toBe(422);
    }
  });

  it("move-in date: yesterday in Africa/Nairobi is rejected, today is accepted", async () => {
    const { seeker, property } = await scenario();
    const today = todayInNairobi();
    const past = await api(t.app, "POST", "/api/bookings", {
      cookie: seeker.cookie,
      body: { propertyId: property.id, preferredMoveInDate: shiftDate(today, -1) },
    });
    expect(past.status).toBe(422);
    const ok = await api(t.app, "POST", "/api/bookings", {
      cookie: seeker.cookie,
      body: { propertyId: property.id, preferredMoveInDate: today },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.preferredMoveInDate).toBe(today);
  });

  it("only seekers can request", async () => {
    const { tenant, property } = await scenario();
    const admin = await createAdmin(t.app);
    for (const user of [tenant, admin]) {
      expect((await api(t.app, "POST", "/api/bookings", { cookie: user.cookie, body: { propertyId: property.id } })).status).toBe(403);
    }
  });

  it("duplicate pending request: 409 DUPLICATE_BOOKING (also under concurrency)", async () => {
    const { seeker, property } = await scenario();
    await createBooking(t.app, seeker, property.id);
    const dup = await api(t.app, "POST", "/api/bookings", { cookie: seeker.cookie, body: { propertyId: property.id } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_BOOKING");

    const other = await createSeeker(t.app);
    const results = await Promise.all(
      [1, 2, 3].map(() => api(t.app, "POST", "/api/bookings", { cookie: other.cookie, body: { propertyId: property.id } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    for (const r of results.filter((r) => r.status === 409)) expect(r.body.error.code).toBe("DUPLICATE_BOOKING");
  });

  it("unavailable property: 409 PROPERTY_NOT_AVAILABLE", async () => {
    const { seeker, property } = await scenario();
    await testSql()`UPDATE properties SET is_available = false WHERE id = ${property.id}`;
    const res = await api(t.app, "POST", "/api/bookings", { cookie: seeker.cookie, body: { propertyId: property.id } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROPERTY_NOT_AVAILABLE");
  });

  it("deleted, rejected, suspended-tenant or unknown property: 404", async () => {
    const { tenant, seeker, property } = await scenario();
    const rejected = await createProperty(t.app, tenant);
    const deleted = await createProperty(t.app, tenant);
    await testSql()`UPDATE properties SET status = 'REJECTED' WHERE id = ${rejected.id}`;
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${deleted.id}`;
    for (const id of [rejected.id, deleted.id, randomUUID()]) {
      const res = await api(t.app, "POST", "/api/bookings", { cookie: seeker.cookie, body: { propertyId: id } });
      expect(res.status).toBe(404);
    }
    await setUserStatus(tenant.id, "SUSPENDED");
    expect((await api(t.app, "POST", "/api/bookings", { cookie: seeker.cookie, body: { propertyId: property.id } })).status).toBe(404);
  });

  it("cannot request your own property (403)", async () => {
    const { tenant, property } = await scenario();
    // Only reachable if a lister's role changes; guarded anyway.
    await testSql()`UPDATE "user" SET role = 'SEEKER' WHERE id = ${tenant.id}`;
    const res = await api(t.app, "POST", "/api/bookings", { cookie: tenant.cookie, body: { propertyId: property.id } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("OWN_PROPERTY");
  });

  it("can re-request after a rejection", async () => {
    const { tenant, seeker, property } = await scenario();
    const first = await createBooking(t.app, seeker, property.id);
    await api(t.app, "PATCH", `/api/bookings/${first.id}/reject`, { cookie: tenant.cookie });
    expect((await api(t.app, "POST", "/api/bookings", { cookie: seeker.cookie, body: { propertyId: property.id } })).status).toBe(201);
  });
});

describe("listing and reading bookings", () => {
  it("/me and /received are scoped, filterable and paginated", async () => {
    const { tenant, seeker, property } = await scenario();
    const otherTenant = await createTenant(t.app);
    const otherProperty = await createProperty(t.app, otherTenant);
    const otherSeeker = await createSeeker(t.app);
    const b1 = await createBooking(t.app, seeker, property.id);
    const b2 = await createBooking(t.app, seeker, otherProperty.id);
    const b3 = await createBooking(t.app, otherSeeker, property.id);
    await api(t.app, "PATCH", `/api/bookings/${b3.id}/reject`, { cookie: tenant.cookie });

    const mine = await api(t.app, "GET", "/api/bookings/me", { cookie: seeker.cookie });
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((b: any) => b.id).sort()).toEqual([b1.id, b2.id].sort());
    expect(mine.body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });

    const received = await api(t.app, "GET", "/api/bookings/received", { cookie: tenant.cookie });
    expect(received.body.data.map((b: any) => b.id).sort()).toEqual([b1.id, b3.id].sort());
    expect(received.body.data[0].seeker).toHaveProperty("email");

    const rejected = await api(t.app, "GET", "/api/bookings/received?status=REJECTED", { cookie: tenant.cookie });
    expect(rejected.body.data.map((b: any) => b.id)).toEqual([b3.id]);

    const paged = await api(t.app, "GET", "/api/bookings/me?limit=1&page=2", { cookie: seeker.cookie });
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });

    expect((await api(t.app, "GET", "/api/bookings/received", { cookie: seeker.cookie })).status).toBe(403);
    expect((await api(t.app, "GET", "/api/bookings/me", { cookie: tenant.cookie })).status).toBe(403);
    expect((await api(t.app, "GET", "/api/bookings/me?status=NOPE", { cookie: seeker.cookie })).status).toBe(422);
  });

  it("GET /:id: participants and admin only; others get 404 BOOKING_NOT_FOUND", async () => {
    const { tenant, seeker, property } = await scenario();
    const booking = await createBooking(t.app, seeker, property.id);
    const admin = await createAdmin(t.app);
    const strangerSeeker = await createSeeker(t.app);
    const strangerTenant = await createTenant(t.app);

    for (const user of [seeker, tenant, admin]) {
      expect((await api(t.app, "GET", `/api/bookings/${booking.id}`, { cookie: user.cookie })).status).toBe(200);
    }
    for (const user of [strangerSeeker, strangerTenant]) {
      const res = await api(t.app, "GET", `/api/bookings/${booking.id}`, { cookie: user.cookie });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("BOOKING_NOT_FOUND");
    }
    expect((await api(t.app, "GET", `/api/bookings/${booking.id}`)).status).toBe(401);
    expect((await api(t.app, "GET", "/api/bookings/not-a-uuid", { cookie: seeker.cookie })).status).toBe(422);
  });

  it("tenant email: visible to the seeker only once CONFIRMED; always to tenant and admin", async () => {
    const { tenant, seeker, property } = await scenario();
    const admin = await createAdmin(t.app);
    const booking = await createBooking(t.app, seeker, property.id);
    const view = async (user: TestUser) => (await api(t.app, "GET", `/api/bookings/${booking.id}`, { cookie: user.cookie })).body.data;

    expect((await view(seeker)).tenant.email).toBeUndefined();
    expect((await view(tenant)).tenant.email).toBe(tenant.email);
    expect((await view(admin)).tenant.email).toBe(tenant.email);

    await api(t.app, "PATCH", `/api/bookings/${booking.id}/confirm`, { cookie: tenant.cookie });
    expect((await view(seeker)).tenant.email).toBe(tenant.email);
  });
});

describe("confirm / reject / cancel", () => {
  it("confirm: CONFIRMED, other pending rejected, property unavailable", async () => {
    const { tenant, seeker, property } = await scenario();
    const other = await createSeeker(t.app);
    const winner = await createBooking(t.app, seeker, property.id);
    const loser = await createBooking(t.app, other, property.id);

    const res = await api(t.app, "PATCH", `/api/bookings/${winner.id}/confirm`, { cookie: tenant.cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CONFIRMED");
    expect(res.body.data.decidedAt).not.toBeNull();
    expect(await bookingRow(loser.id)).toMatchObject({
      status: "REJECTED",
      decision_reason: "Another request for this property was accepted",
    });
    expect(await propertyAvailable(property.id)).toBe(false);

    const again = await api(t.app, "PATCH", `/api/bookings/${winner.id}/confirm`, { cookie: tenant.cookie });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("BOOKING_NOT_PENDING");
  });

  it("confirm on an unavailable property: 409 PROPERTY_NOT_AVAILABLE", async () => {
    const { tenant, seeker, property } = await scenario();
    const booking = await createBooking(t.app, seeker, property.id);
    await testSql()`UPDATE properties SET is_available = false WHERE id = ${property.id}`;
    const res = await api(t.app, "PATCH", `/api/bookings/${booking.id}/confirm`, { cookie: tenant.cookie });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROPERTY_NOT_AVAILABLE");
  });

  it("two concurrent confirms on different bookings of one property: exactly one wins", async () => {
    const { tenant, seeker, property } = await scenario();
    const other = await createSeeker(t.app);
    const a = await createBooking(t.app, seeker, property.id);
    const b = await createBooking(t.app, other, property.id);

    const results = await Promise.all(
      [a, b].map((booking) => api(t.app, "PATCH", `/api/bookings/${booking.id}/confirm`, { cookie: tenant.cookie })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [confirmed] = await testSql()`SELECT count(*)::int AS n FROM bookings WHERE property_id = ${property.id} AND status = 'CONFIRMED'`;
    expect(confirmed!.n).toBe(1);
  });

  it("DB backstop: a second CONFIRMED booking for a property violates the unique index", async () => {
    const { seeker, property } = await scenario();
    const other = await createSeeker(t.app);
    await testSql()`INSERT INTO bookings (property_id, seeker_id, status) VALUES (${property.id}, ${seeker.id}, 'CONFIRMED')`;
    await expect(
      testSql()`INSERT INTO bookings (property_id, seeker_id, status) VALUES (${property.id}, ${other.id}, 'CONFIRMED')`,
    ).rejects.toThrow(/bookings_one_confirmed_per_property_idx/);
  });

  it("only the owning tenant decides; others get 404, seekers 403", async () => {
    const { seeker, property } = await scenario();
    const booking = await createBooking(t.app, seeker, property.id);
    const otherTenant = await createTenant(t.app);
    for (const action of ["confirm", "reject"]) {
      const res = await api(t.app, "PATCH", `/api/bookings/${booking.id}/${action}`, { cookie: otherTenant.cookie });
      expect(res.status).toBe(404);
      expect((await api(t.app, "PATCH", `/api/bookings/${booking.id}/${action}`, { cookie: seeker.cookie })).status).toBe(403);
    }
    expect((await bookingRow(booking.id)).status).toBe("PENDING");
  });

  it("reject: with no body, with a JSON null body, or with a reason; only PENDING", async () => {
    const { tenant, property } = await scenario();
    const seekers = await Promise.all([1, 2, 3].map(() => createSeeker(t.app)));
    const [a, b, c] = await Promise.all(seekers.map((s) => createBooking(t.app, s, property.id)));

    expect((await api(t.app, "PATCH", `/api/bookings/${a.id}/reject`, { cookie: tenant.cookie })).status).toBe(200);
    const nullBody = await api(t.app, "PATCH", `/api/bookings/${b.id}/reject`, {
      cookie: tenant.cookie,
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(nullBody.status).toBe(200);
    const withReason = await api(t.app, "PATCH", `/api/bookings/${c.id}/reject`, {
      cookie: tenant.cookie,
      body: { reason: "Already let to family" },
    });
    expect(withReason.status).toBe(200);
    expect(withReason.body.data).toMatchObject({ status: "REJECTED", decisionReason: "Already let to family" });
    expect(await propertyAvailable(property.id)).toBe(true);

    const again = await api(t.app, "PATCH", `/api/bookings/${c.id}/reject`, { cookie: tenant.cookie });
    expect(again.status).toBe(409);
    expect((await api(t.app, "PATCH", `/api/bookings/${a.id}/reject`, { cookie: tenant.cookie, body: { extra: 1 } })).status).toBe(422);
  });

  it("cancel: PENDING and CONFIRMED only; cancelling CONFIRMED restores availability", async () => {
    const { tenant, seeker, property } = await scenario();
    const pending = await createBooking(t.app, seeker, property.id);
    const res = await api(t.app, "PATCH", `/api/bookings/${pending.id}/cancel`, { cookie: seeker.cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");

    const second = await createBooking(t.app, seeker, property.id);
    await api(t.app, "PATCH", `/api/bookings/${second.id}/confirm`, { cookie: tenant.cookie });
    expect(await propertyAvailable(property.id)).toBe(false);
    expect((await api(t.app, "PATCH", `/api/bookings/${second.id}/cancel`, { cookie: seeker.cookie })).status).toBe(200);
    expect(await propertyAvailable(property.id)).toBe(true);

    const notCancellable = await api(t.app, "PATCH", `/api/bookings/${second.id}/cancel`, { cookie: seeker.cookie });
    expect(notCancellable.status).toBe(409);
    expect(notCancellable.body.error.code).toBe("BOOKING_NOT_CANCELLABLE");
  });

  it("cancel: other seekers get 404, tenants cannot cancel (403)", async () => {
    const { tenant, seeker, property } = await scenario();
    const booking = await createBooking(t.app, seeker, property.id);
    const other = await createSeeker(t.app);
    expect((await api(t.app, "PATCH", `/api/bookings/${booking.id}/cancel`, { cookie: other.cookie })).status).toBe(404);
    expect((await api(t.app, "PATCH", `/api/bookings/${booking.id}/cancel`, { cookie: tenant.cookie })).status).toBe(403);
  });
});

describe("property interactions", () => {
  it("re-opening availability while a CONFIRMED booking exists: 409 PROPERTY_HAS_CONFIRMED_BOOKING", async () => {
    const { tenant, seeker, property } = await scenario();
    const booking = await createBooking(t.app, seeker, property.id);
    await api(t.app, "PATCH", `/api/bookings/${booking.id}/confirm`, { cookie: tenant.cookie });
    const res = await api(t.app, "PATCH", `/api/properties/${property.id}`, { cookie: tenant.cookie, body: { isAvailable: true } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROPERTY_HAS_CONFIRMED_BOOKING");
    // Other edits are still allowed.
    expect((await api(t.app, "PATCH", `/api/properties/${property.id}`, { cookie: tenant.cookie, body: { title: "Still mine" } })).status).toBe(200);
  });

  it("deleting with a CONFIRMED booking: 409; with PENDING ones: they are rejected", async () => {
    const { tenant, seeker, property } = await scenario();
    const pending = await createBooking(t.app, seeker, property.id);
    const res = await api(t.app, "DELETE", `/api/properties/${property.id}`, { cookie: tenant.cookie });
    expect(res.status).toBe(200);
    expect(await bookingRow(pending.id)).toMatchObject({
      status: "REJECTED",
      decision_reason: "This listing was removed by the owner",
    });

    const second = await createProperty(t.app, tenant);
    const confirmed = await createBooking(t.app, seeker, second.id);
    await api(t.app, "PATCH", `/api/bookings/${confirmed.id}/confirm`, { cookie: tenant.cookie });
    const blocked = await api(t.app, "DELETE", `/api/properties/${second.id}`, { cookie: tenant.cookie });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("PROPERTY_HAS_CONFIRMED_BOOKING");
  });

  it("a booking on a deleted listing can no longer be confirmed", async () => {
    const { tenant, seeker, property } = await scenario();
    const booking = await createBooking(t.app, seeker, property.id);
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${property.id}`;
    const res = await api(t.app, "PATCH", `/api/bookings/${booking.id}/confirm`, { cookie: tenant.cookie });
    expect(res.status).toBe(409);
  });
});

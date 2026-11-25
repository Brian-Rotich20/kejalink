import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createProperty,
  createSeeker,
  createTenant,
  createTestApp,
  IMAGES,
  multipart,
  uploadImage,
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
beforeEach(() => {
  t.storage.assets.clear();
  t.storage.deleted.length = 0;
  t.storage.failUploads = false;
  t.storage.uploadDelayMs = 0;
});

const rows = (propertyId: string) =>
  testSql()`SELECT id, is_primary, display_order, cloudinary_public_id FROM uploads WHERE property_id = ${propertyId} ORDER BY display_order, created_at`;

async function setup(): Promise<{ tenant: TestUser; property: any }> {
  const tenant = await createTenant(t.app);
  const property = await createProperty(t.app, tenant);
  return { tenant, property };
}

describe("POST /api/properties/:id/uploads", () => {
  it.each([
    ["jpeg", IMAGES.jpeg, "image/jpeg"],
    ["png", IMAGES.png, "image/png"],
    ["webp", IMAGES.webp, "image/webp"],
  ])("accepts %s", async (_name, buffer, contentType) => {
    const { tenant, property } = await setup();
    const res = await uploadImage(t.app, tenant, property.id, { buffer, contentType });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ isPrimary: true, displayOrder: 1 });
    expect(res.body.data).not.toHaveProperty("cloudinaryPublicId");
    expect(res.body.data).not.toHaveProperty("publicId");
    const [stored] = [...t.storage.assets.keys()];
    expect(stored).toMatch(new RegExp(`^kejalink/properties/${property.id}/`));
  });

  it("first upload is primary; later ones are not and get displayOrder max+1", async () => {
    const { tenant, property } = await setup();
    await uploadImage(t.app, tenant, property.id);
    const second = await uploadImage(t.app, tenant, property.id, { buffer: IMAGES.png, contentType: "image/png" });
    expect(second.body.data).toMatchObject({ isPrimary: false, displayOrder: 2 });
  });

  it.each([
    ["text declared as jpeg", IMAGES.text, "image/jpeg"],
    ["gif", IMAGES.gif, "image/gif"],
    ["gif declared as png", IMAGES.gif, "image/png"],
    ["png declared as jpeg (mismatch)", IMAGES.png, "image/jpeg"],
  ])("rejects %s with 415 and stores nothing", async (_label, buffer, contentType) => {
    const { tenant, property } = await setup();
    const res = await uploadImage(t.app, tenant, property.id, { buffer, contentType, filename: "x.jpg" });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(t.storage.assets.size).toBe(0);
    expect(await rows(property.id)).toHaveLength(0);
  });

  it("rejects files over 5 MB with 413 PAYLOAD_TOO_LARGE", async () => {
    const { tenant, property } = await setup();
    const big = Buffer.concat([IMAGES.jpeg, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await uploadImage(t.app, tenant, property.id, { buffer: big, contentType: "image/jpeg" });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(t.storage.assets.size).toBe(0);
  });

  it("requires the `file` field and a multipart body", async () => {
    const { tenant, property } = await setup();
    const wrongField = await uploadImage(t.app, tenant, property.id, {
      buffer: IMAGES.jpeg,
      contentType: "image/jpeg",
      field: "image",
    });
    expect(wrongField.status).toBe(422);
    const json = await api(t.app, "POST", `/api/properties/${property.id}/uploads`, { cookie: tenant.cookie, body: { url: "x" } });
    expect(json.status).toBe(415);
  });

  it("refuses an 11th image (409 UPLOAD_LIMIT_REACHED)", async () => {
    const { tenant, property } = await setup();
    for (let i = 0; i < 10; i++) expect((await uploadImage(t.app, tenant, property.id)).status).toBe(201);
    const res = await uploadImage(t.app, tenant, property.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("UPLOAD_LIMIT_REACHED");
    expect(t.storage.assets.size).toBe(10);
  });

  it("returns 502 UPLOAD_FAILED when storage fails, with no DB row", async () => {
    const { tenant, property } = await setup();
    t.storage.failUploads = true;
    const res = await uploadImage(t.app, tenant, property.id);
    expect(res.status).toBe(502);
    expect(res.body.error).toEqual({ code: "UPLOAD_FAILED", message: "Image upload failed, please try again", details: null });
    expect(await rows(property.id)).toHaveLength(0);
  });

  it("ownership: other tenant 403, seeker 403, deleted or unknown property 404; storage untouched", async () => {
    const { property } = await setup();
    const other = await createTenant(t.app);
    const seeker = await createSeeker(t.app);
    expect((await uploadImage(t.app, other, property.id)).status).toBe(403);
    expect((await uploadImage(t.app, seeker, property.id)).status).toBe(403);
    expect((await uploadImage(t.app, other, randomUUID())).status).toBe(404);
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${property.id}`;
    const { tenant: owner } = { tenant: other };
    expect((await uploadImage(t.app, owner, property.id)).status).toBe(404);
    expect(t.storage.assets.size).toBe(0);
  });

  it("soft-deleted property: owner gets 404", async () => {
    const { tenant, property } = await setup();
    await testSql()`UPDATE properties SET deleted_at = now() WHERE id = ${property.id}`;
    expect((await uploadImage(t.app, tenant, property.id)).status).toBe(404);
  });

  it("three concurrent uploads at 9 images: exactly one succeeds, no orphaned remote assets", async () => {
    const { tenant, property } = await setup();
    for (let i = 0; i < 9; i++) {
      await testSql()`INSERT INTO uploads (property_id, cloudinary_public_id, url, is_primary, display_order)
        VALUES (${property.id}, ${`seed/${randomUUID()}`}, 'https://res.cloudinary.test/seed.jpg', ${i === 0}, ${i + 1})`;
    }
    // Make all three pass the early limit check before any of them commits.
    t.storage.uploadDelayMs = 200;
    const results = await Promise.all([1, 2, 3].map(() => uploadImage(t.app, tenant, property.id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(await rows(property.id)).toHaveLength(10);
    expect(t.storage.assets.size).toBe(1); // the two losers' remote assets were deleted
    expect(t.storage.deleted).toHaveLength(2);
  });
});

describe("PATCH /api/properties/:id/uploads/:uploadId", () => {
  it("switches the primary image (exactly one primary)", async () => {
    const { tenant, property } = await setup();
    const first = (await uploadImage(t.app, tenant, property.id)).body.data;
    const second = (await uploadImage(t.app, tenant, property.id)).body.data;
    const res = await api(t.app, "PATCH", `/api/properties/${property.id}/uploads/${second.id}`, {
      cookie: tenant.cookie,
      body: { isPrimary: true, displayOrder: 0 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: second.id, isPrimary: true, displayOrder: 0 });
    const all = await rows(property.id);
    expect(all.filter((r) => r.is_primary).map((r) => r.id)).toEqual([second.id]);
    expect(all.find((r) => r.id === first.id)!.is_primary).toBe(false);

    const detail = await api(t.app, "GET", `/api/properties/${property.id}`);
    expect(detail.body.data.uploads.map((u: any) => u.id)).toEqual([second.id, first.id]);
  });

  it("validates the body strictly", async () => {
    const { tenant, property } = await setup();
    const upload = (await uploadImage(t.app, tenant, property.id)).body.data;
    for (const body of [{ isPrimary: false }, { displayOrder: 1001 }, { displayOrder: -1 }, { url: "https://x" }]) {
      const res = await api(t.app, "PATCH", `/api/properties/${property.id}/uploads/${upload.id}`, { cookie: tenant.cookie, body });
      expect(res.status).toBe(422);
    }
  });

  it("404 when the upload belongs to another property; 403 for non-owners", async () => {
    const { tenant, property } = await setup();
    const otherProperty = await createProperty(t.app, tenant);
    const upload = (await uploadImage(t.app, tenant, otherProperty.id)).body.data;
    const res = await api(t.app, "PATCH", `/api/properties/${property.id}/uploads/${upload.id}`, {
      cookie: tenant.cookie,
      body: { isPrimary: true },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UPLOAD_NOT_FOUND");

    const stranger = await createTenant(t.app);
    const forbidden = await api(t.app, "PATCH", `/api/properties/${otherProperty.id}/uploads/${upload.id}`, {
      cookie: stranger.cookie,
      body: { displayOrder: 5 },
    });
    expect(forbidden.status).toBe(403);
  });
});

describe("DELETE /api/properties/:id/uploads/:uploadId", () => {
  it("deleting the primary promotes the lowest displayOrder and deletes the remote asset", async () => {
    const { tenant, property } = await setup();
    const a = (await uploadImage(t.app, tenant, property.id)).body.data;
    const b = (await uploadImage(t.app, tenant, property.id)).body.data;
    const c = (await uploadImage(t.app, tenant, property.id)).body.data;
    await testSql()`UPDATE uploads SET display_order = 9 WHERE id = ${b.id}`;

    const res = await api(t.app, "DELETE", `/api/properties/${property.id}/uploads/${a.id}`, { cookie: tenant.cookie });
    expect(res.status).toBe(200);
    const remaining = await rows(property.id);
    expect(remaining.map((r) => r.id)).toEqual([c.id, b.id]);
    expect(remaining.find((r) => r.id === c.id)!.is_primary).toBe(true);
    expect(t.storage.deleted).toHaveLength(1);
    expect(t.storage.assets.size).toBe(2);
  });

  it("deleting a non-primary keeps the primary", async () => {
    const { tenant, property } = await setup();
    const a = (await uploadImage(t.app, tenant, property.id)).body.data;
    const b = (await uploadImage(t.app, tenant, property.id)).body.data;
    await api(t.app, "DELETE", `/api/properties/${property.id}/uploads/${b.id}`, { cookie: tenant.cookie });
    const remaining = await rows(property.id);
    expect(remaining.map((r) => [r.id, r.is_primary])).toEqual([[a.id, true]]);
  });

  it("other tenants get 403 and nothing is deleted", async () => {
    const { tenant, property } = await setup();
    const a = (await uploadImage(t.app, tenant, property.id)).body.data;
    const other = await createTenant(t.app);
    const res = await api(t.app, "DELETE", `/api/properties/${property.id}/uploads/${a.id}`, { cookie: other.cookie });
    expect(res.status).toBe(403);
    expect(await rows(property.id)).toHaveLength(1);
    expect(t.storage.deleted).toHaveLength(0);
  });

  it("unknown upload 404", async () => {
    const { tenant, property } = await setup();
    const res = await api(t.app, "DELETE", `/api/properties/${property.id}/uploads/${randomUUID()}`, { cookie: tenant.cookie });
    expect(res.status).toBe(404);
  });

  it("multipart helper sanity: boundary is well-formed", () => {
    const { headers } = multipart({ buffer: IMAGES.jpeg, contentType: "image/jpeg" });
    expect(headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  });
});

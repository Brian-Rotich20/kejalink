import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ImageStorage, StoredImage } from "../src/modules/uploads/upload.storage";
import { testSql } from "./test-db";

export const ORIGIN = "http://localhost:3000";

// ── Fake image host ──────────────────────────────────────────────────────────

export class FakeImageStorage implements ImageStorage {
  /** Assets currently stored "remotely". */
  readonly assets = new Map<string, number>();
  readonly deleted: string[] = [];
  failUploads = false;
  uploadDelayMs = 0;

  async upload(buffer: Buffer, { folder }: { folder: string }): Promise<StoredImage> {
    if (this.uploadDelayMs) await new Promise((r) => setTimeout(r, this.uploadDelayMs));
    if (this.failUploads) throw new Error("fake upload failure");
    const publicId = `${folder}/${randomUUID()}`;
    this.assets.set(publicId, buffer.length);
    return { publicId, url: `https://res.cloudinary.test/${publicId}.jpg` };
  }

  async delete(publicId: string): Promise<void> {
    this.deleted.push(publicId);
    this.assets.delete(publicId);
  }
}

// ── App ──────────────────────────────────────────────────────────────────────

export type TestApp = { app: FastifyInstance; storage: FakeImageStorage };

/**
 * Build the app with a fake image host. App modules are imported dynamically so
 * a test file can override process.env at its top level first.
 */
export async function createTestApp(
  options: { rateLimitMax?: number; beforeReady?: (app: FastifyInstance) => void } = {},
): Promise<TestApp> {
  const { buildApp } = await import("../src/app");
  const { setImageStorage } = await import("../src/modules/uploads/upload.storage");
  const storage = new FakeImageStorage();
  setImageStorage(storage);
  const app = (await buildApp({ rateLimitMax: options.rateLimitMax ?? 100_000 })) as unknown as FastifyInstance;
  options.beforeReady?.(app);
  await app.ready();
  return { app, storage };
}

export type ApiResponse<T = any> = {
  status: number;
  body: T;
  headers: Record<string, string | string[] | number | undefined>;
  raw: string;
};

type RequestOptions = {
  cookie?: string | undefined;
  body?: unknown;
  headers?: Record<string, string>;
  /** Send no Origin header (defaults to the trusted frontend origin). */
  noOrigin?: boolean;
  payload?: Buffer | string;
};

export async function api<T = any>(
  app: FastifyInstance,
  method: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD",
  url: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(options.noOrigin ? {} : { origin: ORIGIN }), ...options.headers };
  if (options.cookie) headers.cookie = options.cookie;

  let payload: string | Buffer | undefined = options.payload;
  if (payload === undefined && options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers["content-type"] ??= "application/json";
  }

  const res = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  let body: unknown = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body: body as T, headers: res.headers, raw: res.body };
}

// ── Users ────────────────────────────────────────────────────────────────────

let counter = 0;
export const uniqueEmail = (prefix = "user") => `${prefix}.${Date.now()}.${++counter}@example.test`;

export type TestUser = { id: string; email: string; name: string; cookie: string; role: string };

export function sessionCookieFrom(res: ApiResponse): string {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const session = cookies.find((c) => c.includes("better-auth.session_token="));
  if (!session) throw new Error(`No session cookie in response (status ${res.status}): ${res.raw}`);
  return session.split(";", 1)[0]!;
}

export async function signUp(
  app: FastifyInstance,
  input: { role?: string; name?: string; email?: string; password?: string; extra?: Record<string, unknown> } = {},
): Promise<TestUser> {
  const email = input.email ?? uniqueEmail((input.role ?? "seeker").toLowerCase());
  const name = input.name ?? "Test User";
  const res = await api(app, "POST", "/api/auth/sign-up/email", {
    body: {
      name,
      email,
      password: input.password ?? "password123",
      ...(input.role ? { role: input.role } : {}),
      ...input.extra,
    },
  });
  if (res.status !== 200) throw new Error(`sign-up failed (${res.status}): ${res.raw}`);
  return { id: res.body.user.id, email, name, cookie: sessionCookieFrom(res), role: res.body.user.role };
}

export async function signIn(app: FastifyInstance, email: string, password = "password123") {
  return api(app, "POST", "/api/auth/sign-in/email", { body: { email, password } });
}

export const createTenant = (app: FastifyInstance, name = "Tenant") => signUp(app, { role: "TENANT", name });
export const createSeeker = (app: FastifyInstance, name = "Seeker") => signUp(app, { role: "SEEKER", name });

/** Admins are never created through sign-up: sign up as SEEKER, then promote in SQL (like seed:admin). */
export async function createAdmin(app: FastifyInstance): Promise<TestUser> {
  const user = await signUp(app, { name: "Admin" });
  await testSql()`UPDATE "user" SET role = 'ADMIN' WHERE id = ${user.id}`;
  return { ...user, role: "ADMIN" };
}

export async function setUserStatus(userId: string, status: string) {
  await testSql()`UPDATE "user" SET status = ${status} WHERE id = ${userId}`;
}

// ── Properties ───────────────────────────────────────────────────────────────

export const validProperty = (overrides: Record<string, unknown> = {}) => ({
  title: "Modern two bedroom apartment",
  description: "Bright apartment close to shops, schools and public transport.",
  propertyType: "APARTMENT",
  priceAmount: 45000,
  bedrooms: 2,
  bathrooms: 1,
  county: "Nairobi",
  area: "Kilimani",
  addressText: "Argwings Kodhek Rd",
  amenities: ["parking", "water"],
  ...overrides,
});

export async function createProperty(
  app: FastifyInstance,
  tenant: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const res = await api(app, "POST", "/api/properties", { cookie: tenant.cookie, body: validProperty(overrides) });
  if (res.status !== 201) throw new Error(`create property failed (${res.status}): ${res.raw}`);
  return res.body.data;
}

// ── Bookings ─────────────────────────────────────────────────────────────────

export async function createBooking(
  app: FastifyInstance,
  seeker: TestUser,
  propertyId: string,
  extra: Record<string, unknown> = {},
): Promise<any> {
  const res = await api(app, "POST", "/api/bookings", { cookie: seeker.cookie, body: { propertyId, ...extra } });
  if (res.status !== 201) throw new Error(`create booking failed (${res.status}): ${res.raw}`);
  return res.body.data;
}

// ── Images & multipart ───────────────────────────────────────────────────────

const pad = (head: number[], size = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(size, 0x11)]);

export const IMAGES = {
  jpeg: pad([0xff, 0xd8, 0xff, 0xe0]),
  png: pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(64, 0x11)]),
  gif: pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  text: Buffer.from("definitely not an image"),
};

export function multipart(
  file: { buffer: Buffer; filename?: string; contentType: string; field?: string },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----kejalink${randomUUID().replaceAll("-", "")}`;
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${file.field ?? "file"}"; filename="${file.filename ?? "photo.jpg"}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), file.buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

export async function uploadImage(
  app: FastifyInstance,
  tenant: TestUser,
  propertyId: string,
  file: { buffer: Buffer; contentType: string; filename?: string; field?: string } = {
    buffer: IMAGES.jpeg,
    contentType: "image/jpeg",
  },
) {
  const { payload, headers } = multipart(file);
  return api(app, "POST", `/api/properties/${propertyId}/uploads`, { cookie: tenant.cookie, payload, headers });
}

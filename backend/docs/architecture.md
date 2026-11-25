# KejaLink: Architecture

## 1. Overview

```text
Next.js frontend ──HTTPS + session cookie──▶ reverse proxy (1 hop) ──▶ Fastify API
                                                                    │
           routes → controllers → services → Drizzle ORM → PostgreSQL
                                                                    │
                              Better Auth (auth, sessions)  ·  Cloudinary (images)
```

**Stack:** Node.js ≥ 22, TypeScript (strict), Fastify 5, Zod 4 (fastify-type-provider-zod), PostgreSQL, Drizzle ORM and drizzle-kit, Better Auth, Cloudinary, @fastify/multipart, @fastify/cors, @fastify/rate-limit, pino, Vitest.

V1 has no microservices, search engine, payments or notifications.

## 2. Authentication

Better Auth owns `user`, `session`, `account` (password hashes) and `verification`. The app adds two fields to `user`:
- `role`: `TENANT`, `SEEKER` or `ADMIN`. It is chosen at sign-up (TENANT or SEEKER only) and never editable through the API.
- `status`: `ACTIVE`, `SUSPENDED` or `BANNED`. It is server-controlled.

Both are `text NOT NULL` with CHECK constraints. There is no phone field.

- `/api/auth/*` is bridged to Better Auth (`modules/auth/auth.routes.ts`). The bridge builds the URL from `BETTER_AUTH_URL`, never from the `Host` header, and passes the client IP that Fastify resolved.
- Better Auth hooks:
  - `user.create.before` enforces the TENANT/SEEKER allow-list, validates the name and forces `ACTIVE`;
  - `user.update.before` blocks role/status changes from HTTP endpoints;
  - `session.create.before` blocks login for non-ACTIVE users.
- `/update-user` and the other unused endpoints are disabled (see api.md).
- `plugins/auth.ts` loads the session **onRequest**, and only when a session cookie is present; it skips `/api/auth/*` and `/api/health*`. It also enforces the Origin allow-list on cookie-authenticated mutations.
- Route guards are onRequest hooks, so they run before body parsing and validation:
  - `requireAuth`: a signed-in **ACTIVE** user. Non-ACTIVE users get 403 `ACCOUNT_SUSPENDED`.
  - `requireRole(...roles)`.
- Suspend or ban (admin) sets the status and deletes all of the user's sessions in one transaction.

## 3. Domain model

```text
user ─┬─ properties (tenant_id) ─┬─ uploads
      │                          └─ bookings (property_id)
      └─ bookings (seeker_id)
```

**Properties:** `status` (`PUBLISHED` or `REJECTED`) is moderation; `is_available` is occupancy; `deleted_at` is the soft delete. Listings are **published immediately on creation, with zero or more images**. An admin may reject a listing (with a reason) and later restore it. A tenant may edit a rejected listing, but its status does not change.

**Uploads:** at most 10 images per property, 5 MB each, JPEG/PNG/WebP (checked by magic bytes). They are stored in Cloudinary under `kejalink/properties/{propertyId}`, and the public id is stored but never exposed. There is exactly one primary image while any images exist.

**Bookings** are rent requests: one optional preferred move-in date and a message, with no date ranges or payments.

```text
PENDING ──confirm──▶ CONFIRMED ──cancel (seeker)──▶ CANCELLED
   │ reject (tenant/admin removal) ─▶ REJECTED
   └ cancel (seeker) ─▶ CANCELLED
```

Confirming a booking, in one transaction: the booking becomes CONFIRMED, the property's other PENDING requests are REJECTED, and `is_available` is set to false. Cancelling a CONFIRMED booking sets `is_available` back to true.

## 4. Authorization (enforced in services)

| Role | Can |
|---|---|
| TENANT | Create, edit and soft-delete own listings; manage their images; see and decide requests on own listings |
| SEEKER | Browse; create requests; see and cancel own requests |
| ADMIN | List/view users and change status (not roles, not other admins); list, reject, restore and soft-delete any listing; view all bookings (read-only) |

- Property visibility: public if PUBLISHED, live and the tenant is ACTIVE; the owner also sees REJECTED; admins see everything. Anything else is **404**.
- A booking is visible only to its seeker, the property owner and admins; anyone else gets **404**.
- Owner-only mutations on another tenant's listing return **403**.

## 5. Folder structure

```text
backend/
├── src/
│   ├── app.ts                     # buildApp(): plugins + routes (no listen)
│   ├── server.ts                  # listen, graceful shutdown
│   ├── config/
│   │   ├── env.ts                 # Zod-validated env (+ Windows IPv4-first DNS)
│   │   └── auth/better-auth.ts    # Better Auth instance and hooks
│   ├── db/
│   │   ├── client.ts              # postgres-js pool, Drizzle, Tx type
│   │   ├── schema/                # auth, enums, properties, uploads, bookings
│   │   └── migrations/            # SQL + drizzle meta
│   ├── lib/                       # errors, response, validation, db, image, logger
│   ├── plugins/                   # auth, cors, error-handler, multipart, rate-limit
│   ├── modules/
│   │   ├── auth/                  # Better Auth bridge, auth types
│   │   ├── health/
│   │   ├── users/  properties/  uploads/  bookings/  admin/
│   │   │     *.types.ts *.schema.ts *.service.ts *.controller.ts *.routes.ts
│   │   └── uploads/upload.storage.ts   # ImageStorage seam (Cloudinary)
│   ├── scripts/                   # seed-admin.ts, migrate.ts
│   └── types/fastify.d.ts         # request.user
├── tests/                         # Vitest suites + harness
├── docs/                          # api, architecture, database, requirements, AUDIT, DECISIONS
├── Dockerfile  .dockerignore  drizzle.config.ts  vitest.config.mts
└── README.md
```

## 6. Module responsibilities

- **Routes** define the method and path, the onRequest guards, and Zod schemas for params, query and body.
- **Controllers** are functional and thin: they read the request, call a service, and apply the envelope (`success` / `paginated`). They have no try/catch and no DB access. Admin controllers write the audit log line.
- **Services** hold business rules, ownership checks, transactions and locks. They take plain data, never `request` or `reply`, and select explicit columns.
- **Error handler** (`plugins/error-handler.ts`) is the single place that maps errors to responses:

| Error | Response |
|---|---|
| `AppError` | its own status and code |
| Zod validation | 422 with field `details` |
| Multipart errors | 413 / 415 |
| Known Postgres codes | 409 / 422 / 503 |
| Other Fastify 4xx | passed through |
| Anything else | generic 500, logged server-side |

## 7. Data integrity and concurrency

See [database.md](database.md). In short:
- Partial unique indexes back the booking and image rules.
- The global lock order is **property row, then booking rows**.
- Booking creation uses `FOR SHARE`; confirm, reject, cancel, property writes and uploads use `FOR UPDATE`.
- Pool sessions have statement and idle-in-transaction timeouts.

## 8. Security

- Better Auth hashes passwords and owns sessions. Cookies are HttpOnly and SameSite=Lax, and `__Secure-`/`Secure` when `BETTER_AUTH_URL` is https.
- CORS and trusted origins come from `FRONTEND_URL` (a list). Origin checks apply to every cookie-authenticated mutation.
- Every request is validated with Zod. Bodies are strict, and LIKE wildcards are escaped.
- Uploads: ownership and limit checks happen before the body is read; then magic bytes must match the declared type, the size limit is 5 MB, the limit of 10 is re-checked under the lock, and remote assets are cleaned up if the transaction fails.
- Rate limits: 100/min/IP globally and 10/min/IP on auth. `TRUST_PROXY` is a hop count, so a spoofed `X-Forwarded-For` cannot reset buckets.
- Logs go through one pino logger that redacts cookies and authorization headers. Better Auth logs keep only the message, with emails and tokens masked. Stack traces stay server-side.
- Env is validated at startup (names only in errors). There are no secrets in the repo.

## 9. Operations

- `GET /api/health` is liveness; `GET /api/health/ready` checks the DB (503 when it is down).
- Migrations run as a release step: `node dist/scripts/migrate.js` in the image, or `npm run db:migrate`. Never `push`.
- The first admin is created with `npm run seed:admin` (idempotent).
- Docker: a multi-stage image running `node dist/server.js` as a non-root user, with `TZ=UTC`.
- CI (GitHub Actions) runs on Node 22 and 24: typecheck, build, migrate, drift check, tests, and `npm audit --omit=dev --audit-level=high`.

## 10. Deferred (not in V1)

M-Pesa and payments, deposits, date-range stays, a search engine, geo search, normalised amenities, a mandatory review queue, reviews, messaging, notifications, favourites, video, email verification and password reset (these need an email sender), and cleanup of images from soft-deleted listings.

**Forward notes:**
- Payments need an idempotency-key table and webhook IP allow-listing; `TRUST_PROXY` is already correct for that.
- Notifications should be written in the same transaction as the state change (outbox pattern).
- Scaling past one instance needs a shared rate-limit store.

# KejaLink Backend: Decisions

Decisions taken while completing the backend (branch `feat/complete-backend`). Entries marked **(brief)** are fixed product decisions from the owner. The others were made during implementation and can be revisited.

## Product and domain

| ID | Decision | Notes |
|----|----------|-------|
| D-01 | **(brief)** Roles: `TENANT` lists and manages properties, `SEEKER` browses and requests, `ADMIN` is never created by public registration. There is no phone field. | Admins are created with `npm run seed:admin` or by SQL. |
| D-02 | **(brief)** Better Auth owns `user`, `session`, `account` and `verification`. `role` and `status` are extra user fields. Email verification is off in V1. | |
| D-03 | **(brief)** `user.role` and `user.status` are `text NOT NULL` with CHECK constraints, not Postgres enums. | This survives Better Auth schema regeneration. The orphaned `user_role` and `user_status` enum types were dropped in migration 0002. |
| D-04 | **(brief)** Property status is only `PUBLISHED` or `REJECTED`. Listings go live immediately, even with zero images. Delete is a soft delete (`deleted_at`). Occupancy is a separate `is_available` flag. There is no unpublish, draft or archive. | The admin "undo" for a rejection is `PATCH /api/admin/properties/:id/restore`. |
| D-05 | **(brief)** A booking is a rent request with one optional preferred move-in date. There are no date ranges and no payments. | |
| D-06 | **(brief)** A suspended or banned user with a live session gets **403 `ACCOUNT_SUSPENDED`** on protected routes. | On public routes such a user is treated as anonymous. Admin suspend/ban also deletes all of the user's sessions in the same transaction, so in practice the cookie stops working at once. |
| D-07 | **(brief)** Better Auth's native endpoints and native error format are kept under `/api/auth/*`. Registration sends `role`. Every other route uses the app envelope. The 500 error code is `INTERNAL_SERVER_ERROR`. | Fixes AUDIT M6 by documenting the contract instead of wrapping it. |
| D-08 | **(brief)** Uploads go to Cloudinary through server-side multipart. Production runs with `TZ=UTC`. There is one reverse-proxy hop in production. | |
| D-09 | Admin rejection rejects the property's PENDING bookings and **keeps CONFIRMED bookings**, because the agreement between tenant and seeker stands. Re-rejecting an already rejected listing is allowed and updates the reason. Admin delete rejects PENDING bookings and **cancels** CONFIRMED ones, with a reason. | |
| D-10 | Admins cannot change their own status or another admin's (403 `CANNOT_MODIFY_ADMIN`). No API changes roles. | |
| D-11 | `GET /api/bookings/received` includes bookings on the tenant's soft-deleted listings, so the history stays visible. The tenant sees seeker contact details (email) on their own bookings. The seeker sees the tenant's email only once a booking is `CONFIRMED`. | Follows the privacy rule in requirements §7. |
| D-12 | Cancelling a booking does not set `decided_at`, which records the tenant's or admin's decision. `updated_at` records the cancellation. | |
| D-13 | Images of soft-deleted listings are **kept** in Cloudinary and in `uploads`; no cleanup job is built. Remote deletes (after an upload transaction fails, or after `DELETE …/uploads/:id`) are best effort and logged as `orphaned asset`. | A cleanup job can be added later. |
| D-14 | Prices are numbers in the API and are rounded to 2 decimals on write (`toFixed(2)`). The maximum is 100,000,000. | |
| D-15 | An empty PATCH body is a no-op that returns the current resource (users, properties, uploads). | |
| D-16 | Upload `displayOrder` starts at 1 and is `max + 1`, capped at 1000. The first upload becomes primary. Deleting the primary promotes the image with the lowest `displayOrder` (ties broken by `created_at`, then `id`). | |

## Security

| ID | Decision | Notes |
|----|----------|-------|
| D-20 | Better Auth `/update-user` is disabled. Profile edits go only through `PATCH /api/users/me`. A `user.update.before` hook rejects role/status changes from any HTTP endpoint (context ≠ null). | Fixes AUDIT C1/M1. |
| D-21 | Other Better Auth endpoints are also disabled (they return 404) because V1 cannot use them or must not expose them: `change-email`, `delete-user`, `update-session`, `sign-in/social`, `link-social`, `unlink-account`, `get-access-token`, `refresh-token`, `send-verification-email`, `verify-email`, `request-password-reset`, `reset-password`. | Password reset needs an email sender. Re-enable it together with one. |
| D-22 | At sign-up Better Auth **silently drops** a client-supplied `status` (`input: false`), and the create hook forces `ACTIVE`. The request succeeds, but the value is never honoured. | The brief asked for "rejected"; the value is rejected, the request is not. |
| D-23 | **Origin allow-list on cookie-authenticated state-changing app routes** (POST/PATCH/DELETE carrying a session cookie): a missing or untrusted `Origin` returns 403 `INVALID_ORIGIN`. Requests without a session cookie are unaffected. | This mirrors Better Auth's own CSRF check on `/api/auth/*`. Non-browser clients that use cookies must send `Origin`. |
| D-24 | Better Auth's origin check is forced on (`advanced.disableOriginCheck: false`). | Better Auth turns it off by itself when it detects a test environment. |
| D-25 | Client IP: Fastify trusts exactly `TRUST_PROXY` hops through a trust function (`hop < TRUST_PROXY`). Fastify 5.12.8 *fails closed* on a numeric `trustProxy`, and `true` would trust spoofed `X-Forwarded-For`. The auth bridge overwrites `x-kejalink-client-ip` with `request.ip`, and Better Auth reads the IP only from that header. | The API must be reachable **only through the proxy**, and the proxy must append to (not forward) the client's `X-Forwarded-For`. |
| D-26 | Rate limits are in memory: global 100/min/IP, and `AUTH_RATE_LIMIT_MAX` (default 10/min/IP) on the `/api/auth/*` bridge and on Better Auth sign-in and sign-up. Better Auth's limiter is on in every environment. | This suits a single instance. Use a shared store (Redis, or Better Auth `storage: "database"`) when scaling out. |
| D-27 | Better Auth logs go through pino with the message only. The extra arguments, which carry SQL parameters such as emails or session tokens, are dropped, and emails and long tokens in messages are masked. The level is `warn` in production. | Fixes AUDIT M5. |
| D-28 | Request bodies are strict (unknown keys give 422). Query strings are not strict: unknown query parameters are ignored, for frontend cache-busting and tracking parameters. Known query parameters are validated and coerced. | |
| D-29 | Non-participants get 404 on bookings, and non-visible properties are 404 (never 403). Owner-only mutations on another tenant's property return 403 (`NOT_PROPERTY_OWNER`). | |

## Data and concurrency

| ID | Decision | Notes |
|----|----------|-------|
| D-30 | Global lock order is the **property row first, then booking rows**. Booking creation takes `FOR SHARE` on the property; confirm, reject, cancel, property update and delete, and upload insert take `FOR UPDATE`. | |
| D-31 | Backstops: partial unique indexes allow one PENDING booking per seeker and property, one CONFIRMED booking per property, and one primary image per property. Unique violations are mapped to domain 409s. | |
| D-32 | All timestamps are `timestamptz`. `preferred_move_in_date` is a `date` validated against today's date in **Africa/Nairobi**. The test suite runs with `TZ=Africa/Nairobi` to catch regressions. | |
| D-33 | Migrations: `npm run db:migrate` (drizzle-kit) in development and CI. The production image runs `node dist/scripts/migrate.js` (the drizzle-orm migrator; drizzle-kit is a dev dependency) as a release step. `push` is removed. | `drizzle.config.ts` imports the validated env, so migrating needs the full env, including the Cloudinary variables. |
| D-34 | `npm run auth:generate` writes to `.drizzle/auth.generated.ts`. Merge changes into `src/db/schema/auth.ts` by hand, keeping the CHECK constraints and `timestamptz`. | Root cause of AUDIT H3/M3. |

## Tooling and process

| ID | Decision | Notes |
|----|----------|-------|
| D-40 | Vitest 5 runs one shared test database with `fileParallelism: false`. Tests refuse to run unless the `TEST_DATABASE_URL` database name contains `test`. | |
| D-41 | On Windows, run `npm test` from **PowerShell or cmd** (the VS Code default). Under Git Bash, Vitest fails with "Vitest failed to find the runner". | This is an environment issue (verified with Vitest 4 and 5), not a project issue. |
| D-42 | Order of work: env hardening (spec step 8) was committed **before** the auth plugin (step 5), because the plugin's Origin check needs `FRONTEND_URL` as a list. Commit `2494f13` referenced `ServiceUnavailableError` before `9c9924d` added it, so that single commit does not compile on its own. History was not rewritten. | |
| D-44 | **Render (Docker):** Root Directory `backend`, Dockerfile Path `./Dockerfile`, health check `/api/health`. Render's pre-deploy command is paid-only, so `MIGRATE_ON_START=true` lets the container migrate at boot; a failed migration stops the boot. | The drizzle migrator is idempotent; one instance is assumed (D-26). |
| D-45 | `CROSS_SITE_COOKIES=true` sets the session cookies to `SameSite=None; Secure; Partitioned` for a frontend on another site (`onrender.com` is a public suffix). CSRF stays covered by the Origin checks (D-23, D-24). The preferred setup is a shared custom domain, which needs no flag. | It requires an https `BETTER_AUTH_URL`. |
| D-46 | Render's proxy *appends* to `X-Forwarded-For` (community reports; there is no official statement), so `TRUST_PROXY=1` is the starting point. `GET /api/admin/diagnostics/request` confirms the resolved client IP on the live service. | |
| D-43 | `.gitattributes` forces LF line endings, so migration SQL and sources do not flip to CRLF on Windows checkouts. | |

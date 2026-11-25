# KejaLink Backend — Pre-Feature Audit

**Date:** 2026-11-25
**Scope:** `backend/` at commit `a7ab40b` (branch `main`) plus uncommitted changes in `src/modules/users/*` and `src/db/client.ts`.
**Method:** Every file under `src/`, all configs and all of `docs/` were read. I ran the type-check, build, `npm audit` and `npm outdated`, and ran `drizzle-kit check` and `drizzle-kit generate` against a scratch copy of the migrations. I applied the migrations to a throwaway Postgres 17 container (`127.0.0.1:56543`, since deleted). I then ran the server against it in `development` and in `production` mode and probed it with curl. No source file was changed. `.env` values were never printed: only key names, and SHA-256 prefixes to compare history.

Labels: **VERIFIED** means reproduced live or proven from code and tool output. **SUSPECTED** means plausible but not reproduced.

---

> **Status update (2026-11-25, branch `feat/complete-backend`):** every finding below is now marked in the **Status** column of the findings table. All are Fixed except where noted. See `docs/DECISIONS.md` for decisions taken while fixing them.

## 1. Executive summary

The brief describes a backend that does not exist in this repository. There is no properties, uploads, bookings or admin code. `src/modules/properties/property.routes.ts` is empty. There is no Cloudinary or multipart dependency, no auth plugin with role guards, and no `src/lib/{validation,db,image}`. What exists is a Fastify bootstrap, a Better Auth integration, a full DB schema and migrations for all tables, an error handler and response helpers, and a users module. That users module does not compile and is not mounted. The foundations are a reasonable shape: central error envelope, partial unique indexes, CHECK constraints, a `buildApp()` factory, origin checks and secure cookies in production.

The auth layer has one critical flaw and several high-risk gaps that every remaining feature will sit on. **Any signed-up user can make themselves `ADMIN` with one request**, and suspended users keep working sessions.

**Go / no-go: NO-GO for building the remaining features now.** It becomes a GO after the short "fix before new features" list in §4, roughly 1–2 days of small changes. The escalation alone would make the admin module meaningless. Separately, the owner needs to confirm where the properties, uploads and bookings code described in the brief actually lives (see §8 Q1). Areas 3 (concurrency) and most of 1 (IDOR, uploads, LIKE handling) and 2 (N+1, pagination) could not be audited because that code is not here.

**Top 5 risks**
1. **C1 – Self-promotion to ADMIN** through Better Auth's built-in `POST /api/auth/update-user {"role":"ADMIN"}` (VERIFIED).
2. **H3 – `role`/`status` are unconstrained `text`**, and `status` is nullable. Migration 0001 replaced the enums, so any string is accepted (VERIFIED: role `SUPERUSER` stored).
3. **H4 – Suspended/banned users keep live sessions.** Nothing checks `status` after login (VERIFIED).
4. **H5 – Rate limiting is bypassable in production** with a spoofed `X-Forwarded-For` because of `trustProxy: true` (VERIFIED: 130/130 requests passed a 100/min limit).
5. **H2 – The build is broken.** The users module calls functions that don't exist and is never registered, yet `tsc` still emits `dist/` (VERIFIED).

---

## 2. Findings table

| ID | Severity | Area | Evidence | Location | Summary | Status |
|----|----------|------|--------|----------|---------|--------|
| C1 | Critical | AuthZ | VERIFIED | `src/config/auth/better-auth.ts:38-43, 54-69` | `role` has `input: true` and is only validated on create, so `/api/auth/update-user` sets any role, including ADMIN | Fixed (ac767f9, e8be598) |
| H1 | High | Scope | VERIFIED | `src/modules/properties/property.routes.ts` (empty) | Properties, uploads, bookings, admin, auth guards, Cloudinary and multipart described as built do not exist | Fixed: modules built (d021725, 450f365, 6067620, 4d68efd) |
| H2 | High | Build | VERIFIED | `src/modules/users/user.controller.ts:18,28`; `src/app.ts:34` | Type-check and build fail; users routes not registered; build emits anyway | Fixed (b3b3d5a) |
| H3 | High | DB integrity | VERIFIED | `src/db/schema/auth.ts:15-16`; `migrations/0001_boring_shiver_man.sql:14-18` | `user.role`/`user.status` are free `text`, `status` nullable; enums orphaned | Fixed (2eb2b05) |
| H4 | High | Session | VERIFIED | `src/middleware/auth.middleware.ts:4-34` | Status never checked after login; suspended users keep acting | Fixed (0a4aeb9; session deletion on suspend 4d68efd) |
| H5 | High | Rate limit | VERIFIED | `src/app.ts:17` | `trustProxy: true` trusts client `X-Forwarded-For`; both limiters bypassed | Fixed (4fc2a42) |
| H6 | High | Dependencies | VERIFIED | `package.json` | `npm audit`: 1 critical (better-auth), 1 high (zod), 6 moderate, 2 low; all fixable within ranges except drizzle-kit's esbuild | Fixed (d29d11f); dev-only drizzle-kit/esbuild moderate remains |
| M1 | Medium | Validation | VERIFIED | `src/config/auth/better-auth.ts:23-52` | Better Auth endpoints bypass app Zod rules: 500 KB `name`, `javascript:` image accepted | Fixed (ac767f9) |
| M2 | Medium | Reliability | VERIFIED | `src/db/client.ts:7-11`; `src/app.ts:32` | No query/statement timeout (requests hung >60 s with DB down); health check is shallow | Fixed (2494f13) |
| M3 | Medium | DB/time | VERIFIED | `migrations/0001…sql:1-22` | Auth timestamps lost time zone; 3 h shift when Node runs in Africa/Nairobi | Fixed (2eb2b05) |
| M4 | Medium | Perf/AuthN | VERIFIED | `src/app.ts:23` | Session lookup (3 queries) on every cookie request incl. health, 404 and `/api/auth/*`; runs as `preHandler`, not `onRequest` | Fixed (0a4aeb9) |
| M5 | Medium | Logging | VERIFIED (email) / SUSPECTED (token) | Better Auth default logger | DB errors print query params (user email) as raw multi-line console output, outside pino redaction | Fixed (9c9924d) |
| M6 | Medium | API contract | VERIFIED | `src/modules/auth/auth.routes.ts:22-28` | Auth responses bypass the `{success,error}` envelope; codes/statuses contradict `api.md` | Fixed by decision: native Better Auth format documented (docs/api.md, DECISIONS D-07) |
| M7 | Medium | Rate limit | VERIFIED | `src/plugins/rate-limit.ts:4-13` | No auth-specific limit; 100 sign-ins/min/IP in dev; Better Auth limiter is in-memory and production-only | Fixed (4fc2a42) |
| M8 | Medium | Config | VERIFIED | `src/config/env.ts:4-15`; `.env.example`; `drizzle.config.ts:9` | `.env.example` lacks `FRONTEND_URL`; `BETTER_AUTH_URL` optional; drizzle config bypasses env validation | Fixed (86eae5e) |
| M9 | Medium | DB integrity | VERIFIED (absent) | `src/db/schema/bookings.ts:40-48` | Nothing in the DB prevents two `CONFIRMED` bookings for one property | Fixed (2eb2b05 index, 9c9924d 23505 mapping) |
| L1 | Low | Ops/Sec | VERIFIED | `src/server.ts:9` | Dev server binds `0.0.0.0`; reachable on LAN interfaces | Fixed (86eae5e) |
| L2 | Low | Deps | VERIFIED | `package.json` | `dns2`, `@fastify/cookie` unused; the "IPv4-first DNS fix" from the brief does not exist | Fixed (d29d11f) |
| L3 | Low | Validation | VERIFIED | `src/modules/users/user.schema.ts:6` | `z.string().url()` accepts `javascript:` / `data:` URLs | Fixed (f0ece95) |
| L4 | Low | Correctness | SUSPECTED | `src/modules/users/user.service.ts:17-18` | `PATCH /users/me` with `{}` passes `.strict()` then Drizzle throws "No values to set", giving a 500 | Fixed (0a4aeb9): empty body returns the current profile |
| L5 | Low | Data exposure | VERIFIED | `src/modules/users/user.service.ts:8`; `user.routes.ts` | Full rows returned with no response schema; future columns leak by default | Fixed: explicit columns in every service (0a4aeb9 onwards) |
| L6 | Low | Code quality | VERIFIED | `auth.types.ts`, `user.types.ts`, `enums.ts`; `auth.middleware.ts:18-19` | Role/status types defined 3×; unchecked casts (null status typed as valid) | Fixed (2eb2b05 single source, 0a4aeb9 runtime checks) |
| L7 | Low | Tooling | VERIFIED | `package.json`, `tsconfig.json` | No tests/lint/engines; no `noEmitOnError`; `auth:generate` overwrites `schema/auth.ts` (root cause of H3/M3); `db:push` available | Fixed (b3b3d5a, d29d11f, a6000cd, c009d1c, c8a1497) |
| L8 | Low | Auth proxy | VERIFIED (code) | `src/modules/auth/auth.routes.ts:5-29` | Hand-rolled proxy: URL from `request.hostname` (X-Forwarded-Host in prod), forwards stale `content-length`, re-stringifies body | Fixed (4fc2a42) |
| I1 | Info | DB (forward) | VERIFIED | `schema/properties.ts`, `uploads.ts`, `bookings.ts` | Index/constraint gaps for queries not yet written (see §3 forward risk) | Fixed (0003 index d021725, M9 index, upload limit under lock 450f365); orphaned images of soft-deleted listings retained by design (DECISIONS D-13) |

---

## 3. Detailed findings

### C1 — Any user can promote themselves to ADMIN (Critical, VERIFIED)

**What:** `role` is declared `input: true` so sign-up can accept it. The only validation is in `databaseHooks.user.create.before`. Better Auth also exposes `POST /api/auth/update-user`, which accepts every `input: true` additional field, and no `update` hook exists. `role` is also free text (H3), so any value is accepted.

**Exploit:** Sign up as TENANT, then send one request with the session cookie and a valid Origin:
```
POST /api/auth/update-user  {"role":"ADMIN"}      -> {"status":true}
GET  /api/auth/get-session                         -> "role":"ADMIN"
POST /api/auth/update-user  {"role":"SUPERUSER"}  -> {"status":true}   (stored as-is)
```
The future admin module, and any guard based on `request.user.role`, would honour this.

**Evidence:** Live run against the throwaway DB; the final `select email, role` showed `t1@x.io|SUPERUSER`. Sign-up with `role:"ADMIN"` was correctly rejected (`Account type must be TENANT or SEEKER`), and `status` smuggling was correctly rejected (`FIELD_NOT_ALLOWED`).

**Fix (minimal, keeps "Better Auth owns the user"):**
1. Add `disabledPaths: ["/update-user"]` to the Better Auth config. Profile edits go only through the app's `PATCH /api/users/me`, which already whitelists `name`/`image` with `.strict()`. This also closes M1 for updates.
2. Defence in depth: add `databaseHooks.user.update.before` that throws if `role` or `status` is present and the call comes from an HTTP endpoint (`ctx?.path` set). Admin role/status changes then go through service code calling Drizzle directly, which does not pass through the hook.
3. Add DB constraints (H3).

**Effort:** S

### H1 — The audited feature set is not in the repository (High, VERIFIED)

**What:** The brief lists properties (CRUD, discovery, soft delete), uploads (Cloudinary, multipart), bookings (transactions, row locks), an auth plugin with guards, and `src/lib/{validation,db,image}` and `src/plugins/{auth,multipart}` as built. In this repo:
- `src/modules/properties/property.routes.ts` is 0 bytes; no other properties files.
- `src/modules/{uploads,bookings,admin}` do not exist.
- No `cloudinary` or `@fastify/multipart` in `package.json` or `node_modules`.
- The only auth "guard" is `requireAuth` in `src/middleware/auth.middleware.ts`. There is no role guard.
- `git log` (10 commits) and `git status` show nothing else; there is one branch, `main`, equal to `origin/main` at `a7ab40b`.

**Why it matters:** Concurrency and lock order, IDOR in services, upload safety, LIKE-escaping, pagination and N+1 could not be audited. Any plan built on "bookings are done" is wrong. If the code exists elsewhere (another machine, a stash, an unpushed branch), it is at risk of being lost.

**Fix:** Locate and commit that code (§8 Q1), then re-run this audit on it. Otherwise re-plan the remaining work to include those modules.

**Effort:** — (decision)

### H2 — Build and type-check fail; users module is dead code (High, VERIFIED)

**What:** `user.controller.ts:18,28` calls `userService.getUserById` / `updateUser`, but the service exports `getUserProfile` / `updateUserProfile`. `userRoutes` is never registered in `src/app.ts`, so `/api/users/me` returns 404. `tsconfig.json` has no `noEmitOnError`, so `npm run build` reports errors and still writes `dist/`, which `npm start` would run.

**Evidence:**
```
src/modules/users/user.controller.ts(18,37): error TS2339: Property 'getUserById' does not exist …
src/modules/users/user.controller.ts(28,37): error TS2339: Property 'updateUser' does not exist …
```

**Fix:** Rename the calls, register `userRoutes` under prefix `/users`, and add `"noEmitOnError": true`. Make `type-check` part of the pre-commit/CI gate.

**Effort:** S

### H3 — `role` and `status` have no database constraint (High, VERIFIED)

**What:** `0000` created `user.role user_role` and `user.status user_status NOT NULL`. `0001` (generated after `npm run auth:generate` overwrote `schema/auth.ts`) altered both to `text`, set `status` nullable, and left the `user_role`/`user_status` types orphaned. `enums.ts` still exports `UserRole`/`UserStatus` types the DB no longer enforces.

**Why:** C1 stored `SUPERUSER`. A `NULL` status is valid SQL: login correctly fails closed (verified 403), but `auth.middleware.ts:19` casts `null` to a valid status. Any future `status !== 'BANNED'` check would treat a garbage value as allowed.

**Evidence:** `\d "user"` on the migrated DB shows `role text not null default 'SEEKER'` and `status text (nullable) default 'ACTIVE'`. `drizzle-kit check` and `generate` reported no drift, so schema and migrations agree; the problem is in the schema itself.

**Fix:** Keep Better Auth's `type: "string"` and enforce at the DB. In `schema/auth.ts` either:
- use the existing pg enums (`userRoleEnum("role")`, `userStatusEnum("status").notNull()`; the Better Auth drizzle adapter reads and writes these as strings), or
- keep `text` and add `check("user_role_valid", sql\`role in ('TENANT','SEEKER','ADMIN')\`)` and `check("user_status_valid", …)` plus `.notNull()`.

Generate a migration, backfill nulls first, and stop `auth:generate` from writing straight over `schema/auth.ts` (L7).

**Effort:** S–M

### H4 — Suspended and banned users keep working sessions (High, VERIFIED)

**What:** `session.create.before` blocks new logins for non-ACTIVE users, and that works. But `authenticate` copies `status` onto `request.user` and nothing ever reads it, and `requireAuth` checks only presence. Sessions last 7 days (`expiresIn`) and refresh daily (`updateAge`).

**Evidence:** After `UPDATE "user" SET status='SUSPENDED'`, the existing cookie still returned a full session from `/api/auth/get-session`, and `POST /api/auth/update-user {"name":"still here"}` returned `{"status":true}`. A fresh sign-in returned `This account is suspended or banned`.

**Fix:**
1. In the auth guard, treat `status !== 'ACTIVE'` as unauthenticated: 401, or 403 with code `ACCOUNT_SUSPENDED`.
2. In the planned admin suspend/ban service, delete the user's rows from `session` in the same transaction as the status change.

Don't enable Better Auth `session.cookieCache` without accounting for this: a cached cookie would outlive both measures until its `maxAge`.

**Effort:** S

### H5 — `X-Forwarded-For` spoofing bypasses all rate limiting in production (High, VERIFIED)

**What:** `trustProxy: env.NODE_ENV === "production"` passes `true`, so Fastify trusts every hop and `request.ip` becomes the left-most, client-controlled `X-Forwarded-For` entry. Better Auth's own limiter reads the same header from the forwarded headers.

**Evidence (NODE_ENV=production):**
- 130 `/api/health` requests with a rotating XFF: 130 × 200. With a fixed XFF: 100 × 200 and 30 × 429.
- Wrong-password sign-ins from the same IP: `401 401 429 429 …` (Better Auth limiter). With a rotating XFF: 8 × 401, never limited.

**Fix:** Set `trustProxy` to the hop count (`1` for a single nginx/Caddy) or the proxy's IP/CIDR, via an env var such as `TRUST_PROXY`. Configure the proxy to overwrite, not append, `X-Forwarded-For`. In Better Auth, set `advanced.ipAddress.ipAddressHeaders` / `trustedProxies` to match.

**Effort:** S

### H6 — Known vulnerabilities in direct dependencies (High, VERIFIED)

`npm audit` reports 10 issues (1 critical, 1 high, 6 moderate, 2 low).

| Package | Installed | Advisory | Exploitable here? |
|---|---|---|---|
| better-auth | 1.7.5 | GHSA-r4xp-prcw-77qf, GHSA-965c-763c-88jm (sign in as another user via OAuth proxy / OAuth-state-as-magic-link), `<1.7.7` | Not in the current config (no OAuth or magic-link plugins), but trivially fixable and dangerous the moment a plugin is added |
| zod | 4.6.5 | GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized constrained collections), `<4.6.6` | Yes once `amenities: z.array(...)` and similar arrays exist |
| fastify | 5.12.5 | GHSA-389g-gv7q-r4x8 (header validation bypass), `<5.12.6` | Only with header schemas |
| fast-uri / ip-address | transitive | URI parsing; ReDoS-like stall in `ip-address` (via `@fastify/rate-limit`) | Low |
| drizzle-kit → esbuild | dev | Dev-server CORS (GHSA-67mh-4wv8-2f99) | Dev only; esbuild dev server not used |

`npm outdated`: `better-auth 1.7.28`, `zod 4.6.7`, `fastify 5.12.8` and `@fastify/*` are all within the current `^` ranges. `postgres 4.x` is a major bump; leave it for now.

**Fix:** Run `npm update` (which also refreshes the lockfile), re-run `npm audit` and accept the dev-only drizzle-kit/esbuild finding. Note that `.gitignore` excludes `package-lock.json`, so installs are not reproducible and the audited tree can differ per machine. Commit the lockfile.

**Effort:** S

### M1 — Better Auth endpoints bypass the app's input rules (Medium, VERIFIED)

**What:** Sign-up and `update-user` validate only Better Auth's own rules (email format, password length 8). `name` is unbounded and `image` takes any string.

**Evidence:** A 500,000-character `name` was stored at sign-up (`length(name)=500000`). `update-user` stored `image = 'javascript:alert(1)'`. Every future listing or booking view that renders the seeker or tenant name inherits this data, and the `image` field is an XSS vector if the frontend ever renders it as a link.

**Fix:** Disabling `/update-user` (C1) covers updates. For sign-up, validate `name` (trim, 1–100) and `role` in `user.create.before`, or put an app-level Zod-validated route in front of sign-up. Restrict `image` to `https:` (L3).

**Effort:** S

### M2 — No DB timeouts; health check can't see the DB (Medium, VERIFIED)

**What:** `postgres()` sets only `connect_timeout: 5`. No `statement_timeout`/`idle_in_transaction_session_timeout` is set, and Fastify has no `requestTimeout`. `/api/health` returns `ok` without touching the DB.

**Evidence:** With the DB container paused, `/api/health` without a cookie returned 200 `ok` in 0.02 s. The same request with a session cookie hung until curl gave up at 60 s, because the `preHandler` session lookup waits on a pooled connection forever. Under a real outage every authenticated request piles up, which will be worse with booking transactions holding row locks.

**Fix:**
- `postgres(url, { connection: { statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000 } })`.
- Fastify `requestTimeout` (e.g. 30 s).
- Keep `/api/health` as liveness, and add `/api/health/ready` that runs `select 1` with a short timeout for the proxy/orchestrator.

**Effort:** S

### M3 — Auth timestamps are `timestamp without time zone`: 3-hour skew (Medium, VERIFIED)

**What:** `0001` converted every auth timestamp (`session.expires_at`, `user.created_at`, and others) from `timestamptz` to `timestamp`. Domain tables stay `timestamptz`. postgres-js writes JS `Date` as UTC, and the zone is dropped on cast. On read, the zone-less string is parsed in Node's local zone.

**Evidence:** Under this machine's `Africa/Nairobi` zone, a value written as `2026-12-01T12:00:00Z` into a `timestamp` column read back as `09:00:00Z`; the `timestamptz` column read back correctly. Under `TZ=UTC` both were correct.

**Why:** Session expiry and `updateAge` arithmetic are off by 3 h whenever the server is not in UTC, which applies to the Windows dev box and possibly a Kenyan VPS. Any later "created in the last N hours" admin query mixing auth and domain tables will be wrong.

**Fix:** In `schema/auth.ts`, use `timestamp(…, { withTimezone: true })` for all auth columns (the original 0000 shape) and migrate. Also set `TZ=UTC` in production as a belt-and-braces measure.

**Effort:** S (bundle with H3's migration)

### M4 — Session lookup on every request, in the wrong hook (Medium, VERIFIED)

**What:** `app.addHook("preHandler", authenticate)` on the root instance calls `auth.api.getSession` for every request, including `/api/health`, 404s and `/api/auth/*`. On `/api/auth/*`, Better Auth then repeats the lookup itself.

**Evidence (statement counts from the PG log):** No cookie: 0. Cookie on `/api/health`: 3. Cookie on `/api/nope` (404): 3. Cookie on `/api/auth/get-session`: 4.

The brief says guards run as `onRequest` (before body validation). Here they run as `preHandler`, after parsing and validation, so an unauthenticated client gets 422 validation details for protected routes before the 401.

**Cost:** About 3 indexed PK/unique lookups, roughly 1–3 ms on a local pool. Acceptable for an MVP, but it consumes pool slots (`max: 10`) for routes that don't need a user, and it is the hang point in M2.

**Fix:** Turn it into the planned `plugins/auth.ts`:
- Decorate `request.user = null`.
- Run `authenticate` as an `onRequest` hook, skipping `/api/auth/*` and `/api/health*`.
- Provide `requireAuth` and `requireRole(...roles)` as `onRequest` guards that also enforce H4.

Optional later: Better Auth `cookieCache` with a short `maxAge` (≤60 s), only after the suspend flow deletes sessions, and accepting that window.

**Effort:** S

### M5 — PII in logs from Better Auth's console logger (Medium; email VERIFIED, token SUSPECTED)

**What:** Better Auth's default logger is separate from pino, so the `redact` paths in `app.ts:15` don't apply. On a DB error it prints the Drizzle error including `params`.

**Evidence:** During a connection timeout, the server log contained `params: [ 's1@x.io' ]` with a full stack, as multi-line non-JSON text. The session lookup is `where "session"."token" = $1`, so a failure there would print the raw session token (a bearer credential). I could not trigger that failure (the paused DB made the query hang instead), hence SUSPECTED. `"Invalid password"` warnings are logged without the password (verified: 0 occurrences of test passwords in the log).

**Fix:** Pass Better Auth a `logger` option that forwards to `app.log` / a pino child, logs only `message` and `code`, and drops the error's `params`. Set `level: "warn"` in production.

**Effort:** S

### M6 — Auth responses break the API contract (Medium, VERIFIED)

**What:** `auth.routes.ts` streams Better Auth's response through unchanged. The observed responses don't match `api.md`:

| Case | Observed | `api.md` expects |
|---|---|---|
| invalid email | `400 {"message","code":"VALIDATION_ERROR"}` | 422 + envelope + field details |
| duplicate email | `422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` | 409 `CONFLICT` |
| bad origin | `403 {"message","code":"INVALID_ORIGIN"}` | envelope |
| unknown `/api/auth/x` | `404` with empty body | `NOT_FOUND` envelope |
| app 500 | `INTERNAL_SERVER_ERROR` | `INTERNAL_ERROR` |

Malformed JSON and 429s on auth routes do get the envelope, because Fastify handles them first.

**Fix:** Either document Better Auth's native contract for `/api/auth/*` (simplest; the frontend will likely use the Better Auth client anyway), or wrap non-2xx auth responses into `failure(code, message)` in the proxy. Pick one in §8 Q4, and align `INTERNAL_ERROR` vs `INTERNAL_SERVER_ERROR` either way.

**Effort:** S

### M7 — No auth-specific rate limit (Medium, VERIFIED)

**What:** The only limit is the global 100/min/IP. `rate-limit.ts` says tighter per-route limits come "later". Better Auth's built-in limiter is on only in production and in memory, so it resets on restart and isn't shared between instances.

**Evidence:** 110 fast sign-ins in dev produced 100 × 401 then 10 × 429. That allows about 144k password guesses per IP per day.

**Fix:** After H5, add `config: { rateLimit: { max: 10, timeWindow: "1 minute" } }` to the `/auth/*` route (or set Better Auth `rateLimit.customRules` for `/sign-in/email` and `/sign-up/email`), and keep Better Auth's limiter on in all environments. Use a shared store (`storage: "database"` or Redis) only when running more than one instance.

**Effort:** S

### M8 — Environment and config gaps (Medium, VERIFIED)

- `.env.example` has no `FRONTEND_URL`, but `env.ts:14` requires it, so a fresh clone fails at startup with a Zod error.
- `BETTER_AUTH_URL` is optional. When unset, Better Auth derives its base URL from the request. With `trustProxy: true` that is `X-Forwarded-Host`/`Host`, which affects the `Secure` cookie decision and any future email links (password reset). Make it required, and `https://` in production.
- `DATABASE_URL` is `min(1)` rather than a URL check; `PORT` has no range check; `FRONTEND_URL` allows only one origin (no preview or staging origins).
- `drizzle.config.ts` uses `process.env.DATABASE_URL!` without validation, so a typo there silently migrates the wrong DB or fails unclearly.
- No `CLOUDINARY_*` variables yet. Add them to the schema when uploads land, required in production.

**Fix:** Update `.env.example`; tighten the schema with `z.url()`, `PORT` range, and `BETTER_AUTH_URL` required with an https refinement when `NODE_ENV=production`; import the validated `env` in `drizzle.config.ts`.

**Effort:** S

### M9 — No DB guarantee of one confirmed booking per property (Medium, VERIFIED absent)

**What:** `bookings` has a partial unique index for one PENDING request per seeker and property, but nothing at DB level stops two `CONFIRMED` rows for the same property. The planned row locks will prevent it only if every future code path (confirm, admin tools, scripts, a later payment callback) takes the lock correctly.

**Fix:** Add `uniqueIndex("bookings_one_confirmed_per_property_idx").on(t.propertyId).where(sql\`status = 'CONFIRMED'\`)` now, while the table is empty. It turns a lock-order bug into a 409 instead of a double let. Map Postgres `23505` to `ConflictError` in the error handler (currently it would surface as a 500).

**Effort:** S

### L1 — Dev server listens on all interfaces (Low, VERIFIED)

`server.ts:9` hard-codes `host: "0.0.0.0"`. The log showed it reachable on `192.168.2.109`, `192.168.137.1` (Windows hotspot) and `172.25.240.1` (WSL). Anyone on the same Wi-Fi can reach a dev API that uses dev data. **Fix:** a `HOST` env var defaulting to `127.0.0.1` in development and `0.0.0.0` in production or containers. **Effort:** S

### L2 — Unused dependencies; missing IPv4 DNS fix (Low, VERIFIED)

`dns2` and `@fastify/cookie` are imported nowhere (grep). The brief's "IPv4-first DNS fix in env.ts and drizzle.config.ts" is not present in either file. If it was needed (Windows resolving `localhost` to `::1` while Postgres listens only on IPv4), use `dns.setDefaultResultOrder("ipv4first")` from Node's built-in `dns` module, or `127.0.0.1` in `DATABASE_URL`; `dns2` is not required. **Fix:** remove both packages. **Effort:** S

### L3 — `z.string().url()` accepts dangerous schemes (Low, VERIFIED)

`javascript:alert(1)`, `data:text/html,x` and `ftp://x` all pass (tested with installed zod 4.6.5). **Fix:** `z.url({ protocol: /^https$/ })` for `image`, and later for any URL field. **Effort:** S

### L4 — Empty PATCH body likely gives a 500 (Low, SUSPECTED)

`updateUserProfileSchema` is `.strict()` with all fields optional, so `{}` is valid. Drizzle's `.set({})` throws "No values to set", which reaches the handler as a generic 500. Not reproduced, because the module is not mounted. **Fix:** `.refine(o => Object.keys(o).length > 0, "Provide at least one field")`. **Effort:** S

### L5 — No response schemas; full rows are returned (Low, VERIFIED)

`getUserProfile` uses `db.select().from(user)` and the routes declare no `response` schema, so the serializer does not filter. Today's `user` columns are safe to return to their owner. The pattern, copied into properties and bookings (for example a seeker's details on a tenant's "received" list), will leak columns such as `deleted_at` or a future `phone`. `requirements.md §7` has explicit privacy rules. **Fix:** declare `response: { 200: … }` Zod schemas, which the serializer compiler will enforce, and select explicit columns in services. **Effort:** S per module

### L6 — Duplicated types and unchecked casts (Low, VERIFIED)

`UserRole`/`UserStatus` are defined in `enums.ts`, `auth.types.ts` and `user.types.ts`. `auth.middleware.ts:18-19` casts strings from the DB to those unions with `as`, so after H3 a `null` or `SUPERUSER` value is typed as valid. **Fix:** a single source (`enums.ts`) and a runtime check (`z.enum(userRoleEnum.enumValues).parse`) in `authenticate`, rejecting the session on mismatch. **Effort:** S

### L7 — Tooling and deployment readiness (Low, VERIFIED)

- No test runner, no linter, no `engines`/`.nvmrc` (Node 24.22.1 is in use locally), and `"main": "index.js"` is wrong.
- `noEmitOnError` is missing (H2).
- `auth:generate` writes directly over `src/db/schema/auth.ts`. This is the root cause of H3 and M3: the CLI regenerated plain `text`/`timestamp` columns and `db:generate` turned that into migration 0001. Generate to a temporary file and merge by hand.
- `db:push` bypasses migrations; remove it, or guard it to development only.
- No migration-on-deploy step. Run `drizzle-kit migrate` as a release step before start, never `push`.
- No README.

**Effort:** S

### L8 — Hand-rolled auth proxy (Low, VERIFIED from code)

`auth.routes.ts`:
- builds the URL from `request.protocol`/`request.hostname`, which come from `X-Forwarded-*` in production;
- forwards all inbound headers, including the original `content-length`, after re-serializing the parsed body (a whitespace-padded body still worked because undici recomputes it, but the result depends on the runtime);
- `JSON.stringify`s non-JSON bodies;
- does not handle `HEAD`.

It works today. **Fix:** build the URL from `env.BETTER_AUTH_URL` and the path, and drop the `content-length`/`host` headers before forwarding (Better Auth's documented Fastify integration does essentially this). **Effort:** S

### Forward-risk notes (planned work)

- **Admin module:** blocked by C1, H3 and H4. Admin status changes must (a) update `status` and (b) delete `session` rows in one transaction. Do it in the service with Drizzle, not through Better Auth's `update-user` (disabled by C1). A role change ("promote internally") should be a separate service function, never a request body field. Consider the Better Auth `admin` plugin only if its roles and ban model match. It brings its own `banned`/`role` columns, which would collide with the current fields, so I'd keep the hand-rolled version.
- **First-admin seed script:** must create the user through `auth.api.signUpEmail` (so the password is hashed in `account`). That is blocked by the create hook rejecting ADMIN, so seed as SEEKER and then `UPDATE role='ADMIN'` in the same script, or call the hook with an explicit server-only flag. Read credentials from env or a prompt, never from argv. Make it idempotent (`ON CONFLICT (email)`).
- **Properties/discovery (when written):**
  - `properties_discovery_idx (county, property_type, price_amount)` does not serve the default `sort=newest` or the `area` filter. Add `(created_at DESC, id)` within the same partial predicate, and paginate on `(created_at, id)` for stable ordering.
  - Escape `%`/`_`/`\` in `area` ILIKE input.
  - Cap `amenities` length and item size (zod advisory, H6).
  - Return `price_amount` with `Number()` only after checking it fits `numeric(12,2)` (it does; that is well below 2^53).
- **Bookings:** add M9. The tenant "received" list joins `bookings` and `properties` filtered on `properties.tenant_id`, which the existing indexes cover; prefer `(property_id, status)` over the standalone low-selectivity `bookings_status_idx`. `preferred_move_in_date` is a `date`: validate "not in the past" against `Africa/Nairobi` today, not the UTC date.
- **Uploads:** `uploads.property_id ON DELETE CASCADE` never fires with soft delete, so images of deleted listings stay in Cloudinary forever. Decide a cleanup policy. The "max 10 per property" rule has no DB backing; enforce it under the property row lock.
- **Payments/M-Pesa:** Daraja callbacks are unauthenticated webhooks. Before payments you need an idempotency key table, the fixed `trustProxy` (H5) for IP allow-listing, and M9-style DB invariants. The current `numeric(12,2)` is fine for KES.
- **Notifications:** none exist; there is no outbox. When added, write notification rows in the same transaction as the booking state change, rather than sending from inside the transaction.

---

## 4. Fix before new features vs. can wait

**Fix before new features (in this order):**

| # | Fix | Findings | Depends on | Effort |
|---|-----|----------|-----------|--------|
| 1 | Make it compile: fix controller calls, register `userRoutes`, add `noEmitOnError` | H2 | — | S |
| 2 | `npm update` within ranges; commit `package-lock.json` | H6 | — | S |
| 3 | Close escalation: `disabledPaths: ["/update-user"]`, `user.update.before` guard, validate `name` in `user.create.before` | C1, M1 | 1 | S |
| 4 | One migration: `role`/`status` enum or CHECK + `NOT NULL`, auth timestamps back to `timestamptz`, `bookings_one_confirmed_per_property_idx`; stop `auth:generate` overwriting the schema | H3, M3, M9, L7 | 3 | S–M |
| 5 | Auth plugin: `onRequest`, skip `/api/auth/*` and health, `requireAuth` rejects non-ACTIVE, add `requireRole`, runtime-check role/status | H4, M4, L6 | 4 | S |
| 6 | `trustProxy` hop count via env, Better Auth IP config, auth route limit ≈10/min | H5, M7 | — | S |
| 7 | DB `statement_timeout` / `idle_in_transaction_session_timeout`, Fastify `requestTimeout`, `/api/health/ready` | M2 | — | S |
| 8 | Env hardening (`.env.example`, required `BETTER_AUTH_URL`, `drizzle.config` uses `env`) | M8 | — | S |
| 9 | Better Auth logger → pino without params; map PG `23505` → 409 in the error handler | M5, M9 | 7 | S |
| 10 | Test harness and the "P0" tests in §6 | — | 1–5 | M |
| 11 | Resolve §8 Q1 (where the properties/uploads/bookings code is) | H1 | — | — |

**Can wait (before production, not before features):** M6 (decide the contract before the frontend integrates auth), L1, L2, L3, L4, L5 (adopt response schemas as each module is written), L8, the rest of L7 (README, engines, deploy migration step), docs sync (§7).

---

## 5. What is solid

- **One `buildApp()` factory** with injectable options (`rateLimitMax`), separate from `server.ts`. That is what makes `fastify.inject()` tests straightforward.
- **Central error handler** with a single `{success, data | error{code, message, details}}` envelope, typed `AppError` subclasses, 422 field details for Zod, and generic 500s with server-side logging only. No stack traces reached the client in any probe.
- **Better Auth configuration basics are right:** origin checks reject foreign and missing `Origin` on cookie-authenticated POSTs (verified 403), the cookie is `HttpOnly; SameSite=Lax`, and production uses the `__Secure-` prefix + `Secure` (verified). The `status` field is correctly `input: false` (verified rejected), the sign-up role allow-list works (verified), and the login block fails closed on `NULL` status (verified).
- **Schema integrity is thoughtful for the domain tables:** partial unique "one pending per seeker/property", partial unique "one primary image", CHECK constraints on price and room counts, `ON DELETE RESTRICT` from domain tables to `user`, `timestamptz` everywhere in domain tables, and a partial discovery index that matches the "PUBLISHED and not deleted" predicate.
- **Schema and migrations are in sync** (`drizzle-kit check`: "Everything's fine"; `generate`: "No schema changes").
- **Thin functional controllers / service layer** are already followed in the users module, and the comments document the intent. Keep that pattern.
- **Pino `redact`** for `authorization`/`cookie` headers is a good start (M5 covers the gap). Graceful shutdown closes Fastify, then the DB pool.
- No `.env` secret has ever been committed: the tracked `.env` in `54c8983` was an empty file.

---

## 6. Test plan (minimum, riskiest first)

**Harness:**
- Runner: `node:test` with `tsx` (no new framework), or `vitest`.
- A throwaway Postgres (Docker, as used for this audit), migrated once per run with tables truncated between tests.
- Set env before importing `buildApp`, because `env`, `db` and `auth` are module-level singletons created at import time. That is acceptable: point `DATABASE_URL` at the test DB.
- Hit the app with `app.inject()`, with a helper that signs up or signs in and returns the cookie.
- **Blocker for upload tests:** there is no storage seam yet. When uploads are written, put Cloudinary behind a small `ImageStorage` interface so tests can inject a fake.

**P0 – auth and authorization (write before any feature):**
1. `update-user` with `{role:"ADMIN"}` is rejected or 404s, and the role is unchanged in the DB (C1 regression).
2. Sign-up with `role` `ADMIN`, `admin` or `SUPERUSER` → 400; with `status:"BANNED"` → 400; with no role → SEEKER.
3. DB rejects `UPDATE "user" SET role='X'` and `status=NULL` (H3).
4. Suspend a user with a live session → next authenticated request returns 401/403; sign-in returns 403; session rows are deleted (H4, admin flow).
5. Protected route without a cookie → 401 *before* body validation (`onRequest` ordering).
6. `requireRole('TENANT')` route as SEEKER → 403; as ADMIN-only route → 403 for TENANT.
7. Cross-origin POST with cookie → 403; no-Origin POST with cookie → 403.

**P1 – contract and infrastructure:**
8. Malformed JSON → 400 envelope; Zod failure → 422 with `details[].field`; unknown route → 404 envelope; thrown unknown error → 500 with generic message and no stack.
9. Rate limit: N+1 sign-ins → 429 envelope; with `trustProxy=1`, a spoofed XFF does not reset the counter.
10. `GET/PATCH /api/users/me`: unknown key → 422; `{}` → 422; `image: "javascript:…"` → 422; `name` > 100 chars → 422; response contains only whitelisted fields.
11. `/api/health/ready` returns 503 when the DB is unreachable (point the test at a closed port).

**P2 – domain (as each module lands):**
- **Bookings:** two concurrent confirms on different bookings for the same property → exactly one CONFIRMED (run via `Promise.all` on two connections); confirm vs cancel race; duplicate pending → 409 `DUPLICATE_BOOKING`; seeker on own property → rejected; non-participant → 404.
- **Properties:** tenant B PATCH/DELETE on tenant A's listing → 403; soft-deleted and REJECTED listings are absent from public search; `/properties/me` route is not captured by `/:id`; pagination is stable with equal `created_at`; `area=%` does not match everything.
- **Uploads:** 11th image → 409/422; non-image with `.jpg` name → 415 (magic bytes); 5 MB+1 → 413; DB failure after Cloudinary success → Cloudinary delete is called (fake storage).

---

## 7. Docs drift

**`docs/api.md` vs code**
- Auth endpoints are listed as `/api/auth/register`, `/login`, `/logout`, `/me`. Actual (Better Auth): `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session`. Better Auth also exposes, all live: `update-user`, `change-password`, `list-sessions`, `revoke-session(s)`, `revoke-other-sessions`, `update-session`, `request-password-reset`, `reset-password`, `verify-password`, `account-info`, `list-accounts`, and others.
- Register body uses `accountType` and `phone`. Code uses `role` and has no `phone` (the intentional decision is "no phone field").
- `PATCH /api/users/me` lists `phone`. Code allows `name` and `image` only, and the route is not mounted (H2).
- §3 to §6 (properties, uploads, bookings, admin) are documented but not implemented (H1).
- `PATCH /api/admin/properties/:id/unpublish` and the "Unpublish" lifecycle conflict with the decision that status is only `PUBLISHED | REJECTED`.
- The error code is `INTERNAL_ERROR` in docs but `INTERNAL_SERVER_ERROR` in `error-handler.ts:62`. Docs don't mention `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `TOO_MANY_REQUESTS` or `CLIENT_ERROR`, which the handler emits.
- "422 for invalid data" does not hold for `/api/auth/*` (M6).
- "Uploads may use multipart or signed-upload flow" vs `architecture.md §11` "Use Cloudinary signed uploads" vs the brief's "multipart": three different statements.

**`docs/architecture.md` vs code**
- Custom user fields list `phone` (none exists).
- Property fields `rent_period`, `latitude`, `longitude` are absent from the schema. `deleted_at` exists in the schema but not in the doc.
- The property status list (`DRAFT`, `PUBLISHED`, `UNPUBLISHED`, `REJECTED`, `ARCHIVED`) vs the schema enum (`PUBLISHED`, `REJECTED`) plus `deleted_at`.
- "Published once … at least one image" vs the decision "listings go live immediately". `requirements.md` rule 4.6 says the same as architecture.
- Folder structure:
  - `modules/auth/auth.ts` → actually `config/auth/better-auth.ts` + `modules/auth/auth.routes.ts` + `auth.types.ts`;
  - `plugins/auth.ts` → actually `middleware/auth.middleware.ts`;
  - `drizzle/migrations/` → actually `src/db/migrations/`;
  - `tests/` and `README.md` don't exist;
  - extra `src/types/fastify.d.ts`, `plugins/rate-limit.ts` and `db/schema/enums.ts` are undocumented.
- §11 "Rate-limit authentication endpoints" is not implemented beyond the global limit (M7).

**`docs/requirements.md` vs code**
- Account rule 6, "Existing sessions are invalidated when an account is suspended or banned", is not implemented (H4).
- The registration flow includes "Phone" (decision: no phone).
- The property lifecycle (`DRAFT`→…→`ARCHIVED`) conflicts with the decision.

**`docs/database.md`** is empty (0 bytes).

**Brief vs code** (for the owner's mental model): `src/lib/{validation,db,image}`, `src/plugins/{auth,multipart}`, and the modules `properties`, `uploads`, `bookings` and `admin` don't exist. Guards are `preHandler`, not `onRequest`. The "IPv4-first DNS fix" is not present.

---

## 8. Open questions for the owner

1. **Where is the properties, uploads and bookings code?** The repo (`main` = `origin/main` @ `a7ab40b`, no other branches) has none of it. Is it on another machine or branch, or not written yet? This decides whether the remaining plan is "admin + hardening" or "four modules + hardening".
2. **Profile edits:** OK to disable Better Auth's `/update-user` and make `PATCH /api/users/me` the only way to change `name`/`image`? (Recommended; it fixes C1 and M1 together.)
3. **Role/status storage:** Postgres enums (restores the 0000 design, but every Better Auth CLI regeneration must be merged by hand) or `text` + CHECK constraints (survives regeneration better)? Either fixes H3.
4. **Auth API contract:** document Better Auth's native paths and error shape for `/api/auth/*`, or add `/register`, `/login` and so on with the app envelope? (Recommended: native paths and the Better Auth client on the frontend, with docs updated.)
5. **Reverse proxy topology:** how many proxy hops in production (nginx/Caddy only, or Cloudflare in front)? This sets `trustProxy` (H5).
6. **Suspension response:** on a live session, should a suspended user get 401 (treated as logged out) or 403 `ACCOUNT_SUSPENDED` (the frontend can explain why)?
7. **Publish rule:** do listings need at least one image before they're public (`requirements.md` 4.6), or go live immediately with zero images (brief)?
8. **Admin "unpublish":** drop it from `api.md` (only `REJECTED` exists), or add an `UNPUBLISHED` status?
9. **Upload flow:** server-side multipart (as in the brief) or Cloudinary signed direct uploads (as in `architecture.md`)? This changes memory use, the magic-byte check location and the orphan-cleanup design.
10. **Server time zone:** will production run with `TZ=UTC`? (Recommended regardless of M3.)

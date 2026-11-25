# KejaLink: API Reference

**Base URL:** `/api` · **Format:** JSON (uploads use `multipart/form-data`) · **Auth:** Better Auth session cookie (`better-auth.session_token`, `__Secure-` prefixed in production).

Everything outside `/api/auth/*` uses the app envelope below. `/api/auth/*` is Better Auth's own API, with its own response and error format (see §1).

## Conventions

**Success**

```json
{ "success": true, "data": { "id": "…" } }
```

**Paginated** (every list endpoint): `?page=1&limit=20` (limit 1–50, default 20)

```json
{ "success": true, "data": [], "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }
```

**Error**

```json
{ "success": false, "error": { "code": "PROPERTY_NOT_AVAILABLE", "message": "…", "details": null } }
```

`details` is an array of `{ field, message }` for `VALIDATION_ERROR`, and `null` otherwise.

**Request rules**
- Bodies are strict: unknown keys return 422. Query strings ignore unknown parameters, but validate the known ones.
- Route ids are UUIDs (admin user ids are Better Auth string ids). A malformed id returns 422, never a database error.
- Prices are JSON numbers (KES, up to 2 decimals). Timestamps are ISO-8601 UTC. `preferredMoveInDate` is `YYYY-MM-DD`.
- **CSRF:** a POST, PATCH or DELETE that carries a session cookie must send an `Origin` header listed in `FRONTEND_URL`. Otherwise it gets 403 `INVALID_ORIGIN` (Better Auth applies the same rule to `/api/auth/*`).
- Auth guards run before body validation, so an unauthenticated request to a protected route gets 401 even if its body is invalid.

### Status codes

| Status | Meaning |
|---|---|
| 200 / 201 | OK / created |
| 400 | Malformed request (e.g. invalid JSON) |
| 401 | `UNAUTHORIZED`: no valid session |
| 403 | `FORBIDDEN` (wrong role), `ACCOUNT_SUSPENDED`, `INVALID_ORIGIN`, `NOT_PROPERTY_OWNER`, `OWN_PROPERTY`, `CANNOT_MODIFY_ADMIN` |
| 404 | `NOT_FOUND` (route), `PROPERTY_NOT_FOUND`, `BOOKING_NOT_FOUND`, `UPLOAD_NOT_FOUND`, `USER_NOT_FOUND` |
| 409 | `CONFLICT`, `DUPLICATE_BOOKING`, `PROPERTY_NOT_AVAILABLE`, `BOOKING_NOT_PENDING`, `BOOKING_NOT_CANCELLABLE`, `PROPERTY_HAS_CONFIRMED_BOOKING`, `UPLOAD_LIMIT_REACHED`, `PROPERTY_NOT_REJECTED` |
| 413 | `PAYLOAD_TOO_LARGE` (image over 5 MB, more than one file) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` (wrong body type, or an image that is not JPEG/PNG/WebP or does not match its declared type) |
| 422 | `VALIDATION_ERROR` (schema validation, with field `details`) |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_SERVER_ERROR` (generic message, never a stack trace) |
| 502 | `UPLOAD_FAILED` (image host error) |
| 503 | `DATABASE_UNAVAILABLE` (readiness), `SERVICE_UNAVAILABLE` (query timed out) |

**Rate limits:** 100 requests/min per client IP globally, and `AUTH_RATE_LIMIT_MAX` (default 10) per minute for `/api/auth/*`, including sign-in and sign-up.

---

## 1. Authentication (Better Auth, native)

These endpoints return **Better Auth's native format**, not the app envelope: for example `{ "token", "user" }` on success and `{ "message", "code" }` on error, with Better Auth's status codes (validation errors are 400, a duplicate email is 422). Use the Better Auth client on the frontend.

| Method | Endpoint | Notes |
|---|---|---|
| `POST` | `/api/auth/sign-up/email` | `{ name, email, password, role? }`. `role` is `TENANT` or `SEEKER` (default `SEEKER`); `ADMIN` or any other value returns 400. `name` is trimmed, 1–100 characters. Password at least 8 characters. Signs the user in. |
| `POST` | `/api/auth/sign-in/email` | `{ email, password, rememberMe? }`. Suspended or banned accounts get 403. |
| `POST` | `/api/auth/sign-out` | |
| `GET` / `HEAD` | `/api/auth/get-session` | The current session and user (including `role` and `status`), or `null`. |
| `POST` | `/api/auth/change-password` | `{ currentPassword, newPassword, revokeOtherSessions? }` |
| `GET` | `/api/auth/list-sessions` | |
| `POST` | `/api/auth/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions` | |
| `POST` | `/api/auth/verify-password` | |
| `GET` | `/api/auth/list-accounts`, `/account-info` | |
| `GET` | `/api/auth/ok`, `/api/auth/error` | Better Auth health and error page. |

**Disabled** (404): `update-user` (use `PATCH /api/users/me`), `change-email`, `delete-user`, `update-session`, `sign-in/social`, `link-social`, `unlink-account`, `get-access-token`, `refresh-token`, `send-verification-email`, `verify-email`, `request-password-reset`, `reset-password`. There are no social providers and no email sender in V1.

Example registration:

```json
POST /api/auth/sign-up/email
{ "name": "Wanjiru Kamau", "email": "wanjiru@example.com", "password": "a-strong-password", "role": "TENANT" }
```

A client-supplied `status` is ignored, and every new account is `ACTIVE`. Admin accounts are created with `npm run seed:admin`.

---

## 2. Users

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/users/me` | Signed in (ACTIVE) |
| `PATCH` | `/api/users/me` | Signed in (ACTIVE) |

Response fields: `id, name, email, emailVerified, image, role, status, createdAt, updatedAt`.

PATCH body (strict, all optional): `{ "name": "1-100 chars", "image": "https://… | null" }`. The image must be an `https:` URL. `role`, `status`, `email` and any other key return 422. An empty body `{}` returns the current profile.

---

## 3. Properties

| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/api/properties` | Public |
| `GET` | `/api/properties/me` | TENANT |
| `GET` | `/api/properties/:id` | Public / owner / admin |
| `POST` | `/api/properties` | TENANT |
| `PATCH` | `/api/properties/:id` | TENANT (owner) |
| `DELETE` | `/api/properties/:id` | TENANT (owner) |

`/me` is registered before `/:id`.

### `GET /api/properties`: public discovery

Returns only listings that are `PUBLISHED`, not deleted, and whose tenant is `ACTIVE`.

| Query | Meaning |
|---|---|
| `q` | Case-insensitive search across title, description, area and county. `%`, `_` and `\` match literally. |
| `county` | Exact match, case-insensitive. |
| `area` | Partial match, case-insensitive. |
| `propertyType` | `HOUSE`, `APARTMENT`, `ROOM`, `BEDSITTER`, `STUDIO` or `OTHER`. |
| `minPrice`, `maxPrice` | Inclusive. `minPrice > maxPrice` returns 422. |
| `bedrooms` | Exact. |
| `available` | `true` or `false`. |
| `sort` | `newest` (default), `price_asc` or `price_desc`; the id is always the tiebreaker, so ordering is stable. |
| `page`, `limit` | Pagination. |

Item fields: `id, tenantId, title, propertyType, priceAmount, priceCurrency, bedrooms, bathrooms, county, area, isAvailable, primaryImageUrl, createdAt`.

### `GET /api/properties/me`

The tenant's own non-deleted listings in any status. Items have the discovery fields plus `status, rejectionReason, updatedAt`. Paginated.

### `GET /api/properties/:id`

- **Public:** if `PUBLISHED`, not deleted and the tenant is ACTIVE.
- **Owner:** also sees `REJECTED` listings.
- **Admin:** sees everything, including deleted listings.
- **Everyone else:** 404 `PROPERTY_NOT_FOUND`.

Detail fields: `id, tenantId, title, description, propertyType, priceAmount, priceCurrency, bedrooms, bathrooms, county, area, addressText, amenities, status, isAvailable, createdAt, updatedAt, tenant { id, name, image }, uploads [{ id, url, isPrimary, displayOrder, createdAt }]` (ordered by `displayOrder`). `rejectionReason` is included for the owner and admins only; `deletedAt` for admins only.

### `POST /api/properties`

Strict body. The listing is created `PUBLISHED` and returned with 201.

```json
{
  "title": "3-150 chars",
  "description": "10-5000 chars",
  "propertyType": "APARTMENT",
  "priceAmount": 45000,
  "bedrooms": 2,
  "bathrooms": 1,
  "county": "Nairobi",
  "area": "Kilimani",
  "addressText": "optional, ≤255",
  "amenities": ["parking", "water"]
}
```

- `priceAmount` must be greater than 0 and at most 100,000,000.
- `bedrooms` and `bathrooms` are optional integers from 0 to 50.
- `amenities` is optional: at most 30 items of 1–50 characters.
- `status`, `tenantId` and `rejectionReason` are rejected with 422.

### `PATCH /api/properties/:id`

All create fields are optional (`bedrooms`, `bathrooms` and `addressText` accept `null`), plus `isAvailable` (boolean). The body is strict, and an empty body is a no-op.

- `status` never changes here, so a `REJECTED` listing stays rejected but editable.
- Non-owner: 403 `NOT_PROPERTY_OWNER`. Deleted: 404.
- `isAvailable: true` while a CONFIRMED booking exists returns 409 `PROPERTY_HAS_CONFIRMED_BOOKING`.

### `DELETE /api/properties/:id`

Soft delete; returns `{ id, deletedAt }`. A CONFIRMED booking blocks it with 409 `PROPERTY_HAS_CONFIRMED_BOOKING`. Otherwise every PENDING request is rejected with the reason *"This listing was removed by the owner"*.

---

## 4. Property images (uploads)

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/properties/:id/uploads` | TENANT (owner) |
| `PATCH` | `/api/properties/:id/uploads/:uploadId` | TENANT (owner) |
| `DELETE` | `/api/properties/:id/uploads/:uploadId` | TENANT (owner) |

**POST** takes `multipart/form-data` with exactly one file in the field **`file`**: JPEG, PNG or WebP, at most **5 MB**, and at most **10 images per property**. It returns 201 `{ id, url, isPrimary, displayOrder, createdAt }`; the Cloudinary public id is never exposed. The first image becomes primary.

| Problem | Response |
|---|---|
| Not the owner | 403 |
| Unknown or deleted property | 404 |
| Already 10 images | 409 `UPLOAD_LIMIT_REACHED` |
| Wrong field name or no file | 422 |
| Not JPEG/PNG/WebP, or the content does not match the declared type | 415 |
| File over 5 MB | 413 |
| Image host failure | 502 `UPLOAD_FAILED` |

**PATCH** body (strict): `{ "isPrimary": true, "displayOrder": 0-1000 }`, both optional. Setting `isPrimary` clears the previous primary image. An upload that belongs to another property returns 404 `UPLOAD_NOT_FOUND`.

**DELETE** removes the image. If it was the primary, the image with the lowest `displayOrder` becomes primary.

Images of soft-deleted listings are retained (see DECISIONS D-13).

---

## 5. Bookings (rent requests)

| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/api/bookings` | SEEKER |
| `GET` | `/api/bookings/me` | SEEKER |
| `GET` | `/api/bookings/received` | TENANT |
| `GET` | `/api/bookings/:id` | Seeker, owning tenant, or admin |
| `PATCH` | `/api/bookings/:id/confirm` | TENANT (owner) |
| `PATCH` | `/api/bookings/:id/reject` | TENANT (owner) |
| `PATCH` | `/api/bookings/:id/cancel` | SEEKER (owner) |

**Create** (strict body; returns 201):

```json
{ "propertyId": "uuid", "preferredMoveInDate": "2026-12-01", "message": "1-1000 chars" }
```

| Problem | Response |
|---|---|
| `preferredMoveInDate` before today's date in Africa/Nairobi | 422 |
| Property unknown, deleted, rejected, or its tenant suspended | 404 |
| Requesting your own property | 403 `OWN_PROPERTY` |
| Property not available | 409 `PROPERTY_NOT_AVAILABLE` |
| An existing PENDING request for the same property | 409 `DUPLICATE_BOOKING` |

**Lists:** `/me` and `/received` take optional `?status=PENDING|CONFIRMED|REJECTED|CANCELLED` and are paginated, newest first.

**Booking fields:** `id, status, preferredMoveInDate, message, decisionReason, decidedAt, createdAt, updatedAt, property { id, title, county, area, priceAmount, priceCurrency, isAvailable, primaryImageUrl }, seeker { id, name, email, image }, tenant { id, name, image, email? }`. The tenant's `email` is shown to the seeker **only when the booking is CONFIRMED**; the tenant and admins always see it.

**Rules**
- Anyone who is not a participant gets 404 `BOOKING_NOT_FOUND`.
- **Confirm:** PENDING only (otherwise 409 `BOOKING_NOT_PENDING`), and the property must be published, live and available (otherwise 409 `PROPERTY_NOT_AVAILABLE`). In one transaction it confirms the booking, rejects the other PENDING requests (*"Another request for this property was accepted"*) and sets `isAvailable=false`.
- **Reject:** optional body `{ "reason": "1-500 chars" }`; a missing or `null` body is accepted. PENDING only.
- **Cancel:** PENDING or CONFIRMED only (otherwise 409 `BOOKING_NOT_CANCELLABLE`). Cancelling a CONFIRMED booking sets `isAvailable=true`. Tenants cannot cancel.
- Booking records are never hard-deleted. A seeker may request again after a rejection or cancellation.

---

## 6. Admin

All routes are under `/api/admin` and require `ADMIN`; other roles get 403. Every mutation writes a structured audit log line (`audit: true, adminId, action, targetId, reason`).

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/admin/users` | Filters: `role`, `status`, and `q` (name/email, case-insensitive, wildcards escaped). Paginated. |
| `GET` | `/api/admin/users/:id` | |
| `PATCH` | `/api/admin/users/:id` | Body `{ "status": "ACTIVE" \| "SUSPENDED" \| "BANNED" }` (strict). SUSPENDED or BANNED **deletes every session** of the user in the same transaction. Returns `{ user, sessionsRevoked }`. Targeting yourself or another admin returns 403 `CANNOT_MODIFY_ADMIN`. Roles cannot be changed through the API. |
| `GET` | `/api/admin/properties` | Filters: `status`, `tenantId`, `includeDeleted` (default `false`). Items include `status, rejectionReason, deletedAt, tenant { id, name, email, status }`. |
| `PATCH` | `/api/admin/properties/:id/reject` | Body `{ "reason": "3-500 chars" }` (required). Sets `REJECTED` and stores the reason; PENDING bookings are rejected (*"This listing was removed by an administrator"*). Returns `{ property, bookingsRejected }`. |
| `PATCH` | `/api/admin/properties/:id/restore` | Sets `PUBLISHED` and clears the reason. 409 `PROPERTY_NOT_REJECTED` if the listing is not rejected. |
| `DELETE` | `/api/admin/properties/:id` | Soft delete. PENDING bookings are REJECTED and CONFIRMED bookings CANCELLED, both with the reason above. Returns `{ id, deletedAt, bookingsRejected, bookingsCancelled }`. |
| `GET` | `/api/admin/diagnostics/request` | Returns what the API sees for the caller behind the hosting proxy: `ip`, `ipChain`, `remoteAddress`, `protocol`, and the raw `x-forwarded-for`, `x-forwarded-proto`, `true-client-ip` and `cf-connecting-ip` headers. Use it to confirm `TRUST_PROXY`. |
| `GET` | `/api/admin/bookings` | Read-only. Filters: `status`, `propertyId`, `seekerId`. Admins cannot confirm or reject on a tenant's behalf. |

---

## 7. Health

| Method | Endpoint | Meaning |
|---|---|---|
| `GET` | `/api/health` | Liveness: the process is up. Never touches the database. |
| `GET` | `/api/health/ready` | Readiness: `select 1` with a 2 s timeout. Returns 200 `{ status, database: "ok" }`, or 503 `DATABASE_UNAVAILABLE`. |

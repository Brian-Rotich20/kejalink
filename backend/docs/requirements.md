# KejaLink: Requirements (V1)

## 1. Overview

KejaLink is a property marketplace for the Kenyan rental market. In V1, tenants (listers) publish rental properties, seekers discover them and send rent requests, and admins moderate. There are **no payments** in V1.

Property types: `HOUSE`, `APARTMENT`, `ROOM`, `BEDSITTER`, `STUDIO`, `OTHER`.

## 2. Roles

| Role | Can |
|---|---|
| **TENANT** (lister) | Create, edit and delete own properties; manage their images; receive, confirm and reject rent requests |
| **SEEKER** | Browse, search and filter; view property details; submit rent requests; view and cancel own requests |
| **ADMIN** | View users; suspend, ban and reactivate users; view all properties; reject, restore and delete properties; view all bookings |

Admins are **never publicly registered**. They are created with `npm run seed:admin` (or promoted internally).

## 3. Account rules

1. Every user has exactly one role. There is no phone field.
2. Public registration allows only `TENANT` or `SEEKER` (default `SEEKER`).
3. Users cannot change their own role or status. No API changes roles.
4. Suspended or banned users cannot log in.
5. Suspending or banning a user **deletes all their sessions immediately**. Any remaining session of a non-ACTIVE user gets 403 `ACCOUNT_SUSPENDED`.
6. Admins cannot suspend or ban themselves or other admins.
7. Email addresses are unique. Email verification is off in V1.

## 4. Property rules

1. Every property belongs to exactly one tenant; ownership cannot be transferred.
2. Seekers cannot create, update or delete properties.
3. Tenants can manage only their own properties; ownership is verified server-side.
4. Properties are **published immediately on creation**; images are optional and can be added later (up to 10).
5. `status` is moderation only: `PUBLISHED` or `REJECTED`. An admin rejects with a reason and can restore.
6. `is_available` is occupancy and is separate from `status`. A published property may be visible but unavailable.
7. Delete is a **soft delete** (`deleted_at`), by the owner or an admin. Deleted listings disappear from discovery and from the owner's list.
8. Rejected listings are hidden from the public but visible, with the reason, to their owner and admins. The owner may still edit them, and they stay rejected.
9. Listings of suspended or banned tenants are hidden from the public.
10. A tenant cannot delete a listing, or mark it available, while it has a CONFIRMED booking.

## 5. Booking (rent request) rules

1. A booking references a seeker and a property, with an optional preferred move-in date (not in the past, by the Kenyan calendar) and an optional message.
2. The property must be `PUBLISHED`, not deleted, owned by an ACTIVE tenant, and `is_available = true`.
3. A seeker cannot have more than one PENDING request for the same property.
4. A seeker cannot request their own property.
5. Only the property owner can confirm or reject, and only PENDING requests.
6. Confirming, in one transaction: the booking becomes CONFIRMED, the other PENDING requests are REJECTED, and the property becomes unavailable.
7. Seekers can cancel their own PENDING or CONFIRMED bookings. Cancelling a CONFIRMED booking makes the property available again.
8. Tenants cannot cancel bookings through the API. Admins cannot confirm or reject on a tenant's behalf.
9. When a listing is rejected or deleted, its PENDING requests are rejected with a reason. An admin delete also cancels a CONFIRMED booking.
10. Booking records are never hard-deleted.

```text
PENDING ─┬─▶ CONFIRMED ─▶ CANCELLED
         ├─▶ REJECTED
         └─▶ CANCELLED
```

## 6. Admin rules

Every admin mutation keeps the reason where applicable, a timestamp, and the updated state, and writes a structured audit log line (admin id, action, target, reason).

## 7. Privacy and authorization

- Authorization is enforced in the backend service layer; the frontend is never trusted.
- Resources outside the viewer's scope return 404 (properties, bookings).
- A tenant sees the seeker's contact email on requests for their own properties. A seeker sees the tenant's email only after the booking is CONFIRMED.
- Public property details expose the tenant's name and image only.

## 8. Validation and integrity

- Every request is validated with Zod; bodies reject unknown keys. Client-side validation is for UX only.
- Every state change updates `updated_at`.
- The database enforces: unique email, valid role and status, one PENDING request per seeker and property, one CONFIRMED booking per property, one primary image per property, positive prices.

## 9. User flows

- **Register:** name, email, password and role (TENANT or SEEKER) → Better Auth → session → role dashboard.
- **Login:** Better Auth → status check → session → TENANT, SEEKER or ADMIN dashboard.
- **Tenant:** create the listing (live immediately) → add images → receive requests → confirm or reject.
- **Seeker:** browse, search, filter → view → request → it is confirmed or rejected → cancel if needed.
- **Admin:** users (view, suspend, ban, reactivate) · properties (view, reject, restore, delete) · bookings (view only).

## 10. V1 scope

Authentication, property listings, discovery, and rent requests, plus moderation. Everything else is deferred (see architecture.md §10).

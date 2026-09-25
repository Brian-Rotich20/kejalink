# KejaLink — Requirements

## 1. Overview

KejaLink is a property marketplace for the Kenyan rental market.

V1 allows users to:

* List rental properties
* Discover and search properties
* Request to rent/book properties
* Manage properties and booking requests

Supported property types:

```text
HOUSE
APARTMENT
ROOM
BEDSITTER
STUDIO
OTHER
```

V1 does **not** include payments.

---

# 2. User Roles

KejaLink has three roles:

```text
TENANT
SEEKER
ADMIN
```

### Tenant

Can:

* Create properties
* Edit properties
* Archive properties
* Upload/manage property images
* Receive booking requests
* Confirm or reject requests

### Seeker

Can:

* Browse properties
* Search and filter
* View property details
* Submit booking requests
* View bookings
* Cancel eligible bookings

### Admin

Can:

* Manage users
* Suspend/ban users
* Manage properties
* Unpublish/reject properties
* View all bookings

Admins are **not publicly registered**.

---

# 3. Account Rules

1. Every user has exactly one role.
2. Public registration only allows `TENANT` or `SEEKER`.
3. Admin accounts are created/promoted internally.
4. Users cannot change their own role or account status.
5. Suspended/banned users cannot log in.
6. Existing sessions are invalidated when an account is suspended or banned.
7. Email addresses are unique.

---

# 4. Property Rules

1. Every property belongs to exactly one Tenant.
2. Property ownership cannot be transferred through normal property updates.
3. Seekers cannot create, update, or delete properties.
4. Tenants can only manage their own properties.
5. Ownership is always verified server-side.
6. Properties are published once all required information and at least one image are available.
7. Admin approval is not required before publication.
8. Archived properties are removed from public discovery.
9. Rejected/unpublished properties are hidden from public discovery but remain visible to their owner and admins.
10. A published property can remain visible while unavailable.
11. `status` represents the property lifecycle.
12. `is_available` represents current rental availability.

### Property Lifecycle

```text
DRAFT
  ↓
PUBLISHED
  ↓
UNPUBLISHED / REJECTED
  ↓
ARCHIVED
```

Availability is managed separately:

```text
is_available = true
is_available = false
```

---

# 5. Booking Rules

Bookings represent **rental requests**, not short-stay reservations.

1. A booking must reference a valid Seeker and property.
2. The property must be `PUBLISHED` and `is_available = true`.
3. A Seeker cannot have multiple pending requests for the same property.
4. A Seeker cannot request their own property.
5. Only the property owner can confirm or reject a request.
6. Only `PENDING` requests can be confirmed or rejected.
7. Confirming a request:

   * Sets booking to `CONFIRMED`
   * Rejects other pending requests
   * Sets property `is_available = false`
8. These confirmation operations occur in one database transaction.
9. Seekers can cancel their own `PENDING` or `CONFIRMED` bookings.
10. Cancelling a confirmed booking makes the property available again.
11. Tenants cannot directly cancel confirmed bookings in V1.
12. Booking records are never hard-deleted.

### Booking Lifecycle

```text
PENDING
   ├──→ CONFIRMED
   │       ↓
   │   CANCELLED
   │
   ├──→ REJECTED
   │
   └──→ CANCELLED
```

---

# 6. Admin Rules

Admins can:

* View all users
* Suspend users
* Ban users
* Promote users internally
* View all properties
* Unpublish properties
* Reject properties
* Archive/delete properties
* View all bookings

Admins **cannot confirm or reject bookings on behalf of Tenants**.

Important admin actions should retain:

* Reason where applicable
* Timestamp
* Updated state

---

# 7. Privacy & Authorization

### Authorization

Authorization is enforced by the backend service layer.

The frontend must never be trusted to enforce ownership or permissions.

### Privacy

Users should only receive private contact information when required by the interaction.

For example:

* A Tenant can access relevant Seeker contact details for bookings on their own property.
* A user cannot access another user's private information simply by knowing their ID.

---

# 8. Validation & Data Integrity

All backend requests are validated using **Zod**.

Client-side validation is only for user experience.

The backend remains authoritative.

Every state-changing property or booking action updates:

```text
updated_at
```

Database constraints and transactions are used to protect against:

* Duplicate pending bookings
* Invalid ownership
* Conflicting booking confirmations
* Invalid foreign-key relationships

---

# 9. User Flows

## Registration

```text
Register
   ↓
Name + Email + Phone + Password + Account Type
   ↓
Zod Validation
   ↓
Better Auth
   ↓
Account + Session
   ↓
Role Dashboard
```

```text
TENANT → Tenant Dashboard
SEEKER → Seeker Dashboard
```

---

## Login

```text
Login
  ↓
Better Auth
  ↓
Check account status
  ↓
Create session
  ↓
Resolve role
  ↓
Dashboard
```

```text
TENANT → Tenant Dashboard
SEEKER → Seeker Dashboard
ADMIN  → Admin Dashboard
```

---

## Tenant Property Flow

```text
Tenant Dashboard
      ↓
Create Property
      ↓
Add Images
      ↓
Validate Required Data
      ↓
PUBLISHED
      ↓
Public Discovery
```

Admin can later:

```text
Unpublish / Reject
```

with a reason.

---

## Tenant Booking Flow

```text
Tenant Dashboard
      ↓
Receive Booking Request
      ↓
Review Request
      ↓
Confirm or Reject
```

Confirm:

```text
CONFIRMED
   ↓
Property unavailable
   ↓
Other pending requests rejected
```

Reject:

```text
REJECTED
   ↓
Property remains available
```

---

## Seeker Flow

```text
Seeker Dashboard
      ↓
Browse/Search/Filter
      ↓
View Property
      ↓
Submit Booking Request
      ↓
PENDING
      ↓
Confirm / Reject
      ↓
Seeker can cancel when permitted
```

---

## Admin Flow

```text
Admin Dashboard
      ↓
Manage Users
      ├── View
      ├── Suspend
      └── Ban

Manage Properties
      ├── View
      ├── Unpublish
      ├── Reject
      └── Archive

Manage Bookings
      └── View Only
```

---

# 10. V1 Core Scope

The first version focuses on four core areas:

```text
Authentication
      +
Property Listings
      +
Property Discovery
      +
Rental Requests
```

Everything else should support these four areas without introducing unnecessary complexity.

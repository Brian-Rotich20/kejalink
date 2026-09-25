# KejaLink — Architecture

## 1. Architecture Overview

KejaLink uses a simple, modular backend architecture:

```text
User
  ↓
Next.js Frontend
  ↓ HTTPS + Session Cookie
Fastify API
  ↓
Routes
  ↓
Controllers
  ↓
Services
  ↓
Drizzle ORM
  ↓
PostgreSQL
```

Supporting services:

```text
Better Auth → Authentication & Sessions
Cloudinary  → Property Images
M-Pesa      → Future Integration
```

The stack remains:

* **Next.js** — frontend
* **Fastify** — backend API
* **TypeScript** — application language
* **Drizzle ORM** — database access
* **PostgreSQL** — database
* **Zod** — validation
* **Better Auth** — authentication/session management
* **Cloudinary** — image storage

No microservices, Elasticsearch, or M-Pesa integration in V1.

---

# 2. Authentication Architecture

Better Auth owns authentication and session management.

There is **one user identity table**, not a separate application users table.

Better Auth manages:

```text
user
session
account
verification
```

The application's custom user fields are added to the Better Auth `user` table:

```text
role
phone
status
```

### Roles

```text
TENANT
SEEKER
ADMIN
```

### Account Status

```text
ACTIVE
SUSPENDED
BANNED
```

Passwords are stored and managed by Better Auth through the `account` table.

The application must **not** maintain its own password field.

---

# 3. Domain Model

KejaLink's main domain tables are:

```text
user
   │
   ├── properties
   │       │
   │       └── uploads
   │
   └── bookings
```

### Properties

Each property belongs to one Tenant:

```text
properties.tenant_id → user.id
```

Important fields include:

```text
id
tenant_id
title
description
property_type
price_amount
price_currency
rent_period
bedrooms
bathrooms
county
area
address_text
latitude
longitude
amenities
status
is_available
rejection_reason
created_at
updated_at
```

### Property Status

```text
DRAFT
PUBLISHED
UNPUBLISHED
REJECTED
ARCHIVED
```

`status` represents the **listing lifecycle**.

`is_available` represents whether the property is **currently available for rent**.

These are intentionally separate.

Example:

```text
status = PUBLISHED
is_available = false
```

means the listing is still visible but the property is currently unavailable.

---

# 4. Property Images / Uploads

The `uploads` table stores property images.

```text
uploads
├── id
├── property_id
├── cloudinary_public_id
├── url
├── is_primary
├── display_order
└── created_at
```

Rules:

* Maximum 10 images per property
* Maximum 5 MB per image
* JPEG, PNG and WebP
* Images stored in Cloudinary
* Store the Cloudinary public ID as well as the URL
* One primary image per property

---

# 5. Booking Architecture

For V1, a booking represents a **rental request**, not a hotel-style reservation.

There is no start/end date range.

```text
bookings
├── id
├── property_id
├── seeker_id
├── status
├── preferred_move_in_date
├── message
├── decision_reason
├── decided_at
├── created_at
└── updated_at
```

### Booking Status

```text
PENDING
CONFIRMED
REJECTED
CANCELLED
```

### Booking Flow

```text
Seeker submits request
        ↓
     PENDING
        ↓
 Tenant confirms/rejects
     ↙       ↘
CONFIRMED   REJECTED
    ↓
Property becomes unavailable
```

When a Tenant confirms a request:

1. Booking becomes `CONFIRMED`
2. Other pending requests for the property are rejected
3. Property becomes `is_available = false`

These operations happen inside **one database transaction**.

---

# 6. Authorization

Authorization is enforced in the **service layer**.

### Tenant

* Create properties
* Manage own properties
* Upload images to own properties
* View booking requests for own properties
* Confirm/reject own property booking requests

### Seeker

* Browse properties
* View property details
* Create booking requests
* View own bookings
* Cancel own bookings

### Admin

* Manage users
* Suspend/ban users
* Manage properties
* Unpublish/reject/archive properties
* View all bookings

Users cannot access another user's resources simply by guessing an ID.

Ownership checks are always performed by the service layer.

---

# 7. Property Publishing

Properties are **published immediately** once the required information and at least one image are provided.

There is no mandatory admin approval queue in V1.

```text
Create Property
      ↓
  PUBLISHED
      ↓
Admin can later
unpublish/reject
if necessary
```

This keeps the V1 marketplace simple and avoids introducing a manual review queue.

---

# 8. Backend Folder Structure

```text
backend/
├── src/
│   ├── config/
│   │   └── env.ts
│   │
│   ├── db/
│   │   ├── schema/
│   │   │   ├── auth.ts
│   │   │   ├── properties.ts
│   │   │   ├── uploads.ts
│   │   │   ├── bookings.ts
│   │   │   └── index.ts
│   │   └── client.ts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   └── auth.ts
│   │   │
│   │   ├── users/
│   │   │   ├── user.routes.ts
│   │   │   ├── user.controller.ts
│   │   │   ├── user.service.ts
│   │   │   └── user.schema.ts
│   │   │
│   │   ├── properties/
│   │   │   ├── property.routes.ts
│   │   │   ├── property.controller.ts
│   │   │   ├── property.service.ts
│   │   │   └── property.schema.ts
│   │   │
│   │   ├── uploads/
│   │   │   ├── upload.routes.ts
│   │   │   ├── upload.controller.ts
│   │   │   ├── upload.service.ts
│   │   │   ├── upload.schema.ts
│   │   │   └── cloudinary.ts
│   │   │
│   │   ├── bookings/
│   │   │   ├── booking.routes.ts
│   │   │   ├── booking.controller.ts
│   │   │   ├── booking.service.ts
│   │   │   └── booking.schema.ts
│   │   │
│   │   └── admin/
│   │       ├── admin.routes.ts
│   │       ├── admin.controller.ts
│   │       └── admin.service.ts
│   │
│   ├── plugins/
│   │   ├── cors.ts
│   │   ├── auth.ts
│   │   └── error-handler.ts
│   │
│   ├── lib/
│   │   ├── response.ts
│   │   └── errors.ts
│   │
│   ├── app.ts
│   └── server.ts
│
├── drizzle/
│   └── migrations/
│
├── tests/
├── .env
├── .env.example
├── .gitignore
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

# 9. Module Responsibilities

Each feature follows:

```text
Route
  ↓
Controller
  ↓
Service
  ↓
Database
```

### Routes

Responsible for:

* HTTP method/path
* Authentication requirement
* Zod schema
* Calling the controller

### Controllers

Responsible for:

* Reading request data
* Calling services
* Returning HTTP responses
* Applying response envelopes

Controllers should remain thin.

### Services

Responsible for:

* Business rules
* Authorization
* Ownership checks
* Transactions
* Database operations

Services should not depend on Fastify request/response objects.

No repository or additional use-case layer is required for V1.

---

# 10. Database Integrity

PostgreSQL is responsible for important data integrity rules.

### Foreign Keys

```text
properties.tenant_id → user.id
uploads.property_id → properties.id
bookings.property_id → properties.id
bookings.seeker_id → user.id
```

### Important Constraints

* Unique user email
* Unique Cloudinary public ID
* One pending booking per Seeker/property
* Foreign keys on all domain relationships
* Indexed ownership and lookup fields

### Booking Confirmation

Confirmation must be transactional:

```text
Verify booking is PENDING
        ↓
Confirm booking
        ↓
Reject other pending requests
        ↓
Set property unavailable
```

If any step fails, the transaction rolls back.

---

# 11. Security

V1 security requirements:

* Better Auth manages password hashing
* Never log passwords
* Use secure, HTTP-only session cookies
* Use explicit CORS origins
* Validate every request with Zod
* Reject unexpected fields
* Enforce authorization in services
* Validate uploaded file type and size server-side
* Limit uploads per property
* Use Cloudinary signed uploads
* Rate-limit authentication endpoints
* Validate environment variables at startup
* Never expose internal errors or stack traces
* Never return session/account internals to clients

---

# 12. MVP Scope

### V1

* Authentication
* Tenant/Seeker/Admin roles
* Property CRUD
* Property search and filters
* Pagination and sorting
* Cloudinary property images
* Property availability
* Booking requests
* Tenant booking management
* Admin user management
* Admin property management
* Admin booking viewing
* Validation
* Authorization
* Centralized error handling

### Deferred

The following are intentionally **not part of V1**:

* M-Pesa/payments
* Deposits/escrow
* Short-stay/date-range reservations
* Elasticsearch
* Advanced geo/map search
* Normalized amenities system
* Mandatory pre-publication review
* Reviews and ratings
* Messaging/chat
* Advanced notifications
* Favorites/saved searches
* Video tours
* Advanced image management

---

# 13. Recommended Implementation Order

```text
1. Project initialization
2. Environment configuration
3. PostgreSQL connection
4. Drizzle configuration
5. Database schema
6. Better Auth setup
7. Database migrations
8. Fastify application setup
9. Error handling + response helpers
10. Authentication integration
11. Authorization
12. Users module
13. Properties module
14. Uploads + Cloudinary
15. Bookings + transactions
16. Admin module
17. Tests
18. Deployment
```

The guiding principle for KejaLink is **simple architecture with strong database integrity and clear business rules**. The V1 should avoid infrastructure and features that are not yet required.

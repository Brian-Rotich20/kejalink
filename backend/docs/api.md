# KejaLink — API Specification

**Base URL:** `/api`
**Format:** JSON
**Authentication:** Better Auth session cookie for authenticated first-party requests.

The API is internally organized as **Routes → Controllers → Services**. This document defines the public API contract only.

---

## 1. Authentication

Better Auth handles password hashing and session management.

| Method | Endpoint             | Description                    |
| ------ | -------------------- | ------------------------------ |
| `POST` | `/api/auth/register` | Register as Tenant or Seeker   |
| `POST` | `/api/auth/login`    | Login                          |
| `POST` | `/api/auth/logout`   | Logout                         |
| `GET`  | `/api/auth/me`       | Get current authenticated user |

### Register

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "0712345678",
  "password": "password",
  "accountType": "TENANT"
}
```

`accountType`: `TENANT | SEEKER`

Admin accounts are created or promoted internally and are **not available during public registration**.

---

## 2. Users

| Method  | Endpoint        | Description        |
| ------- | --------------- | ------------------ |
| `GET`   | `/api/users/me` | Get own profile    |
| `PATCH` | `/api/users/me` | Update own profile |

Allowed update fields:

```json
{
  "name": "John Doe",
  "phone": "0712345678",
  "image": "https://..."
}
```

`role` and `status` cannot be changed through this endpoint.

---

## 3. Properties

| Method   | Endpoint              | Access             | Description                 |
| -------- | --------------------- | ------------------ | --------------------------- |
| `GET`    | `/api/properties`     | Public             | Browse published properties |
| `GET`    | `/api/properties/me`  | Tenant             | Get own properties          |
| `GET`    | `/api/properties/:id` | Public/Owner/Admin | Get property details        |
| `POST`   | `/api/properties`     | Tenant             | Create property             |
| `PATCH`  | `/api/properties/:id` | Tenant/Admin       | Update property             |
| `DELETE` | `/api/properties/:id` | Tenant/Admin       | Archive property            |

### Public Property Search

```http
GET /api/properties
```

Supported filters:

```text
county
area
propertyType
minPrice
maxPrice
bedrooms
page
limit
sort
```

Defaults:

```text
page = 1
limit = 20
maximum limit = 50
sort = newest
```

Supported sorting:

```text
newest
price_asc
price_desc
```

Public search returns **`PUBLISHED` properties only**.

`status` and availability are not exposed as public filters.

Tenants use:

```http
GET /api/properties/me
```
to view their properties regardless of status.

### Route Ordering

Register:

```http
GET /api/properties/me
```

**before**

```http
GET /api/properties/:id
```

Otherwise Fastify may interpret `me` as an `id`.

The same applies to:

```http
GET /api/bookings/me
GET /api/bookings/:id
```

---

## 4. Property Uploads

| Method   | Endpoint                                | Access         |
| -------- | --------------------------------------- | -------------- |
| `POST`   | `/api/properties/:id/uploads`           | Property owner |
| `PATCH`  | `/api/properties/:id/uploads/:uploadId` | Property owner |
| `DELETE` | `/api/properties/:id/uploads/:uploadId` | Property owner |

Upload requirements:

* Maximum **10 images per property**
* Maximum **5 MB per image**
* Allowed types:

  * JPEG
  * PNG
  * WebP
* Cloudinary is used for image storage.
* Uploads may use multipart or signed-upload flow.

Upload metadata:

```json
{
  "isPrimary": true,
  "displayOrder": 1
}
```

---

## 5. Bookings

| Method  | Endpoint                    | Access              | Description            |
| ------- | --------------------------- | ------------------- | ---------------------- |
| `POST`  | `/api/bookings`             | Seeker              | Create booking request |
| `GET`   | `/api/bookings/me`          | Seeker              | Own booking requests   |
| `GET`   | `/api/bookings/received`    | Tenant              | Incoming requests      |
| `GET`   | `/api/bookings/:id`         | Seeker/Tenant/Admin | View booking           |
| `PATCH` | `/api/bookings/:id/cancel`  | Seeker              | Cancel booking         |
| `PATCH` | `/api/bookings/:id/confirm` | Tenant              | Confirm request        |
| `PATCH` | `/api/bookings/:id/reject`  | Tenant              | Reject request         |

### Create Booking

```json
{
  "propertyId": "property-id",
  "preferredMoveInDate": "2026-10-01",
  "message": "I would like to move in next month."
}
```
### Booking Rules

* Only Seekers can create booking requests.
* A Seeker can only access their own bookings.
* A Tenant can only manage bookings for their own properties.
* Cancellation is allowed while `PENDING` or `CONFIRMED`.
* Only `PENDING` bookings can be confirmed or rejected.
* Duplicate/conflicting booking requests return `409 Conflict`.

---
## 6. Admin

### Users

| Method  | Endpoint               | Description        |
| ------- | ---------------------- | ------------------ |
| `GET`   | `/api/admin/users`     | List users         |
| `GET`   | `/api/admin/users/:id` | View user          |
| `PATCH` | `/api/admin/users/:id` | Change user status |

Supported statuses:

```text
ACTIVE
SUSPENDED
BANNED
```

This endpoint changes **status only**.

Role changes require a separate, more restricted administrative action.

### Properties

| Method   | Endpoint                              | Description            |
| -------- | ------------------------------------- | ---------------------- |
| `GET`    | `/api/admin/properties`               | List/manage properties |
| `PATCH`  | `/api/admin/properties/:id/unpublish` | Unpublish property     |
| `PATCH`  | `/api/admin/properties/:id/reject`    | Reject property        |
| `DELETE` | `/api/admin/properties/:id`           | Archive property       |

Reject requires:

```json
{
  "reason": "Property information violates platform requirements."
}
```

### Bookings

```http
GET /api/admin/bookings
```

Admin booking access is **view-only** and supports filtering by:

* status
* property
* user

---

## 7. Property Publishing Model

Properties are published **immediately after submission**.

There is currently **no mandatory admin approval queue**.

```text
Property Created
      ↓
  PUBLISHED
      ↓
 ┌────┴─────┐
 ↓          ↓
Unpublish  Archive
```

Admin can remove a property from public visibility using:

```http
PATCH /api/admin/properties/:id/unpublish
PATCH /api/admin/properties/:id/reject
```

If a mandatory pre-publication review process is introduced later, an approval endpoint can be added at that time.

---

# 8. Response Format

## Single Resource

```json
{
  "success": true,
  "data": {
    "id": "123",
    "title": "Modern Apartment"
  }
}
```

## Paginated Response

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 137,
    "totalPages": 7
  }
}
```

## Error Response

```json
{
  "success": false,
  "error": {
    "code": "PROPERTY_NOT_AVAILABLE",
    "message": "This property is not currently accepting booking requests.",
    "details": null
  }
}
```

### Error Codes

Common codes include:

```text
VALIDATION_ERROR
NOT_FOUND
UNAUTHORIZED
FORBIDDEN
DUPLICATE_BOOKING
PROPERTY_NOT_AVAILABLE
CONFLICT
INTERNAL_ERROR
```

`details` contains field-level Zod validation errors when:

```text
code = VALIDATION_ERROR
```

Otherwise:

```json
"details": null
```

---

# 9. HTTP Status Codes

| Status | Usage                                    |
| ------ | ---------------------------------------- |
| `200`  | Successful read/update                   |
| `201`  | Resource created                         |
| `400`  | Malformed request / invalid JSON         |
| `401`  | Missing or invalid authentication        |
| `403`  | Authenticated but not authorized         |
| `404`  | Resource not found                       |
| `409`  | Resource/state conflict                  |
| `422`  | Valid request structure but invalid data |
| `429`  | Rate limit exceeded                      |
| `500`  | Unexpected server error                  |

### 400 vs 422

Use **400** for structurally malformed requests, such as invalid JSON.

Use **422** for valid JSON that fails application/schema validation, such as:

* Invalid email
* Missing required field
* Invalid property type
* Invalid price

This allows the frontend to reliably handle field-level validation errors.

---

# 10. API Design Principles

KejaLink's V1 API follows these principles:

1. **Better Auth handles authentication and sessions.**
2. **Backend authorization is always enforced.**
3. **Tenants can only manage their own properties.**
4. **Seekers can only manage their own bookings.**
5. **Admins manage platform resources.**
6. **Public property search returns published listings only.**
7. **List endpoints are paginated.**
8. **Property search supports basic PostgreSQL filtering in V1.**
9. **Errors use stable machine-readable codes.**
10. **Properties are soft-deleted/archived rather than physically removed.**
11. **Cloudinary handles property image storage.**
12. **The API remains simple enough to extend later without introducing unnecessary infrastructure.**

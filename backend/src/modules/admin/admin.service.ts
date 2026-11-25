import { and, count, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { bookings, properties, session, uploads, user } from "../../db/schema";
import { userRoleSchema, userStatusSchema, type UserStatus } from "../../db/schema/enums";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { Page } from "../../lib/response";
import { containsPattern, offsetFor, toMoney } from "../../lib/validation";
import { listAllBookings } from "../bookings/booking.service";
import type { AdminBookingFilters } from "../bookings/booking.types";
import {
  getPropertyById,
  lockProperty,
  propertyNotFound,
  rejectPendingBookings,
} from "../properties/property.service";
import type { PropertyDetail } from "../properties/property.types";
import type {
  AdminPropertyFilters,
  AdminPropertyView,
  AdminUserFilters,
  AdminUserView,
} from "./admin.types";

export const ADMIN_REMOVED_REASON = "This listing was removed by an administrator";

const userNotFound = () => new NotFoundError("User not found", "USER_NOT_FOUND");

// ── Users ────────────────────────────────────────────────────────────────────

const userColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  image: user.image,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

const toUserView = (row: Omit<AdminUserView, "role" | "status"> & { role: string; status: string }): AdminUserView => ({
  ...row,
  role: userRoleSchema.parse(row.role),
  status: userStatusSchema.parse(row.status),
});

export async function listUsers(filters: AdminUserFilters): Promise<Page<AdminUserView>> {
  const conditions: (SQL | undefined)[] = [
    filters.role ? eq(user.role, filters.role) : undefined,
    filters.status ? eq(user.status, filters.status) : undefined,
    filters.q ? or(ilike(user.name, containsPattern(filters.q)), ilike(user.email, containsPattern(filters.q))) : undefined,
  ];
  const where = and(...conditions);

  const [rows, [totals]] = await Promise.all([
    db
      .select(userColumns)
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(filters.limit)
      .offset(offsetFor(filters)),
    db.select({ total: count() }).from(user).where(where),
  ]);
  return { items: rows.map(toUserView), page: filters.page, limit: filters.limit, total: totals?.total ?? 0 };
}

export async function getUserById(id: string): Promise<AdminUserView> {
  const [row] = await db.select(userColumns).from(user).where(eq(user.id, id));
  if (!row) throw userNotFound();
  return toUserView(row);
}

/**
 * Change a user's status. SUSPENDED/BANNED also deletes every session of that
 * user in the same transaction, so live cookies stop working immediately.
 * Admins cannot target themselves or another ADMIN.
 */
export async function setUserStatus(
  adminId: string,
  targetId: string,
  status: UserStatus,
): Promise<{ user: AdminUserView; sessionsRevoked: number }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, targetId))
      .for("update");
    if (!target) throw userNotFound();
    if (target.id === adminId || target.role === "ADMIN") {
      throw new ForbiddenError("Administrators cannot be modified through this endpoint", "CANNOT_MODIFY_ADMIN");
    }

    const [row] = await tx.update(user).set({ status }).where(eq(user.id, targetId)).returning(userColumns);
    let sessionsRevoked = 0;
    if (status !== "ACTIVE") {
      const revoked = await tx.delete(session).where(eq(session.userId, targetId)).returning({ id: session.id });
      sessionsRevoked = revoked.length;
    }
    return { user: toUserView(row!), sessionsRevoked };
  });
}

// ── Properties ───────────────────────────────────────────────────────────────

export async function listProperties(filters: AdminPropertyFilters): Promise<Page<AdminPropertyView>> {
  const where = and(
    filters.status ? eq(properties.status, filters.status) : undefined,
    filters.tenantId ? eq(properties.tenantId, filters.tenantId) : undefined,
    filters.includeDeleted ? undefined : isNull(properties.deletedAt),
  );

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: properties.id,
        tenantId: properties.tenantId,
        title: properties.title,
        propertyType: properties.propertyType,
        priceAmount: properties.priceAmount,
        priceCurrency: properties.priceCurrency,
        bedrooms: properties.bedrooms,
        bathrooms: properties.bathrooms,
        county: properties.county,
        area: properties.area,
        isAvailable: properties.isAvailable,
        primaryImageUrl: uploads.url,
        createdAt: properties.createdAt,
        status: properties.status,
        rejectionReason: properties.rejectionReason,
        deletedAt: properties.deletedAt,
        updatedAt: properties.updatedAt,
        tenantName: user.name,
        tenantEmail: user.email,
        tenantStatus: user.status,
      })
      .from(properties)
      .innerJoin(user, eq(user.id, properties.tenantId))
      .leftJoin(uploads, and(eq(uploads.propertyId, properties.id), eq(uploads.isPrimary, true)))
      .where(where)
      .orderBy(desc(properties.createdAt), desc(properties.id))
      .limit(filters.limit)
      .offset(offsetFor(filters)),
    db.select({ total: count() }).from(properties).where(where),
  ]);

  return {
    items: rows.map(({ tenantName, tenantEmail, tenantStatus, ...row }) => ({
      ...row,
      priceAmount: toMoney(row.priceAmount),
      tenant: { id: row.tenantId, name: tenantName, email: tenantEmail, status: userStatusSchema.parse(tenantStatus) },
    })),
    page: filters.page,
    limit: filters.limit,
    total: totals?.total ?? 0,
  };
}

const adminViewer = (adminId: string) => ({ id: adminId, role: "ADMIN" as const });

/** Hide a listing from discovery with a reason; its pending requests are rejected. */
export async function rejectProperty(
  adminId: string,
  propertyId: string,
  reason: string,
): Promise<{ property: PropertyDetail; bookingsRejected: number }> {
  const bookingsRejected = await db.transaction(async (tx) => {
    const property = await lockProperty(tx, propertyId);
    if (!property || property.deletedAt) throw propertyNotFound();
    await tx
      .update(properties)
      .set({ status: "REJECTED", rejectionReason: reason })
      .where(eq(properties.id, propertyId));
    return rejectPendingBookings(tx, propertyId, ADMIN_REMOVED_REASON);
  });
  return { property: await getPropertyById(propertyId, adminViewer(adminId)), bookingsRejected };
}

/** Undo a rejection: back to PUBLISHED, reason cleared. */
export async function restoreProperty(adminId: string, propertyId: string): Promise<PropertyDetail> {
  await db.transaction(async (tx) => {
    const property = await lockProperty(tx, propertyId);
    if (!property || property.deletedAt) throw propertyNotFound();
    if (property.status !== "REJECTED") {
      throw new ConflictError("Only rejected properties can be restored", "PROPERTY_NOT_REJECTED");
    }
    await tx
      .update(properties)
      .set({ status: "PUBLISHED", rejectionReason: null })
      .where(eq(properties.id, propertyId));
  });
  return getPropertyById(propertyId, adminViewer(adminId));
}

/** Admin soft delete: pending requests REJECTED, confirmed bookings CANCELLED, both with a reason. */
export async function deleteProperty(
  propertyId: string,
): Promise<{ id: string; deletedAt: Date; bookingsRejected: number; bookingsCancelled: number }> {
  return db.transaction(async (tx) => {
    const property = await lockProperty(tx, propertyId);
    if (!property || property.deletedAt) throw propertyNotFound();

    const bookingsRejected = await rejectPendingBookings(tx, propertyId, ADMIN_REMOVED_REASON);
    const cancelled = await tx
      .update(bookings)
      .set({ status: "CANCELLED", decisionReason: ADMIN_REMOVED_REASON, decidedAt: new Date() })
      .where(and(eq(bookings.propertyId, propertyId), eq(bookings.status, "CONFIRMED")))
      .returning({ id: bookings.id });

    const deletedAt = new Date();
    await tx.update(properties).set({ deletedAt }).where(eq(properties.id, propertyId));
    return { id: propertyId, deletedAt, bookingsRejected, bookingsCancelled: cancelled.length };
  });
}

// ── Bookings (read-only) ─────────────────────────────────────────────────────

export const listBookings = (adminId: string, filters: AdminBookingFilters) =>
  listAllBookings(adminViewer(adminId), filters);

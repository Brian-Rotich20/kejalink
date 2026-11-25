import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "../../db/client";
import { bookings, properties, uploads, user, type NewProperty } from "../../db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { Page } from "../../lib/response";
import { containsPattern, fromMoney, offsetFor, toMoney } from "../../lib/validation";
import type {
  CreatePropertyInput,
  OwnerPropertyListItem,
  PropertyDetail,
  PropertyFilters,
  PropertyImage,
  PropertyListItem,
  UpdatePropertyInput,
  Viewer,
} from "./property.types";

export const OWNER_REMOVED_REASON = "This listing was removed by the owner";

export const propertyNotFound = () => new NotFoundError("Property not found", "PROPERTY_NOT_FOUND");
const notOwner = () => new ForbiddenError("You can only manage your own properties", "NOT_PROPERTY_OWNER");
export const hasConfirmedBookingError = () =>
  new ConflictError(
    "This property has a confirmed booking; the seeker must cancel it first",
    "PROPERTY_HAS_CONFIRMED_BOOKING",
  );

// ── Shared helpers (also used by uploads, bookings and admin) ───────────────

export type LockedProperty = {
  id: string;
  tenantId: string;
  status: "PUBLISHED" | "REJECTED";
  isAvailable: boolean;
  deletedAt: Date | null;
};

/**
 * Lock a property row. Global lock order: property row FIRST, then booking rows.
 * FOR UPDATE for writers; FOR SHARE for booking creation (blocks confirm/delete,
 * not other creators).
 */
export async function lockProperty(
  tx: Tx,
  propertyId: string,
  mode: "update" | "share" = "update",
): Promise<LockedProperty | null> {
  const [row] = await tx
    .select({
      id: properties.id,
      tenantId: properties.tenantId,
      status: properties.status,
      isAvailable: properties.isAvailable,
      deletedAt: properties.deletedAt,
    })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .for(mode);
  return row ?? null;
}

/** Lock a live (non-deleted) property the actor owns: 404 if missing/deleted, 403 if not the owner. */
export async function lockOwnedProperty(tx: Tx, propertyId: string, ownerId: string) {
  const property = await lockProperty(tx, propertyId);
  if (!property || property.deletedAt) throw propertyNotFound();
  if (property.tenantId !== ownerId) throw notOwner();
  return property;
}

/** Unlocked ownership check, used before expensive work (e.g. reading an upload). */
export async function assertOwnsLiveProperty(propertyId: string, ownerId: string): Promise<void> {
  const [row] = await db
    .select({ tenantId: properties.tenantId, deletedAt: properties.deletedAt })
    .from(properties)
    .where(eq(properties.id, propertyId));
  if (!row || row.deletedAt) throw propertyNotFound();
  if (row.tenantId !== ownerId) throw notOwner();
}

export async function hasConfirmedBooking(conn: DbOrTx, propertyId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.propertyId, propertyId), eq(bookings.status, "CONFIRMED")))
    .limit(1);
  return row !== undefined;
}

/** Reject every PENDING booking of a property. Caller must hold the property lock. */
export async function rejectPendingBookings(tx: Tx, propertyId: string, reason: string): Promise<number> {
  const rows = await tx
    .update(bookings)
    .set({ status: "REJECTED", decisionReason: reason, decidedAt: new Date() })
    .where(and(eq(bookings.propertyId, propertyId), eq(bookings.status, "PENDING")))
    .returning({ id: bookings.id });
  return rows.length;
}

// ── Queries ──────────────────────────────────────────────────────────────────

const listColumns = {
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
};

/** At most one primary upload per property (partial unique index), so this join never multiplies rows. */
const primaryImageJoin = and(eq(uploads.propertyId, properties.id), eq(uploads.isPrimary, true));

const toListItem = <T extends { priceAmount: string; primaryImageUrl: string | null }>(row: T) => ({
  ...row,
  priceAmount: toMoney(row.priceAmount),
});

const publicVisibility = (): SQL[] => [
  eq(properties.status, "PUBLISHED"),
  isNull(properties.deletedAt),
  eq(user.status, "ACTIVE"),
];

function filterConditions(f: PropertyFilters): SQL[] {
  const conditions: SQL[] = [];
  if (f.q) {
    const pattern = containsPattern(f.q);
    const anyText = or(
      ilike(properties.title, pattern),
      ilike(properties.description, pattern),
      ilike(properties.area, pattern),
      ilike(properties.county, pattern),
    );
    if (anyText) conditions.push(anyText);
  }
  if (f.county) conditions.push(sql`lower(${properties.county}) = lower(${f.county})`);
  if (f.area) conditions.push(ilike(properties.area, containsPattern(f.area)));
  if (f.propertyType) conditions.push(eq(properties.propertyType, f.propertyType));
  if (f.minPrice !== undefined) conditions.push(gte(properties.priceAmount, fromMoney(f.minPrice)));
  if (f.maxPrice !== undefined) conditions.push(lte(properties.priceAmount, fromMoney(f.maxPrice)));
  if (f.bedrooms !== undefined) conditions.push(eq(properties.bedrooms, f.bedrooms));
  if (f.available !== undefined) conditions.push(eq(properties.isAvailable, f.available));
  return conditions;
}

/** Stable ordering: id is always the final tiebreaker. */
function orderFor(sort: PropertyFilters["sort"]): SQL[] {
  switch (sort) {
    case "price_asc":
      return [asc(properties.priceAmount), asc(properties.id)];
    case "price_desc":
      return [desc(properties.priceAmount), desc(properties.id)];
    default:
      return [desc(properties.createdAt), desc(properties.id)];
  }
}

/** Public discovery: PUBLISHED, not deleted, tenant ACTIVE. */
export async function listPublicProperties(filters: PropertyFilters): Promise<Page<PropertyListItem>> {
  const where = and(...publicVisibility(), ...filterConditions(filters));

  const [rows, [totals]] = await Promise.all([
    db
      .select(listColumns)
      .from(properties)
      .innerJoin(user, eq(user.id, properties.tenantId))
      .leftJoin(uploads, primaryImageJoin)
      .where(where)
      .orderBy(...orderFor(filters.sort))
      .limit(filters.limit)
      .offset(offsetFor(filters)),
    db
      .select({ total: count() })
      .from(properties)
      .innerJoin(user, eq(user.id, properties.tenantId))
      .where(where),
  ]);

  return { items: rows.map(toListItem), page: filters.page, limit: filters.limit, total: totals?.total ?? 0 };
}

/** The tenant's own non-deleted listings, any status. */
export async function listOwnProperties(
  tenantId: string,
  pagination: { page: number; limit: number },
): Promise<Page<OwnerPropertyListItem>> {
  const where = and(eq(properties.tenantId, tenantId), isNull(properties.deletedAt));

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        ...listColumns,
        status: properties.status,
        rejectionReason: properties.rejectionReason,
        updatedAt: properties.updatedAt,
      })
      .from(properties)
      .leftJoin(uploads, primaryImageJoin)
      .where(where)
      .orderBy(desc(properties.createdAt), desc(properties.id))
      .limit(pagination.limit)
      .offset(offsetFor(pagination)),
    db.select({ total: count() }).from(properties).where(where),
  ]);

  return { items: rows.map(toListItem), ...pagination, total: totals?.total ?? 0 };
}

export async function listPropertyImages(conn: DbOrTx, propertyId: string): Promise<PropertyImage[]> {
  return conn
    .select({
      id: uploads.id,
      url: uploads.url,
      isPrimary: uploads.isPrimary,
      displayOrder: uploads.displayOrder,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .where(eq(uploads.propertyId, propertyId))
    .orderBy(asc(uploads.displayOrder), asc(uploads.createdAt), asc(uploads.id));
}

/**
 * Visibility: public if PUBLISHED, not deleted and tenant ACTIVE; the owner also
 * sees REJECTED; admins see everything including deleted. Otherwise 404, never 403.
 */
export async function getPropertyById(id: string, viewer: Viewer): Promise<PropertyDetail> {
  const [row] = await db
    .select({
      id: properties.id,
      tenantId: properties.tenantId,
      title: properties.title,
      description: properties.description,
      propertyType: properties.propertyType,
      priceAmount: properties.priceAmount,
      priceCurrency: properties.priceCurrency,
      bedrooms: properties.bedrooms,
      bathrooms: properties.bathrooms,
      county: properties.county,
      area: properties.area,
      addressText: properties.addressText,
      amenities: properties.amenities,
      status: properties.status,
      isAvailable: properties.isAvailable,
      rejectionReason: properties.rejectionReason,
      deletedAt: properties.deletedAt,
      createdAt: properties.createdAt,
      updatedAt: properties.updatedAt,
      tenantName: user.name,
      tenantImage: user.image,
      tenantStatus: user.status,
    })
    .from(properties)
    .innerJoin(user, eq(user.id, properties.tenantId))
    .where(eq(properties.id, id));

  if (!row) throw propertyNotFound();

  const isAdmin = viewer?.role === "ADMIN";
  const isOwner = viewer !== null && viewer.id === row.tenantId;
  const isPublic = row.status === "PUBLISHED" && row.tenantStatus === "ACTIVE";
  const visible = isAdmin || (row.deletedAt === null && (isOwner || isPublic));
  if (!visible) throw propertyNotFound();

  const { tenantName, tenantImage, tenantStatus: _tenantStatus, rejectionReason, deletedAt, ...rest } = row;
  const detail: PropertyDetail = {
    ...rest,
    priceAmount: toMoney(row.priceAmount),
    tenant: { id: row.tenantId, name: tenantName, image: tenantImage },
    uploads: await listPropertyImages(db, id),
  };
  if (isAdmin || isOwner) detail.rejectionReason = rejectionReason;
  if (isAdmin) detail.deletedAt = deletedAt;
  return detail;
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Listings go live immediately (PUBLISHED), with zero or more images added later. */
export async function createProperty(tenantId: string, input: CreatePropertyInput): Promise<PropertyDetail> {
  const values: NewProperty = {
    tenantId,
    title: input.title,
    description: input.description,
    propertyType: input.propertyType,
    priceAmount: fromMoney(input.priceAmount),
    county: input.county,
    area: input.area,
    bedrooms: input.bedrooms ?? null,
    bathrooms: input.bathrooms ?? null,
    addressText: input.addressText ?? null,
    amenities: input.amenities ?? [],
    status: "PUBLISHED",
  };
  const [row] = await db.insert(properties).values(values).returning({ id: properties.id });
  return getPropertyById(row!.id, { id: tenantId, role: "TENANT" });
}

function toChanges(input: UpdatePropertyInput): Partial<NewProperty> {
  const changes: Partial<NewProperty> = {};
  if (input.title !== undefined) changes.title = input.title;
  if (input.description !== undefined) changes.description = input.description;
  if (input.propertyType !== undefined) changes.propertyType = input.propertyType;
  if (input.priceAmount !== undefined) changes.priceAmount = fromMoney(input.priceAmount);
  if (input.bedrooms !== undefined) changes.bedrooms = input.bedrooms;
  if (input.bathrooms !== undefined) changes.bathrooms = input.bathrooms;
  if (input.county !== undefined) changes.county = input.county;
  if (input.area !== undefined) changes.area = input.area;
  if (input.addressText !== undefined) changes.addressText = input.addressText;
  if (input.amenities !== undefined) changes.amenities = input.amenities;
  if (input.isAvailable !== undefined) changes.isAvailable = input.isAvailable;
  return changes;
}

/**
 * Owner edit. Status never changes here (REJECTED listings stay REJECTED).
 * Re-opening availability while a CONFIRMED booking exists is a 409.
 */
export async function updateProperty(
  id: string,
  ownerId: string,
  input: UpdatePropertyInput,
): Promise<PropertyDetail> {
  await db.transaction(async (tx) => {
    await lockOwnedProperty(tx, id, ownerId);

    const changes = toChanges(input);
    if (Object.keys(changes).length === 0) return; // empty body: no-op

    if (changes.isAvailable === true && (await hasConfirmedBooking(tx, id))) {
      throw hasConfirmedBookingError();
    }
    await tx.update(properties).set(changes).where(eq(properties.id, id));
  });
  return getPropertyById(id, { id: ownerId, role: "TENANT" });
}

/** Owner soft delete: blocked by a CONFIRMED booking; PENDING requests are rejected. */
export async function deleteProperty(id: string, ownerId: string): Promise<{ id: string; deletedAt: Date }> {
  return db.transaction(async (tx) => {
    await lockOwnedProperty(tx, id, ownerId);
    if (await hasConfirmedBooking(tx, id)) throw hasConfirmedBookingError();

    await rejectPendingBookings(tx, id, OWNER_REMOVED_REASON);
    const deletedAt = new Date();
    await tx.update(properties).set({ deletedAt }).where(eq(properties.id, id));
    return { id, deletedAt };
  });
}

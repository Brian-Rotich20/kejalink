import { and, count, desc, eq, ne, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbOrTx, type Tx } from "../../db/client";
import { bookings, properties, uploads, user } from "../../db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { isUniqueViolation } from "../../lib/db";
import type { Page } from "../../lib/response";
import { offsetFor, toMoney } from "../../lib/validation";
import { lockProperty, propertyNotFound } from "../properties/property.service";
import type {
  AdminBookingFilters,
  BookingListFilters,
  BookingView,
  BookingViewer,
  CreateBookingInput,
} from "./booking.types";

export const ANOTHER_ACCEPTED_REASON = "Another request for this property was accepted";

const PENDING_UNIQUE = "bookings_one_pending_per_seeker_property_idx";
const CONFIRMED_UNIQUE = "bookings_one_confirmed_per_property_idx";

const bookingNotFound = () => new NotFoundError("Booking not found", "BOOKING_NOT_FOUND");
const duplicateBooking = () =>
  new ConflictError("You already have a pending request for this property", "DUPLICATE_BOOKING");
const propertyNotAvailable = () =>
  new ConflictError("This property is not currently accepting booking requests", "PROPERTY_NOT_AVAILABLE");
const notPending = () => new ConflictError("Only pending requests can be confirmed or rejected", "BOOKING_NOT_PENDING");
const notCancellable = () =>
  new ConflictError("Only pending or confirmed bookings can be cancelled", "BOOKING_NOT_CANCELLABLE");

// ── Reads ────────────────────────────────────────────────────────────────────

const seekerUser = alias(user, "seeker_user");
const tenantUser = alias(user, "tenant_user");

const bookingColumns = {
  id: bookings.id,
  status: bookings.status,
  preferredMoveInDate: bookings.preferredMoveInDate,
  message: bookings.message,
  decisionReason: bookings.decisionReason,
  decidedAt: bookings.decidedAt,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
  propertyId: properties.id,
  propertyTitle: properties.title,
  propertyCounty: properties.county,
  propertyArea: properties.area,
  propertyPrice: properties.priceAmount,
  propertyCurrency: properties.priceCurrency,
  propertyAvailable: properties.isAvailable,
  propertyImage: uploads.url,
  seekerId: seekerUser.id,
  seekerName: seekerUser.name,
  seekerEmail: seekerUser.email,
  seekerImage: seekerUser.image,
  tenantId: tenantUser.id,
  tenantName: tenantUser.name,
  tenantEmail: tenantUser.email,
  tenantImage: tenantUser.image,
};

const selectBookings = (conn: DbOrTx) =>
  conn
    .select(bookingColumns)
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .innerJoin(seekerUser, eq(seekerUser.id, bookings.seekerId))
    .innerJoin(tenantUser, eq(tenantUser.id, properties.tenantId))
    .leftJoin(uploads, and(eq(uploads.propertyId, properties.id), eq(uploads.isPrimary, true)));

type BookingRow = Awaited<ReturnType<ReturnType<typeof selectBookings>["execute"]>>[number];

function toView(row: BookingRow, viewer: BookingViewer): BookingView {
  const showTenantEmail =
    viewer.role === "ADMIN" || viewer.id === row.tenantId || row.status === "CONFIRMED";
  return {
    id: row.id,
    status: row.status,
    preferredMoveInDate: row.preferredMoveInDate,
    message: row.message,
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    property: {
      id: row.propertyId,
      title: row.propertyTitle,
      county: row.propertyCounty,
      area: row.propertyArea,
      priceAmount: toMoney(row.propertyPrice),
      priceCurrency: row.propertyCurrency,
      isAvailable: row.propertyAvailable,
      primaryImageUrl: row.propertyImage,
    },
    seeker: { id: row.seekerId, name: row.seekerName, email: row.seekerEmail, image: row.seekerImage },
    tenant: {
      id: row.tenantId,
      name: row.tenantName,
      image: row.tenantImage,
      ...(showTenantEmail ? { email: row.tenantEmail } : {}),
    },
  };
}

async function listWhere(
  where: SQL | undefined,
  filters: { page: number; limit: number },
  viewer: BookingViewer,
): Promise<Page<BookingView>> {
  const [rows, [totals]] = await Promise.all([
    selectBookings(db)
      .where(where)
      .orderBy(desc(bookings.createdAt), desc(bookings.id))
      .limit(filters.limit)
      .offset(offsetFor(filters)),
    db
      .select({ total: count() })
      .from(bookings)
      .innerJoin(properties, eq(properties.id, bookings.propertyId))
      .where(where),
  ]);
  return {
    items: rows.map((row) => toView(row, viewer)),
    page: filters.page,
    limit: filters.limit,
    total: totals?.total ?? 0,
  };
}

const statusFilter = (status: BookingListFilters["status"]) => (status ? eq(bookings.status, status) : undefined);

/** A seeker's own requests. */
export const listSeekerBookings = (viewer: BookingViewer, filters: BookingListFilters) =>
  listWhere(and(eq(bookings.seekerId, viewer.id), statusFilter(filters.status)), filters, viewer);

/** Requests received on the tenant's properties (including deleted listings, for history). */
export const listReceivedBookings = (viewer: BookingViewer, filters: BookingListFilters) =>
  listWhere(and(eq(properties.tenantId, viewer.id), statusFilter(filters.status)), filters, viewer);

/** Admin, read-only. */
export const listAllBookings = (viewer: BookingViewer, filters: AdminBookingFilters) =>
  listWhere(
    and(
      statusFilter(filters.status),
      filters.propertyId ? eq(bookings.propertyId, filters.propertyId) : undefined,
      filters.seekerId ? eq(bookings.seekerId, filters.seekerId) : undefined,
    ),
    filters,
    viewer,
  );

/** Participants (seeker, property owner) and admins only; everyone else gets 404. */
export async function getBooking(id: string, viewer: BookingViewer, conn: DbOrTx = db): Promise<BookingView> {
  const [row] = await selectBookings(conn).where(eq(bookings.id, id));
  if (!row) throw bookingNotFound();
  const participant = viewer.role === "ADMIN" || viewer.id === row.seekerId || viewer.id === row.tenantId;
  if (!participant) throw bookingNotFound();
  return toView(row, viewer);
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function createBooking(seekerId: string, input: CreateBookingInput): Promise<BookingView> {
  let bookingId: string;
  try {
    bookingId = await db.transaction(async (tx) => {
      // FOR SHARE: concurrent requests may proceed, confirm/delete (FOR UPDATE) wait.
      const property = await lockProperty(tx, input.propertyId, "share");
      if (!property || property.deletedAt || property.status !== "PUBLISHED") throw propertyNotFound();

      const [tenant] = await tx.select({ status: user.status }).from(user).where(eq(user.id, property.tenantId));
      if (tenant?.status !== "ACTIVE") throw propertyNotFound();

      if (property.tenantId === seekerId) {
        throw new ForbiddenError("You cannot request your own property", "OWN_PROPERTY");
      }
      if (!property.isAvailable) throw propertyNotAvailable();

      const [existing] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(eq(bookings.propertyId, property.id), eq(bookings.seekerId, seekerId), eq(bookings.status, "PENDING")),
        )
        .limit(1);
      if (existing) throw duplicateBooking();

      const [row] = await tx
        .insert(bookings)
        .values({
          propertyId: property.id,
          seekerId,
          preferredMoveInDate: input.preferredMoveInDate ?? null,
          message: input.message ?? null,
        })
        .returning({ id: bookings.id });
      return row!.id;
    });
  } catch (err) {
    // Two simultaneous requests both pass the pre-check; the partial unique index decides.
    if (isUniqueViolation(err, PENDING_UNIQUE)) throw duplicateBooking();
    throw err;
  }
  return getBooking(bookingId, { id: seekerId, role: "SEEKER" });
}

/**
 * Lock order: property row FIRST, then the booking row. The booking's
 * property_id is read without a lock (it never changes) to find the property.
 */
async function lockForDecision(tx: Tx, bookingId: string) {
  const [ref] = await tx
    .select({ propertyId: bookings.propertyId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!ref) throw bookingNotFound();

  const property = await lockProperty(tx, ref.propertyId, "update");
  const [booking] = await tx
    .select({ id: bookings.id, status: bookings.status, seekerId: bookings.seekerId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  if (!property || !booking) throw bookingNotFound();
  return { property, booking };
}

export async function confirmBooking(bookingId: string, tenantId: string): Promise<BookingView> {
  const viewer: BookingViewer = { id: tenantId, role: "TENANT" };
  try {
    await db.transaction(async (tx) => {
      const { property, booking } = await lockForDecision(tx, bookingId);
      if (property.tenantId !== tenantId) throw bookingNotFound();
      if (booking.status !== "PENDING") throw notPending();
      if (property.deletedAt || property.status !== "PUBLISHED" || !property.isAvailable) {
        throw propertyNotAvailable();
      }

      const now = new Date();
      const confirmed = await tx
        .update(bookings)
        .set({ status: "CONFIRMED", decidedAt: now })
        .where(and(eq(bookings.id, bookingId), eq(bookings.status, "PENDING")))
        .returning({ id: bookings.id });
      if (confirmed.length === 0) throw notPending();

      await tx
        .update(bookings)
        .set({ status: "REJECTED", decisionReason: ANOTHER_ACCEPTED_REASON, decidedAt: now })
        .where(
          and(eq(bookings.propertyId, property.id), eq(bookings.status, "PENDING"), ne(bookings.id, bookingId)),
        );
      await tx.update(properties).set({ isAvailable: false }).where(eq(properties.id, property.id));
    });
  } catch (err) {
    // Backstop: the DB allows one CONFIRMED booking per property.
    if (isUniqueViolation(err, CONFIRMED_UNIQUE)) throw propertyNotAvailable();
    throw err;
  }
  return getBooking(bookingId, viewer);
}

export async function rejectBooking(bookingId: string, tenantId: string, reason: string | null): Promise<BookingView> {
  await db.transaction(async (tx) => {
    const { property, booking } = await lockForDecision(tx, bookingId);
    if (property.tenantId !== tenantId) throw bookingNotFound();
    if (booking.status !== "PENDING") throw notPending();

    await tx
      .update(bookings)
      .set({ status: "REJECTED", decisionReason: reason, decidedAt: new Date() })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "PENDING")));
  });
  return getBooking(bookingId, { id: tenantId, role: "TENANT" });
}

/** Seeker cancels a PENDING or CONFIRMED booking; cancelling a CONFIRMED one re-opens the property. */
export async function cancelBooking(bookingId: string, seekerId: string): Promise<BookingView> {
  await db.transaction(async (tx) => {
    const { property, booking } = await lockForDecision(tx, bookingId);
    if (booking.seekerId !== seekerId) throw bookingNotFound();
    if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") throw notCancellable();

    await tx.update(bookings).set({ status: "CANCELLED" }).where(eq(bookings.id, bookingId));
    if (booking.status === "CONFIRMED") {
      await tx.update(properties).set({ isAvailable: true }).where(eq(properties.id, property.id));
    }
  });
  return getBooking(bookingId, { id: seekerId, role: "SEEKER" });
}

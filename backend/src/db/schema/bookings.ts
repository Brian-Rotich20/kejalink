import { sql } from "drizzle-orm";
import {
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { bookingStatusEnum } from "./enums";
import { properties } from "./properties";

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "restrict" }),
    seekerId: text("seeker_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    status: bookingStatusEnum("status").notNull().default("PENDING"),

    // A single desired date, not a range (see architecture: booking = rent request).
    preferredMoveInDate: date("preferred_move_in_date"),
    message: text("message"), // seeker's note
    decisionReason: text("decision_reason"), // tenant's note on reject
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("bookings_property_id_idx").on(t.propertyId),
    index("bookings_seeker_id_idx").on(t.seekerId),
    index("bookings_status_idx").on(t.status),
    // A seeker can have only one PENDING request per property.
    uniqueIndex("bookings_one_pending_per_seeker_property_idx")
      .on(t.propertyId, t.seekerId)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
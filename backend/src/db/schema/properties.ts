import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { propertyStatusEnum, propertyTypeEnum } from "./enums";

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    title: varchar("title", { length: 150 }).notNull(),
    description: text("description").notNull(),
    propertyType: propertyTypeEnum("property_type").notNull(),

    // Monthly rent. Kept as numeric(12,2); Drizzle returns it as a string.
    priceAmount: numeric("price_amount", { precision: 12, scale: 2 }).notNull(),
    priceCurrency: char("price_currency", { length: 3 }).notNull().default("KES"),

    bedrooms: smallint("bedrooms"),
    bathrooms: smallint("bathrooms"),

    county: varchar("county", { length: 100 }).notNull(),
    area: varchar("area", { length: 150 }).notNull(),
    addressText: varchar("address_text", { length: 255 }),

    amenities: text("amenities").array().notNull().default(sql`'{}'::text[]`),

    // Moderation only. Listings are PUBLISHED on creation; admin can REJECT.
    status: propertyStatusEnum("status").notNull().default("PUBLISHED"),
    // Occupancy. Flipped to false when a booking is confirmed.
    isAvailable: boolean("is_available").notNull().default(true),
    rejectionReason: text("rejection_reason"),

    // Soft delete.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("properties_tenant_id_idx").on(t.tenantId),
    // Serves public discovery: only live, non-deleted listings.
    index("properties_discovery_idx")
      .on(t.county, t.propertyType, t.priceAmount)
      .where(sql`${t.status} = 'PUBLISHED' AND ${t.deletedAt} IS NULL`),
    check("properties_price_positive", sql`${t.priceAmount} > 0`),
    check("properties_bedrooms_nonneg", sql`${t.bedrooms} IS NULL OR ${t.bedrooms} >= 0`),
    check("properties_bathrooms_nonneg", sql`${t.bathrooms} IS NULL OR ${t.bathrooms} >= 0`),
  ],
);

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
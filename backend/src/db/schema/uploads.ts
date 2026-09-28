import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { properties } from "./properties";

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    cloudinaryPublicId: varchar("cloudinary_public_id", { length: 255 }).notNull().unique(),
    url: text("url").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    displayOrder: smallint("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("uploads_property_id_idx").on(t.propertyId),
    // At most one primary upload per property.
    uniqueIndex("uploads_one_primary_per_property_idx")
      .on(t.propertyId)
      .where(sql`${t.isPrimary} = true`),
  ],
);

export type Upload = typeof uploads.$inferSelect;
export type NewUpload = typeof uploads.$inferInsert;
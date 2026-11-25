import { z } from "zod";
import { propertyTypeEnum } from "../../db/schema/enums";
import { booleanQuery, paginationQuerySchema } from "../../lib/validation";

export const MAX_PRICE = 100_000_000;
export const MAX_ROOMS = 50;
export const MAX_AMENITIES = 30;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const rooms = z.number().int().min(0).max(MAX_ROOMS);

export const propertyTypeSchema = z.enum(propertyTypeEnum.enumValues);

const propertyFields = {
  title: text(3, 150),
  description: text(10, 5000),
  propertyType: propertyTypeSchema,
  priceAmount: z.number().positive().max(MAX_PRICE),
  county: text(1, 100),
  area: text(1, 150),
  amenities: z.array(text(1, 50)).max(MAX_AMENITIES),
};

/** Strict: status, tenantId, rejectionReason and any unknown key are rejected. */
export const createPropertySchema = z.strictObject({
  ...propertyFields,
  bedrooms: rooms.optional(),
  bathrooms: rooms.optional(),
  addressText: text(1, 255).optional(),
  amenities: propertyFields.amenities.optional(),
});
export type CreatePropertyBody = z.infer<typeof createPropertySchema>;

/** All optional; nullable where clearing makes sense; isAvailable is owner-controlled. */
export const updatePropertySchema = z.strictObject({
  title: propertyFields.title.optional(),
  description: propertyFields.description.optional(),
  propertyType: propertyTypeSchema.optional(),
  priceAmount: propertyFields.priceAmount.optional(),
  bedrooms: rooms.nullable().optional(),
  bathrooms: rooms.nullable().optional(),
  county: propertyFields.county.optional(),
  area: propertyFields.area.optional(),
  addressText: text(1, 255).nullable().optional(),
  amenities: propertyFields.amenities.optional(),
  isAvailable: z.boolean().optional(),
});
export type UpdatePropertyBody = z.infer<typeof updatePropertySchema>;

const price = z.coerce.number().min(0).max(MAX_PRICE);

export const listPropertiesQuerySchema = paginationQuerySchema
  .extend({
    q: text(1, 100).optional(),
    county: text(1, 100).optional(),
    area: text(1, 150).optional(),
    propertyType: propertyTypeSchema.optional(),
    minPrice: price.optional(),
    maxPrice: price.optional(),
    bedrooms: z.coerce.number().int().min(0).max(MAX_ROOMS).optional(),
    available: booleanQuery.optional(),
    sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    path: ["minPrice"],
    message: "minPrice must not be greater than maxPrice",
  });
export type ListPropertiesQuery = z.infer<typeof listPropertiesQuerySchema>;

import { pgEnum } from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * User role/status are stored as `text` with CHECK constraints (see auth.ts) so
 * they survive Better Auth schema regeneration. This file is the ONE source of
 * truth for their allowed values and TypeScript types.
 */
export const USER_ROLES = ["TENANT", "SEEKER", "ADMIN"] as const;
export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
/** Roles a person may choose at public registration. ADMIN is never allowed. */
export const PUBLIC_ROLES = ["TENANT", "SEEKER"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export const userRoleSchema = z.enum(USER_ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);

export const propertyTypeEnum = pgEnum("property_type", [
  "HOUSE",
  "APARTMENT",
  "ROOM",
  "BEDSITTER",
  "STUDIO",
  "OTHER",
]);
export const propertyStatusEnum = pgEnum("property_status", ["PUBLISHED", "REJECTED"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
]);

export type PropertyType = (typeof propertyTypeEnum.enumValues)[number];
export type PropertyStatus = (typeof propertyStatusEnum.enumValues)[number];
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];

import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["TENANT", "SEEKER", "ADMIN"]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "BANNED"]);

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

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type PropertyType = (typeof propertyTypeEnum.enumValues)[number];
export type PropertyStatus = (typeof propertyStatusEnum.enumValues)[number];
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
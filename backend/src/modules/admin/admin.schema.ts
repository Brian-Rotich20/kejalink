import { z } from "zod";
import { userRoleSchema, userStatusSchema } from "../../db/schema/enums";
import { booleanQuery, paginationQuerySchema } from "../../lib/validation";
import { bookingStatusSchema } from "../bookings/booking.schema";

/** Better Auth user ids are opaque strings, not UUIDs. */
export const userIdParamSchema = z.object({ id: z.string().min(1).max(100) });
export type UserIdParam = z.infer<typeof userIdParamSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Status only. Roles are never changeable through the API. */
export const updateUserStatusSchema = z.strictObject({ status: userStatusSchema });
export type UpdateUserStatusBody = z.infer<typeof updateUserStatusSchema>;

export const listAdminPropertiesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PUBLISHED", "REJECTED"]).optional(),
  tenantId: z.string().min(1).max(100).optional(),
  includeDeleted: booleanQuery.default(false),
});
export type ListAdminPropertiesQuery = z.infer<typeof listAdminPropertiesQuerySchema>;

export const rejectPropertySchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export type RejectPropertyBody = z.infer<typeof rejectPropertySchema>;

export const listAdminBookingsQuerySchema = paginationQuerySchema.extend({
  status: bookingStatusSchema.optional(),
  propertyId: z.uuid().optional(),
  seekerId: z.string().min(1).max(100).optional(),
});
export type ListAdminBookingsQuery = z.infer<typeof listAdminBookingsQuerySchema>;

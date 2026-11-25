import { z } from "zod";
import { bookingStatusEnum } from "../../db/schema/enums";
import { paginationQuerySchema, todayInNairobi } from "../../lib/validation";

export const bookingStatusSchema = z.enum(bookingStatusEnum.enumValues);

export const createBookingSchema = z.strictObject({
  propertyId: z.uuid(),
  preferredMoveInDate: z.iso
    .date()
    // Evaluated per request: "today" is the Kenyan calendar date, whatever the server TZ.
    .refine((date) => date >= todayInNairobi(), { message: "Move-in date cannot be in the past" })
    .optional(),
  message: z.string().trim().min(1).max(1000).optional(),
});
export type CreateBookingBody = z.infer<typeof createBookingSchema>;

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  status: bookingStatusSchema.optional(),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

/** Body is optional: a request with no body arrives as undefined/null. */
export const rejectBookingSchema = z
  .strictObject({ reason: z.string().trim().min(1).max(500).optional() })
  .nullish();
export type RejectBookingBody = z.infer<typeof rejectBookingSchema>;

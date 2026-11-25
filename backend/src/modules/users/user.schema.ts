import { z } from "zod";

export const updateUserProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    // https only: rejects javascript:, data:, http: and other schemes.
    image: z.url({ protocol: /^https$/ }).max(2048).nullable().optional(),
  })
  .strict();

export type UpdateUserProfileSchema = z.infer<typeof updateUserProfileSchema>;

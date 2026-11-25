import { z } from "zod";

export const updateUserProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    image: z.string().url().nullable().optional(),
  })
  .strict();

export type UpdateUserProfileSchema = z.infer<
  typeof updateUserProfileSchema
>;
import { z } from "zod";

export const MAX_UPLOADS_PER_PROPERTY = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DISPLAY_ORDER = 1000;
/** Multipart field name that carries the image. */
export const UPLOAD_FIELD = "file";

export const propertyUploadsParamsSchema = z.object({ id: z.uuid() });
export type PropertyUploadsParams = z.infer<typeof propertyUploadsParamsSchema>;

export const uploadParamsSchema = z.object({ id: z.uuid(), uploadId: z.uuid() });
export type UploadParams = z.infer<typeof uploadParamsSchema>;

export const updateUploadSchema = z.strictObject({
  // Only `true` is meaningful: make this the primary image (the old one is cleared).
  isPrimary: z.literal(true).optional(),
  displayOrder: z.number().int().min(0).max(MAX_DISPLAY_ORDER).optional(),
});
export type UpdateUploadBody = z.infer<typeof updateUploadSchema>;

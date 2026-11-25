import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { MAX_IMAGE_BYTES } from "../modules/uploads/upload.schema";

/** One image per request, 5 MB max, no other fields. Files are buffered only after ownership checks. */
export async function registerMultipart(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_IMAGE_BYTES,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 100,
      headerPairs: 100,
    },
  });
}

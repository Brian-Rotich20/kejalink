import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireRole } from "../../plugins/auth";
import * as controller from "./upload.controller";
import { propertyUploadsParamsSchema, updateUploadSchema, uploadParamsSchema } from "./upload.schema";

const tags = ["Uploads"];

/** Mounted under /api/properties. Property owner (TENANT) only. */
export async function uploadRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tenantOnly = { onRequest: [requireRole("TENANT")] };

  app.post("/:id/uploads", { ...tenantOnly, schema: { tags, params: propertyUploadsParamsSchema } }, controller.create);

  app.patch(
    "/:id/uploads/:uploadId",
    { ...tenantOnly, schema: { tags, params: uploadParamsSchema, body: updateUploadSchema } },
    controller.update,
  );

  app.delete("/:id/uploads/:uploadId", { ...tenantOnly, schema: { tags, params: uploadParamsSchema } }, controller.remove);
}

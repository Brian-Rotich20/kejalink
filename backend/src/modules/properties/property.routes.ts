import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { idParamSchema, paginationQuerySchema } from "../../lib/validation";
import { requireRole } from "../../plugins/auth";
import * as controller from "./property.controller";
import { createPropertySchema, listPropertiesQuerySchema, updatePropertySchema } from "./property.schema";

const tags = ["Properties"];

export async function propertyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tenantOnly = { onRequest: [requireRole("TENANT")] };

  app.get("/", { schema: { tags, querystring: listPropertiesQuerySchema } }, controller.listPublic);

  // Static route before /:id.
  app.get("/me", { ...tenantOnly, schema: { tags, querystring: paginationQuerySchema } }, controller.listMine);

  app.get("/:id", { schema: { tags, params: idParamSchema } }, controller.getById);

  app.post("/", { ...tenantOnly, schema: { tags, body: createPropertySchema } }, controller.create);

  app.patch(
    "/:id",
    { ...tenantOnly, schema: { tags, params: idParamSchema, body: updatePropertySchema } },
    controller.update,
  );

  app.delete("/:id", { ...tenantOnly, schema: { tags, params: idParamSchema } }, controller.remove);
}

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { idParamSchema } from "../../lib/validation";
import { requireRole } from "../../plugins/auth";
import * as controller from "./admin.controller";
import {
  listAdminBookingsQuerySchema,
  listAdminPropertiesQuerySchema,
  listUsersQuerySchema,
  rejectPropertySchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from "./admin.schema";

const tags = ["Admin"];

/** Mounted at /api/admin. Every route is ADMIN-only. */
export async function adminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook("onRequest", requireRole("ADMIN"));

  app.get("/users", { schema: { tags, querystring: listUsersQuerySchema } }, controller.listUsers);
  app.get("/users/:id", { schema: { tags, params: userIdParamSchema } }, controller.getUserById);
  app.patch(
    "/users/:id",
    { schema: { tags, params: userIdParamSchema, body: updateUserStatusSchema } },
    controller.updateUserStatus,
  );

  app.get("/properties", { schema: { tags, querystring: listAdminPropertiesQuerySchema } }, controller.listProperties);
  app.patch(
    "/properties/:id/reject",
    { schema: { tags, params: idParamSchema, body: rejectPropertySchema } },
    controller.rejectProperty,
  );
  app.patch("/properties/:id/restore", { schema: { tags, params: idParamSchema } }, controller.restoreProperty);
  app.delete("/properties/:id", { schema: { tags, params: idParamSchema } }, controller.deleteProperty);

  app.get("/bookings", { schema: { tags, querystring: listAdminBookingsQuerySchema } }, controller.listBookings);

  app.get("/diagnostics/request", { schema: { tags } }, controller.requestDiagnostics);
}

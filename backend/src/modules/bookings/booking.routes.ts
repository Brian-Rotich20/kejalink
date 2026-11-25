import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { idParamSchema } from "../../lib/validation";
import { requireAuth, requireRole } from "../../plugins/auth";
import * as controller from "./booking.controller";
import { createBookingSchema, listBookingsQuerySchema, rejectBookingSchema } from "./booking.schema";

const tags = ["Bookings"];

export async function bookingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const seekerOnly = { onRequest: [requireRole("SEEKER")] };
  const tenantOnly = { onRequest: [requireRole("TENANT")] };

  app.post("/", { ...seekerOnly, schema: { tags, body: createBookingSchema } }, controller.create);

  // Static routes before /:id.
  app.get("/me", { ...seekerOnly, schema: { tags, querystring: listBookingsQuerySchema } }, controller.listMine);
  app.get(
    "/received",
    { ...tenantOnly, schema: { tags, querystring: listBookingsQuerySchema } },
    controller.listReceived,
  );

  app.get("/:id", { onRequest: [requireAuth], schema: { tags, params: idParamSchema } }, controller.getById);

  app.patch("/:id/confirm", { ...tenantOnly, schema: { tags, params: idParamSchema } }, controller.confirm);
  app.patch(
    "/:id/reject",
    { ...tenantOnly, schema: { tags, params: idParamSchema, body: rejectBookingSchema } },
    controller.reject,
  );
  app.patch("/:id/cancel", { ...seekerOnly, schema: { tags, params: idParamSchema } }, controller.cancel);
}

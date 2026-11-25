import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth } from "../../plugins/auth";
import * as userController from "./user.controller";
import { updateUserProfileSchema } from "./user.schema";

export async function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Every route in this module requires an ACTIVE session.
  app.get(
    "/me",
    {
      onRequest: [requireAuth],
      schema: { tags: ["Users"], description: "Get the signed-in user's profile" },
    },
    userController.getMe,
  );

  app.patch(
    "/me",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Users"],
        description: "Update the signed-in user's profile (name and/or image only)",
        body: updateUserProfileSchema,
      },
    },
    userController.updateMe,
  );
}

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth } from "../../middleware/auth.middleware";
import * as userController from "./user.controller";
import { updateUserProfileSchema } from "./user.schema";

export async function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ── Authenticated routes — everything in this module requires a session ──

  app.get(
    "/me",
    {
      preHandler: [requireAuth],
      schema: { tags: ["Users"], description: "Get the signed-in user's profile" },
    },
    userController.getMe,
  );

  app.patch(
    "/me",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Users"],
        description: "Update the signed-in user's profile (name and/or image only)",
        body: updateUserProfileSchema,
      },
    },
    userController.updateMe,
  );
}
import type { AuthenticatedUser } from "../modules/auth/auth.types";

declare module "fastify" {
  interface FastifyRequest {
    /** Session user (may be non-ACTIVE). Use getUser/getOptionalUser in controllers. */
    user: AuthenticatedUser | null;
  }
}

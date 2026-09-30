// Extend the FastifyRequest interface to include the user property
import type { AuthenticatedUser } from "../modules/auth/auth.types";

declare module "fastify" {
    interface FastifyRequest {
        user: AuthenticatedUser | null ;
    }
}
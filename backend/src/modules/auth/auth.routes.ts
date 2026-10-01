import type { FastifyInstance } from "fastify";
import { auth } from "../../config/auth/better-auth";

export async function authRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    async handler(request, reply) {
      const init: RequestInit = {
        method: request.method,
        headers: request.headers as Record<string, string>,
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = JSON.stringify(request.body);
      }

      const response = await auth.handler(
        new Request(`${request.protocol}://${request.hostname}${request.url}`, init),
      );

      reply.status(response.status);

      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });

      return reply.send(await response.text());
    },
  });
}
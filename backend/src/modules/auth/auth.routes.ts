import type { FastifyInstance } from "fastify";
import { auth, CLIENT_IP_HEADER } from "../../config/auth/better-auth";
import { env } from "../../config/env";

/** Hop-by-hop or recomputed headers that must not be forwarded to Better Auth. */
const DROP_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "keep-alive",
  CLIENT_IP_HEADER,
]);
const DROP_RESPONSE_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "set-cookie"]);

const authOrigin = new URL(env.BETTER_AUTH_URL).origin;

/**
 * Bridge between Fastify and Better Auth's fetch handler for /api/auth/*.
 * Better Auth's native endpoints and error format are kept (see docs/api.md).
 */
export async function authRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST", "HEAD"],
    url: "/auth/*",
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: "1 minute" } },
    async handler(request, reply) {
      // Never build the URL from Host / X-Forwarded-Host.
      const url = new URL(request.url, authOrigin);

      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined || DROP_REQUEST_HEADERS.has(key)) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      // The client IP as resolved by Fastify's trustProxy setting: the only IP source Better Auth trusts.
      headers.set(CLIENT_IP_HEADER, request.ip);

      // Better Auth registers GET only; answer HEAD with the GET response minus the body.
      const method = request.method === "HEAD" ? "GET" : request.method;
      const init: RequestInit = { method, headers };
      if (request.method === "POST" && request.body !== undefined && request.body !== null) {
        init.body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
      }

      const response = await auth.handler(new Request(url, init));

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (!DROP_RESPONSE_HEADERS.has(key)) reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);

      if (request.method === "HEAD") return reply.send();
      return reply.send(await response.text());
    },
  });
}

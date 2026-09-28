import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

/**
 * Global limit. Tighter per-route limits (login/register) are set on those routes later
 * via `config: { rateLimit: { max, timeWindow } }`.
 */
export async function registerRateLimit(app: FastifyInstance, opts?: { max?: number }) {
  await app.register(rateLimit, {
    global: true,
    max: opts?.max ?? 100,
    timeWindow: "1 minute",
  });
}
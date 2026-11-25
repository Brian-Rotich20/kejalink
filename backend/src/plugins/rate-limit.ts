import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

/**
 * Global limit (100/min/IP). Tighter per-route limits (e.g. the /api/auth/* bridge) are set
 * on those routes via `config: { rateLimit: { max, timeWindow } }`.
 */
export async function registerRateLimit(app: FastifyInstance, opts?: { max?: number }) {
  await app.register(rateLimit, {
    global: true,
    max: opts?.max ?? 100,
    timeWindow: "1 minute",
  });
}
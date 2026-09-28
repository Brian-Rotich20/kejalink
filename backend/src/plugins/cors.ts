import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";

/** Explicit origin allow-list. Credentials are required for cookie sessions. */
export async function registerCors(app: FastifyInstance) {
  await app.register(cors, {
    origin: [env.FRONTEND_URL],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
}
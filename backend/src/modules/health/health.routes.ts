import type { FastifyInstance } from "fastify";
import * as healthController from "./health.controller";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/", healthController.live);
  app.get("/ready", healthController.ready);
}

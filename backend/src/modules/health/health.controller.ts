import type { FastifyReply, FastifyRequest } from "fastify";
import { success } from "../../lib/response";
import * as healthService from "./health.service";

/** Liveness: the process is up. Never touches the database. */
export async function live(_request: FastifyRequest, _reply: FastifyReply) {
  return success({ status: "ok" });
}

/** Readiness: 200 when the database answers, 503 DATABASE_UNAVAILABLE otherwise. */
export async function ready(_request: FastifyRequest, _reply: FastifyReply) {
  return success({ status: "ok", ...(await healthService.checkReadiness()) });
}

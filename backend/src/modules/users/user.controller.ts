import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../../lib/errors";
import { success } from "../../lib/response";
import * as userService from "./user.service";
import type { UpdateUserProfileSchema } from "./user.schema";

/**
 * Pulls params/body off the request, calls the service, shapes the
 * response. No business logic, no direct DB access, no try/catch:
 * thrown errors are mapped centrally by the error-handler plugin.
 */

export async function getMe(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.user) throw new UnauthorizedError();
  return success(await userService.getUserProfile(request.user.id));
}

export async function updateMe(
  request: FastifyRequest<{ Body: UpdateUserProfileSchema }>,
  _reply: FastifyReply,
) {
  if (!request.user) throw new UnauthorizedError();
  return success(await userService.updateUserProfile(request.user.id, request.body));
}

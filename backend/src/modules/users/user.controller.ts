import type { FastifyReply, FastifyRequest } from "fastify";
import { success } from "../../lib/response";
import { getUser } from "../../plugins/auth";
import * as userService from "./user.service";
import type { UpdateUserProfileSchema } from "./user.schema";

/**
 * Pulls params/body off the request, calls the service, shapes the
 * response. No business logic, no direct DB access, no try/catch:
 * thrown errors are mapped centrally by the error-handler plugin.
 */

export async function getMe(request: FastifyRequest, _reply: FastifyReply) {
  const user = getUser(request);
  return success(await userService.getUserProfile(user.id));
}

export async function updateMe(
  request: FastifyRequest<{ Body: UpdateUserProfileSchema }>,
  _reply: FastifyReply,
) {
  const user = getUser(request);
  return success(await userService.updateUserProfile(user.id, request.body));
}

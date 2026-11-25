import type { FastifyReply, FastifyRequest } from "fastify";
import { paginated, success } from "../../lib/response";
import type { IdParam, PaginationQuery } from "../../lib/validation";
import { getOptionalUser, getUser } from "../../plugins/auth";
import type { CreatePropertyBody, ListPropertiesQuery, UpdatePropertyBody } from "./property.schema";
import * as propertyService from "./property.service";

export async function listPublic(request: FastifyRequest<{ Querystring: ListPropertiesQuery }>) {
  return paginated(await propertyService.listPublicProperties(request.query));
}

export async function listMine(request: FastifyRequest<{ Querystring: PaginationQuery }>) {
  const user = getUser(request);
  return paginated(await propertyService.listOwnProperties(user.id, request.query));
}

export async function getById(request: FastifyRequest<{ Params: IdParam }>) {
  const viewer = getOptionalUser(request);
  return success(
    await propertyService.getPropertyById(request.params.id, viewer && { id: viewer.id, role: viewer.role }),
  );
}

export async function create(request: FastifyRequest<{ Body: CreatePropertyBody }>, reply: FastifyReply) {
  const user = getUser(request);
  const property = await propertyService.createProperty(user.id, request.body);
  return reply.code(201).send(success(property));
}

export async function update(request: FastifyRequest<{ Params: IdParam; Body: UpdatePropertyBody }>) {
  const user = getUser(request);
  return success(await propertyService.updateProperty(request.params.id, user.id, request.body));
}

export async function remove(request: FastifyRequest<{ Params: IdParam }>) {
  const user = getUser(request);
  return success(await propertyService.deleteProperty(request.params.id, user.id));
}

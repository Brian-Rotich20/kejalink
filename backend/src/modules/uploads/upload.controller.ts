import type { FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../lib/errors";
import { success } from "../../lib/response";
import { getUser } from "../../plugins/auth";
import { UPLOAD_FIELD, type PropertyUploadsParams, type UpdateUploadBody, type UploadParams } from "./upload.schema";
import * as uploadService from "./upload.service";

export async function create(request: FastifyRequest<{ Params: PropertyUploadsParams }>, reply: FastifyReply) {
  const user = getUser(request);
  const propertyId = request.params.id;

  // Ownership and the image limit are checked before reading the (up to 5 MB) body.
  await uploadService.assertCanUpload(propertyId, user.id);

  const file = await request.file();
  if (!file || file.fieldname !== UPLOAD_FIELD) {
    throw new ValidationError(`Send one image in the multipart field "${UPLOAD_FIELD}"`);
  }
  // Throws 413 (FST_REQ_FILE_TOO_LARGE) past the multipart fileSize limit.
  const buffer = await file.toBuffer();

  const upload = await uploadService.createUpload({
    propertyId,
    ownerId: user.id,
    buffer,
    declaredMimetype: file.mimetype,
  });
  return reply.code(201).send(success(upload));
}

export async function update(request: FastifyRequest<{ Params: UploadParams; Body: UpdateUploadBody }>) {
  const user = getUser(request);
  const { id, uploadId } = request.params;
  return success(await uploadService.updateUpload(id, uploadId, user.id, request.body));
}

export async function remove(request: FastifyRequest<{ Params: UploadParams }>) {
  const user = getUser(request);
  const { id, uploadId } = request.params;
  return success(await uploadService.deleteUpload(id, uploadId, user.id));
}

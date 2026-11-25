import type { FastifyRequest } from "fastify";
import { paginated, success } from "../../lib/response";
import type { IdParam } from "../../lib/validation";
import { getUser } from "../../plugins/auth";
import type {
  ListAdminBookingsQuery,
  ListAdminPropertiesQuery,
  ListUsersQuery,
  RejectPropertyBody,
  UpdateUserStatusBody,
  UserIdParam,
} from "./admin.schema";
import * as adminService from "./admin.service";
import type { AdminAuditEntry } from "./admin.types";

/** One structured audit line per admin mutation. */
const audit = (request: FastifyRequest, entry: Omit<AdminAuditEntry, "adminId">) => {
  const adminId = getUser(request).id;
  request.log.info({ audit: true, adminId, ...entry }, `admin.${entry.action}`);
};

// Users

export async function listUsers(request: FastifyRequest<{ Querystring: ListUsersQuery }>) {
  return paginated(await adminService.listUsers(request.query));
}

export async function getUserById(request: FastifyRequest<{ Params: UserIdParam }>) {
  return success(await adminService.getUserById(request.params.id));
}

export async function updateUserStatus(request: FastifyRequest<{ Params: UserIdParam; Body: UpdateUserStatusBody }>) {
  const admin = getUser(request);
  const result = await adminService.setUserStatus(admin.id, request.params.id, request.body.status);
  audit(request, {
    action: "user.status",
    targetId: request.params.id,
    details: { status: request.body.status, sessionsRevoked: result.sessionsRevoked },
  });
  return success(result);
}

// Properties

export async function listProperties(request: FastifyRequest<{ Querystring: ListAdminPropertiesQuery }>) {
  return paginated(await adminService.listProperties(request.query));
}

export async function rejectProperty(request: FastifyRequest<{ Params: IdParam; Body: RejectPropertyBody }>) {
  const admin = getUser(request);
  const result = await adminService.rejectProperty(admin.id, request.params.id, request.body.reason);
  audit(request, {
    action: "property.reject",
    targetId: request.params.id,
    reason: request.body.reason,
    details: { bookingsRejected: result.bookingsRejected },
  });
  return success(result);
}

export async function restoreProperty(request: FastifyRequest<{ Params: IdParam }>) {
  const admin = getUser(request);
  const property = await adminService.restoreProperty(admin.id, request.params.id);
  audit(request, { action: "property.restore", targetId: request.params.id });
  return success(property);
}

export async function deleteProperty(request: FastifyRequest<{ Params: IdParam }>) {
  const result = await adminService.deleteProperty(request.params.id);
  audit(request, {
    action: "property.delete",
    targetId: request.params.id,
    reason: adminService.ADMIN_REMOVED_REASON,
    details: { bookingsRejected: result.bookingsRejected, bookingsCancelled: result.bookingsCancelled },
  });
  return success(result);
}

// Diagnostics

/**
 * What the app sees for this request behind the hosting proxy. Compare `ip` with
 * your real public IP to confirm TRUST_PROXY (see README: Deploying to Render).
 */
export async function requestDiagnostics(request: FastifyRequest) {
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value.join(", ") : (value ?? null);
  };
  return success({
    ip: request.ip,
    ipChain: request.ips ?? [request.ip],
    remoteAddress: request.socket.remoteAddress ?? null,
    protocol: request.protocol,
    headers: {
      "x-forwarded-for": header("x-forwarded-for"),
      "x-forwarded-proto": header("x-forwarded-proto"),
      "true-client-ip": header("true-client-ip"),
      "cf-connecting-ip": header("cf-connecting-ip"),
    },
  });
}

// Bookings

export async function listBookings(request: FastifyRequest<{ Querystring: ListAdminBookingsQuery }>) {
  return paginated(await adminService.listBookings(getUser(request).id, request.query));
}

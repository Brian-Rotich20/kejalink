import type { IncomingHttpHeaders } from "node:http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auth } from "../config/auth/better-auth";
import { env } from "../config/env";
import { userRoleSchema, userStatusSchema, type UserRole } from "../db/schema/enums";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";
import type { AuthenticatedUser } from "../modules/auth/auth.types";

/** Better Auth handles its own routes; health checks never need a user. */
const SKIP_PREFIXES = ["/api/auth/", "/api/health"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Matches both `better-auth.session_token` and `__Secure-better-auth.session_token`. */
const SESSION_COOKIE = "better-auth.session_token=";

export const toFetchHeaders = (raw: IncomingHttpHeaders): Headers => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
};

const pathOf = (url: string): string => url.split("?", 1)[0] ?? url;

const hasSessionCookie = (request: FastifyRequest): boolean =>
  (request.headers.cookie ?? "").includes(SESSION_COOKIE);

/**
 * Loads the session user once per request (onRequest, before body parsing),
 * only when a session cookie is present. Also enforces an Origin allow-list on
 * cookie-authenticated state-changing requests (CSRF defence in depth; Better
 * Auth does the same for /api/auth/*).
 */
export function registerAuth(app: FastifyInstance) {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request) => {
    const path = pathOf(request.url);
    if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
    if (!hasSessionCookie(request)) return;

    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      if (!origin || !env.FRONTEND_URL.includes(origin)) {
        throw new ForbiddenError("Missing or untrusted Origin header", "INVALID_ORIGIN");
      }
    }

    const session = await auth.api.getSession({ headers: toFetchHeaders(request.headers) });
    if (!session) return;

    const role = userRoleSchema.safeParse(session.user.role);
    const status = userStatusSchema.safeParse(session.user.status);
    if (!role.success || !status.success) {
      request.log.warn({ userId: session.user.id }, "Session user has an invalid role or status");
      return;
    }

    request.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
      role: role.data,
      status: status.data,
    };
  });
}

const assertActive = (user: AuthenticatedUser): void => {
  if (user.status !== "ACTIVE") {
    throw new ForbiddenError("This account is suspended or banned", "ACCOUNT_SUSPENDED");
  }
};

/** onRequest guard: a signed-in, ACTIVE user. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) throw new UnauthorizedError();
  assertActive(request.user);
}

/** onRequest guard factory: a signed-in, ACTIVE user with one of `roles`. */
export const requireRole =
  (...roles: UserRole[]) =>
  async (request: FastifyRequest): Promise<void> => {
    const user = request.user;
    if (!user) throw new UnauthorizedError();
    assertActive(user);
    if (!roles.includes(user.role)) throw new ForbiddenError();
  };

/** The guarded user. Only call behind requireAuth/requireRole. */
export function getUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) throw new UnauthorizedError();
  assertActive(request.user);
  return request.user;
}

/** Viewer on public routes: ACTIVE user or null (suspended users browse anonymously). */
export const getOptionalUser = (request: FastifyRequest): AuthenticatedUser | null =>
  request.user && request.user.status === "ACTIVE" ? request.user : null;

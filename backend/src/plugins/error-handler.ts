import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError } from "../lib/errors";
import { failure } from "../lib/response";

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "TOO_MANY_REQUESTS",
};

/**
 * One place that turns every thrown error into the standard envelope.
 * Unknown errors are logged server-side and never leak details to the client.
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(failure("NOT_FOUND", `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    // 1. Our own typed errors
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(failure(error.code, error.message, error.details));
    }

    // 2. Zod request validation (from the type provider) -> 422
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        field: issue.instancePath.replace(/^\//, "").replaceAll("/", ".") || null,
        message: issue.message,
      }));
      return reply
        .status(422)
        .send(failure("VALIDATION_ERROR", "Request validation failed", details));
    }

    // 3. Fastify / plugin errors that carry a 4xx status (bad JSON, rate limit, payload too large...)
    const statusCode = (error as FastifyError).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply
        .status(statusCode)
        .send(
          failure(
            STATUS_CODES[statusCode] ?? "CLIENT_ERROR",
            statusCode === 429 ? "Too many requests, please try again later" : error.message,
          ),
        );
    }

    // 4. Anything else: log it, return a generic 500
    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send(failure("INTERNAL_SERVER_ERROR", "Something went wrong"));
  });
}
import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { PG, pgErrorOf } from "../lib/db";
import { AppError } from "../lib/errors";
import { failure } from "../lib/response";

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  406: "NOT_ACCEPTABLE",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "VALIDATION_ERROR",
  429: "TOO_MANY_REQUESTS",
};

/** Postgres errors that are the client's fault, mapped to safe 4xx responses. */
const PG_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  [PG.UNIQUE_VIOLATION]: { status: 409, code: "CONFLICT", message: "This resource already exists" },
  [PG.FOREIGN_KEY_VIOLATION]: {
    status: 409,
    code: "CONFLICT",
    message: "This action conflicts with related records",
  },
  [PG.CHECK_VIOLATION]: { status: 422, code: "VALIDATION_ERROR", message: "A value is out of range" },
  [PG.NOT_NULL_VIOLATION]: { status: 422, code: "VALIDATION_ERROR", message: "A required value is missing" },
  [PG.INVALID_TEXT_REPRESENTATION]: { status: 422, code: "VALIDATION_ERROR", message: "A value has an invalid format" },
  [PG.NUMERIC_VALUE_OUT_OF_RANGE]: { status: 422, code: "VALIDATION_ERROR", message: "A number is out of range" },
  [PG.STRING_DATA_RIGHT_TRUNCATION]: { status: 422, code: "VALIDATION_ERROR", message: "A value is too long" },
  [PG.INVALID_DATETIME_FORMAT]: { status: 422, code: "VALIDATION_ERROR", message: "A date has an invalid format" },
  [PG.DATETIME_FIELD_OVERFLOW]: { status: 422, code: "VALIDATION_ERROR", message: "A date is out of range" },
  [PG.QUERY_CANCELED]: { status: 503, code: "SERVICE_UNAVAILABLE", message: "The request took too long, please retry" },
};

/** Multipart plugin error codes that need a different status than the plugin's own. */
const MULTIPART_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  FST_INVALID_MULTIPART_CONTENT_TYPE: {
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Expected a multipart/form-data request",
  },
  FST_REQ_FILE_TOO_LARGE: { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Image must be 5 MB or smaller" },
  FST_FILES_LIMIT: { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Upload one file per request" },
  FST_PARTS_LIMIT: { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Too many form parts" },
  FST_FIELDS_LIMIT: { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Too many form fields" },
};

/**
 * One place that turns every thrown error into the standard envelope.
 * Stack traces and internal details are logged server-side only.
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(failure("NOT_FOUND", `Route ${request.method} ${request.url.split("?", 1)[0]} not found`));
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    // 1. Our own typed errors
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.status(error.statusCode).send(failure(error.code, error.message, error.details));
    }

    // 2. Zod request validation (from the type provider) -> 422 with field details
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        field: issue.instancePath.replace(/^\//, "").replaceAll("/", ".") || null,
        message: issue.message,
      }));
      return reply.status(422).send(failure("VALIDATION_ERROR", "Request validation failed", details));
    }

    // 3. Multipart errors
    const fastifyCode = (error as FastifyError).code;
    const multipart = fastifyCode ? MULTIPART_ERRORS[fastifyCode] : undefined;
    if (multipart) {
      return reply.status(multipart.status).send(failure(multipart.code, multipart.message));
    }

    // 4. Known Postgres errors -> safe responses (never the SQL, params or constraint text)
    const pg = pgErrorOf(error);
    const mapped = pg ? PG_ERRORS[pg.code] : undefined;
    if (mapped) {
      request.log.warn({ pgCode: pg?.code }, "Database rejected the request");
      return reply.status(mapped.status).send(failure(mapped.code, mapped.message));
    }

    // 5. Fastify / plugin errors that carry a 4xx status (bad JSON, rate limit, payload too large...)
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

    // 6. Anything else: log it, return a generic 500
    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send(failure("INTERNAL_SERVER_ERROR", "Something went wrong"));
  });
}

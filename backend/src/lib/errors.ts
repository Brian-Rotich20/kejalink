/**
 * Typed application errors. Services throw these; the error-handler plugin
 * turns them into the standard error envelope with the right HTTP status.
 * 5xx AppErrors are logged (with `cause`) by the error handler; clients only
 * ever see `code` and `message`.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "BAD_REQUEST") {
    super(400, code, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", code = "UNAUTHORIZED") {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this", code = "FORBIDDEN") {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", code = "NOT_FOUND") {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT") {
    super(409, code, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Payload too large", code = "PAYLOAD_TOO_LARGE") {
    super(413, code, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = "Unsupported media type", code = "UNSUPPORTED_MEDIA_TYPE") {
    super(415, code, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details: unknown = null) {
    super(422, "VALIDATION_ERROR", message, details);
  }
}

export class BadGatewayError extends AppError {
  constructor(message = "Upstream service failed", code = "BAD_GATEWAY", cause?: unknown) {
    super(502, code, message, null, { cause });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", code = "SERVICE_UNAVAILABLE") {
    super(503, code, message);
  }
}

import { pino, type Logger } from "pino";
import { env } from "../config/env";

/**
 * The one pino logger. Fastify uses it as its loggerInstance; Better Auth and
 * scripts log through it too, so redaction applies everywhere.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "password",
      "*.password",
      "token",
      "*.token",
    ],
    censor: "[redacted]",
  },
});

const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;
// Session tokens, secrets and other long opaque strings.
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;

/** Strip emails and token-like strings from free-text log messages. */
export const sanitizeLogMessage = (message: string): string =>
  message.replace(EMAIL, "[email]").replace(LONG_TOKEN, "[token]").slice(0, 500);

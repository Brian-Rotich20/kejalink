/** Postgres SQLSTATE codes we react to. */
export const PG = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  NOT_NULL_VIOLATION: "23502",
  INVALID_TEXT_REPRESENTATION: "22P02",
  NUMERIC_VALUE_OUT_OF_RANGE: "22003",
  STRING_DATA_RIGHT_TRUNCATION: "22001",
  INVALID_DATETIME_FORMAT: "22007",
  DATETIME_FIELD_OVERFLOW: "22008",
  QUERY_CANCELED: "57014",
} as const;

type PgLikeError = { code: string; constraint_name?: string; constraint?: string };

/** Drizzle wraps driver errors (DrizzleQueryError.cause); walk the cause chain to the postgres error. */
export function pgErrorOf(error: unknown): PgLikeError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return current as PgLikeError;
      current = (current as { cause?: unknown }).cause;
    } else break;
  }
  return null;
}

export const pgConstraintOf = (error: unknown): string | undefined => {
  const pg = pgErrorOf(error);
  return pg?.constraint_name ?? pg?.constraint;
};

export const isUniqueViolation = (error: unknown, constraint?: string): boolean => {
  const pg = pgErrorOf(error);
  if (pg?.code !== PG.UNIQUE_VIOLATION) return false;
  return constraint === undefined || pgConstraintOf(error) === constraint;
};

// Windows dev: "localhost" can resolve to ::1 first while Postgres listens on IPv4 only.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Tests set every variable explicitly (tests/setup); never read the developer's .env there.
if (process.env.NODE_ENV !== "test") loadDotenv({ quiet: true });

const originList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(min).max(max).optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    HOST: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    /** Comma-separated list of allowed browser origins (CORS + Better Auth trustedOrigins). */
    FRONTEND_URL: originList,
    /** Number of reverse-proxy hops to trust for the client IP. */
    TRUST_PROXY: optionalInt(0, 10),
    /** Max requests per minute per IP to /api/auth/* (Fastify bridge and Better Auth sign-in/up). */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && !e.BETTER_AUTH_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_URL"],
        message: "BETTER_AUTH_URL must use https in production",
      });
    }
  })
  .transform((e) => {
    const production = e.NODE_ENV === "production";
    return {
      ...e,
      HOST: e.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
      TRUST_PROXY: e.TRUST_PROXY ?? (production ? 1 : 0),
      BETTER_AUTH_URL: e.BETTER_AUTH_URL.replace(/\/+$/, ""),
    };
  });

export type Env = z.infer<typeof envSchema>;

/** Parse and validate an environment. Throws a readable error listing names only, never values. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { PUBLIC_ROLES, type PublicRole } from "../../db/schema/enums";
import { env } from "../env";

export const NAME_MAX_LENGTH = 100;

const isPublicRole = (value: unknown): value is PublicRole =>
  typeof value === "string" && (PUBLIC_ROLES as readonly string[]).includes(value);

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.FRONTEND_URL],

  database: drizzleAdapter(db, {
    provider: "pg",
    schema, // tables are singular: user, session, account, verification
  }),

  // Profile edits go through PATCH /api/users/me only (strict, validated).
  // Better Auth's /update-user would accept the `role` additional field.
  disabledPaths: ["/update-user"],

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    requireEmailVerification: false, // V1: verification is off
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once a day
  },

  user: {
    additionalFields: {
      // Chosen at registration (TENANT | SEEKER). Validated in the create hook.
      role: {
        type: "string",
        required: true,
        defaultValue: "SEEKER",
        input: true,
      },
      // Server-controlled. Clients can never set or update this.
      status: {
        type: "string",
        required: false,
        defaultValue: "ACTIVE",
        input: false,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const role = user.role ?? "SEEKER";
          if (!isPublicRole(role)) {
            throw new APIError("BAD_REQUEST", { message: "Account type must be TENANT or SEEKER" });
          }

          const name = typeof user.name === "string" ? user.name.trim() : "";
          if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
            throw new APIError("BAD_REQUEST", {
              message: `Name must be between 1 and ${NAME_MAX_LENGTH} characters`,
            });
          }

          // Force status regardless of anything the client sent.
          return { data: { ...user, name, role, status: "ACTIVE" } };
        },
      },
      update: {
        // Defence in depth: role/status may only change through server code
        // (admin service, seed script), never through an HTTP auth endpoint.
        before: async (data, context) => {
          if (context !== null && ("role" in data || "status" in data)) {
            throw new APIError("FORBIDDEN", { message: "Role and status cannot be changed here" });
          }
        },
      },
    },
    session: {
      create: {
        // Blocks login for suspended/banned users.
        before: async (session) => {
          const [row] = await db
            .select({ status: schema.user.status })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);

          if (!row || row.status !== "ACTIVE") {
            throw new APIError("FORBIDDEN", { message: "This account is suspended or banned" });
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;

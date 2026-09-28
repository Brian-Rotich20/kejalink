import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { env } from "../env";

/** Roles a person may pick when registering publicly. ADMIN is never allowed here. */
const PUBLIC_ROLES = ["TENANT", "SEEKER"] as const;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.FRONTEND_URL],

  database: drizzleAdapter(db, {
    provider: "pg",
    schema, // tables are singular: user, session, account, verification
  }),

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
      // Chosen at registration (TENANT | SEEKER). Validated in the hook below.
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
          const role = (user as { role?: unknown }).role ?? "SEEKER";

          if (!PUBLIC_ROLES.includes(role as (typeof PUBLIC_ROLES)[number])) {
            throw new APIError("BAD_REQUEST", {
              message: "Account type must be TENANT or SEEKER",
            });
          }

          // Force status regardless of anything the client sent.
          return { data: { ...user, role, status: "ACTIVE" } };
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
            throw new APIError("FORBIDDEN", {
              message: "This account is suspended or banned",
            });
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
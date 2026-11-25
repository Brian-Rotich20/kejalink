import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider, } from "fastify-type-provider-zod";
import { env } from "./config/env";
import { success } from "./lib/response";
import { registerCors } from "./plugins/cors";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerRateLimit } from "./plugins/rate-limit";
import { registerAuth } from "./plugins/auth";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/users/user.routes";

export async function buildApp(opts?: { rateLimitMax?: number }) {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "test" ? "silent" : "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: env.NODE_ENV === "production", // behind a reverse proxy in prod
  }).withTypeProvider<ZodTypeProvider>();

  // Zod is the single validation/serialization layer.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);
  await registerCors(app);
  await registerRateLimit(app, opts?.rateLimitMax === undefined ? {} : { max: opts.rateLimitMax });
  registerAuth(app);

  // All API routes live under /api.
  await app.register(
    async (api) => {
      api.get("/health", async () => success({ status: "ok" }));

      await api.register(authRoutes);
      await api.register(userRoutes, { prefix: "/users" });
    },
    { prefix: "/api" },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;


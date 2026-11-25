import Fastify, { type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider, } from "fastify-type-provider-zod";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { registerCors } from "./plugins/cors";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerRateLimit } from "./plugins/rate-limit";
import { registerAuth } from "./plugins/auth";
import { registerMultipart } from "./plugins/multipart";
import { authRoutes } from "./modules/auth/auth.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
import { bookingRoutes } from "./modules/bookings/booking.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { propertyRoutes } from "./modules/properties/property.routes";
import { uploadRoutes } from "./modules/uploads/upload.routes";
import { userRoutes } from "./modules/users/user.routes";

export async function buildApp(opts?: { rateLimitMax?: number }) {
  const options: FastifyServerOptions = {
    requestTimeout: 30_000,
    loggerInstance: logger,
    // Trust exactly TRUST_PROXY hops, never `true` (trusting every hop lets clients spoof
    // X-Forwarded-For). Same semantics as a numeric trustProxy, which Fastify's types omit.
    trustProxy: env.TRUST_PROXY > 0 ? (_address: string, hop: number) => hop < env.TRUST_PROXY : false,
  };
  const app = Fastify(options).withTypeProvider<ZodTypeProvider>();

  // Zod is the single validation/serialization layer.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);
  await registerCors(app);
  await registerRateLimit(app, opts?.rateLimitMax === undefined ? {} : { max: opts.rateLimitMax });
  await registerMultipart(app);
  registerAuth(app);

  // All API routes live under /api.
  await app.register(
    async (api) => {
      await api.register(healthRoutes, { prefix: "/health" });
      await api.register(authRoutes);
      await api.register(userRoutes, { prefix: "/users" });
      await api.register(propertyRoutes, { prefix: "/properties" });
      await api.register(uploadRoutes, { prefix: "/properties" });
      await api.register(bookingRoutes, { prefix: "/bookings" });
      await api.register(adminRoutes, { prefix: "/admin" });
    },
    { prefix: "/api" },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;


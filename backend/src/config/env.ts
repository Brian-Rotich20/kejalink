// Windows dev: "localhost" can resolve to ::1 first while Postgres listens on IPv4 only.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({

    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(5000),

    DATABASE_URL: z.string().min(1),

    BETTER_AUTH_SECRET: z.string().min(32),

    BETTER_AUTH_URL: z.string().optional(),
    FRONTEND_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({

    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(5000),

    DATABASE_URL: z.string().optional(),

    BETTER_AUTH_SECRET: z.string().min(32),

    BETTER_AUTH_URL: z.string().optional()
});

export const env = envSchema.parse(process.env);
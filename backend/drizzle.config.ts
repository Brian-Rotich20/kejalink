// Windows dev: "localhost" can resolve to ::1 first while Postgres listens on IPv4 only.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';


export default defineConfig({
    schema: './src/db/schema/index.ts',
    out: './src/db/migrations',
    dialect: 'postgresql',
    dbCredentials: { url: process.env.DATABASE_URL! },
    strict: true,
    verbose: true,
});
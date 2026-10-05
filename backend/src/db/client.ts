import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";
import * as schema from "./schema";


const queryClient = postgres(env.DATABASE_URL, {
    connect_timeout: 5,
    max: 10,
    idle_timeout: 20,
});


export const db = drizzle(queryClient, { schema });
export type Database = typeof db;

export const closeDb = () => queryClient.end();
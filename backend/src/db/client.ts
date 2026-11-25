import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";
import * as schema from "./schema";

const queryClient = postgres(env.DATABASE_URL, {
  connect_timeout: 5,
  max: 10,
  idle_timeout: 20,
  // Postgres NOTICEs (e.g. "already exists, skipping") would bypass pino as raw console output.
  onnotice: () => {},
  // Server-side limits so a slow query or a stuck transaction cannot hold a
  // pooled connection (and its row locks) forever.
  connection: {
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
  },
});

export const db = drizzle(queryClient, { schema });
export type Database = typeof db;
/** Transaction handle passed to db.transaction callbacks. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the pool or a transaction: for helpers that work in both. */
export type DbOrTx = Database | Tx;

export const closeDb = () => queryClient.end({ timeout: 5 });

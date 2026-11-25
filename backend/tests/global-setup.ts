import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { testDatabaseUrl } from "./test-db";

/** Migrate the test database once per run. */
export default async function globalSetup() {
  const url = testDatabaseUrl();
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./src/db/migrations" });
  } finally {
    await client.end();
  }
}

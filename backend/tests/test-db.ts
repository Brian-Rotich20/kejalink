import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

loadDotenv({ path: ".env.test", quiet: true });

/** The only database tests may use. Refuses anything whose name lacks "test". */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Copy .env.test.example to .env.test (see README: Testing).",
    );
  }
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name.toLowerCase().includes("test")) {
    throw new Error(`Refusing to run tests against database "${name}": its name must contain "test".`);
  }
  return url;
}

let client: postgres.Sql | null = null;

/** Raw SQL client for assertions and fixtures (separate from the app's pool). */
export const testSql = (): postgres.Sql =>
  (client ??= postgres(testDatabaseUrl(), { max: 4, onnotice: () => {} }));

export async function closeTestSql(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = null;
}

export async function truncateAll(): Promise<void> {
  await testSql()`TRUNCATE "user", "session", "account", "verification", properties, uploads, bookings RESTART IDENTITY CASCADE`;
}

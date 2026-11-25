import { afterAll, beforeEach } from "vitest";
import { closeTestSql, testDatabaseUrl, truncateAll } from "./test-db";

/**
 * Runs before every test file, BEFORE the file's own code. Only sets env here:
 * app modules are imported later (tests/helpers.ts createTestApp), so a test
 * file can still override a variable at its top level.
 */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: testDatabaseUrl(),
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  BETTER_AUTH_URL: "http://localhost:5000",
  FRONTEND_URL: "http://localhost:3000",
  CLOUDINARY_CLOUD_NAME: "test",
  CLOUDINARY_API_KEY: "test",
  CLOUDINARY_API_SECRET: "test",
  AUTH_RATE_LIMIT_MAX: "10000",
  TRUST_PROXY: "0",
  LOG_LEVEL: "silent",
};
Object.assign(process.env, TEST_ENV);

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestSql();
});

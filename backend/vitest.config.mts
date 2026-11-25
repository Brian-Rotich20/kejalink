import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // One shared test database: run files one at a time.
    fileParallelism: false,
    pool: "forks",
    // Catch timezone regressions: the server must behave the same in Kenya and in UTC.
    env: { TZ: "Africa/Nairobi", NODE_ENV: "test" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

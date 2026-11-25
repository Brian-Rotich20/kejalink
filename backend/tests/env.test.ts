import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env";

const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/kejalink",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:5000",
  FRONTEND_URL: "http://localhost:3000",
  CLOUDINARY_CLOUD_NAME: "c",
  CLOUDINARY_API_KEY: "k",
  CLOUDINARY_API_SECRET: "s",
};

describe("environment validation", () => {
  it("applies defaults (development)", () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({ PORT: 5000, HOST: "127.0.0.1", TRUST_PROXY: 0, AUTH_RATE_LIMIT_MAX: 10 });
    expect(env.FRONTEND_URL).toEqual(["http://localhost:3000"]);
  });

  it("applies production defaults and requires https for BETTER_AUTH_URL", () => {
    const prod = parseEnv({ ...base, NODE_ENV: "production", BETTER_AUTH_URL: "https://api.kejalink.test/" });
    expect(prod).toMatchObject({ HOST: "0.0.0.0", TRUST_PROXY: 1, BETTER_AUTH_URL: "https://api.kejalink.test" });
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/BETTER_AUTH_URL: BETTER_AUTH_URL must use https/);
  });

  it("treats blank values (as copied from .env.example) as unset", () => {
    const env = parseEnv({ ...base, HOST: "", PORT: "", LOG_LEVEL: "", TRUST_PROXY: "", AUTH_RATE_LIMIT_MAX: "" });
    expect(env).toMatchObject({ HOST: "127.0.0.1", PORT: 5000, TRUST_PROXY: 0, AUTH_RATE_LIMIT_MAX: 10 });
    expect(env.LOG_LEVEL).toBeUndefined();
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("parses MIGRATE_ON_START / CROSS_SITE_COOKIES flags strictly", () => {
    expect(parseEnv(base)).toMatchObject({ MIGRATE_ON_START: false, CROSS_SITE_COOKIES: false });
    expect(parseEnv({ ...base, MIGRATE_ON_START: "true" }).MIGRATE_ON_START).toBe(true);
    expect(parseEnv({ ...base, MIGRATE_ON_START: "false" }).MIGRATE_ON_START).toBe(false);
    expect(parseEnv({ ...base, MIGRATE_ON_START: "1" }).MIGRATE_ON_START).toBe(true);
    expect(() => parseEnv({ ...base, MIGRATE_ON_START: "yes" })).toThrow(/MIGRATE_ON_START/);
    expect(() => parseEnv({ ...base, CROSS_SITE_COOKIES: "true" })).toThrow(/CROSS_SITE_COOKIES requires an https/);
    expect(
      parseEnv({ ...base, CROSS_SITE_COOKIES: "true", BETTER_AUTH_URL: "https://api.example.test" }).CROSS_SITE_COOKIES,
    ).toBe(true);
  });

  it("parses a comma-separated FRONTEND_URL list", () => {
    const env = parseEnv({ ...base, FRONTEND_URL: "https://kejalink.co.ke, https://www.kejalink.co.ke/ ,http://localhost:3000" });
    expect(env.FRONTEND_URL).toEqual(["https://kejalink.co.ke", "https://www.kejalink.co.ke", "http://localhost:3000"]);
  });

  it.each([
    ["missing DATABASE_URL", { DATABASE_URL: undefined }, "DATABASE_URL"],
    ["non-postgres DATABASE_URL", { DATABASE_URL: "mysql://x@y/z" }, "DATABASE_URL"],
    ["short secret", { BETTER_AUTH_SECRET: "short" }, "BETTER_AUTH_SECRET"],
    ["missing BETTER_AUTH_URL", { BETTER_AUTH_URL: undefined }, "BETTER_AUTH_URL"],
    ["bad FRONTEND_URL entry", { FRONTEND_URL: "http://ok.test,not a url" }, "FRONTEND_URL"],
    ["PORT out of range", { PORT: "70000" }, "PORT"],
    ["TRUST_PROXY negative", { TRUST_PROXY: "-1" }, "TRUST_PROXY"],
    ["missing Cloudinary secret", { CLOUDINARY_API_SECRET: undefined }, "CLOUDINARY_API_SECRET"],
    ["bad NODE_ENV", { NODE_ENV: "staging" }, "NODE_ENV"],
  ])("rejects %s", (_label, overrides, name) => {
    expect(() => parseEnv({ ...base, ...overrides } as NodeJS.ProcessEnv)).toThrow(new RegExp(name));
  });

  it("never echoes secret values in the error", () => {
    const secret = "super-secret-value";
    const err = (() => {
      try {
        parseEnv({ ...base, BETTER_AUTH_SECRET: secret, DATABASE_URL: `postgresql://u:${secret}@h` });
      } catch (e) {
        return String(e);
      }
      return "";
    })();
    expect(err).toContain("BETTER_AUTH_SECRET");
    expect(err).not.toContain(secret);
  });
});

import { describe, expect, it } from "vitest";
import { pgErrorOf, isUniqueViolation } from "../src/lib/db";
import { sniffImageType } from "../src/lib/image";
import { sanitizeLogMessage } from "../src/lib/logger";
import { containsPattern, escapeLike, fromMoney, todayInNairobi, toMoney } from "../src/lib/validation";
import { IMAGES } from "./helpers";

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("a_b\\c%")).toBe("a\\_b\\\\c\\%");
    expect(containsPattern("100%")).toBe("%100\\%%");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("sniffImageType", () => {
  it("detects jpeg, png and webp by magic bytes", () => {
    expect(sniffImageType(IMAGES.jpeg)).toBe("image/jpeg");
    expect(sniffImageType(IMAGES.png)).toBe("image/png");
    expect(sniffImageType(IMAGES.webp)).toBe("image/webp");
  });
  it("rejects everything else", () => {
    expect(sniffImageType(IMAGES.gif)).toBeNull();
    expect(sniffImageType(IMAGES.text)).toBeNull();
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(Buffer.from("RIFF0000WAVE"))).toBeNull();
  });
});

describe("money", () => {
  it("round-trips numeric(12,2)", () => {
    expect(fromMoney(45000)).toBe("45000.00");
    expect(fromMoney(0.125)).toBe("0.13");
    expect(toMoney("45000.50")).toBe(45000.5);
    expect(toMoney(null)).toBeNull();
  });
});

describe("todayInNairobi", () => {
  it("uses Kenyan calendar dates regardless of the process time zone", () => {
    // 22:30 UTC on Jan 1 is already Jan 2 in Nairobi (UTC+3).
    expect(todayInNairobi(new Date("2026-01-01T22:30:00Z"))).toBe("2026-01-02");
    expect(todayInNairobi(new Date("2026-01-01T20:59:00Z"))).toBe("2026-01-01");
  });
});

describe("pg error helpers", () => {
  it("finds the postgres error through Drizzle's cause chain", () => {
    const pg = Object.assign(new Error("dup"), { code: "23505", constraint_name: "x_idx" });
    const wrapped = Object.assign(new Error("Failed query"), { cause: pg });
    expect(pgErrorOf(wrapped)).toBe(pg);
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, "x_idx")).toBe(true);
    expect(isUniqueViolation(wrapped, "other")).toBe(false);
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
  });
});

describe("sanitizeLogMessage", () => {
  it("masks emails and long tokens", () => {
    const out = sanitizeLogMessage("User jane@example.com token AbCdEfGhIjKlMnOpQrStUvWxYz012345 failed");
    expect(out).not.toContain("jane@example.com");
    expect(out).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });
});

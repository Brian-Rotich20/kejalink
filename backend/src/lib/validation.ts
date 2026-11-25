import { z } from "zod";

/** Route param `:id` for UUID-keyed tables. Bad ids are a 422, never a Postgres error. */
export const idParamSchema = z.object({ id: z.uuid() });
export type IdParam = z.infer<typeof idParamSchema>;

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const offsetFor = ({ page, limit }: PaginationQuery): number => (page - 1) * limit;

/** Query-string boolean: only the literal strings "true" / "false" (z.coerce.boolean would turn "false" into true). */
export const booleanQuery = z.enum(["true", "false"]).transform((v) => v === "true");

/** Escape LIKE/ILIKE wildcards so user input is matched literally (Postgres default escape char is `\`). */
export const escapeLike = (input: string): string => input.replace(/[\\%_]/g, (ch) => "\\" + ch);

/** `%input%` with wildcards escaped. */
export const containsPattern = (input: string): string => `%${escapeLike(input)}%`;

/** numeric(12,2) comes back from Postgres as a string; the API returns numbers. */
export function toMoney(value: string): number;
export function toMoney(value: string | null): number | null;
export function toMoney(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** Store money with exactly two decimals. */
export const fromMoney = (value: number): string => value.toFixed(2);

/** Today's calendar date (YYYY-MM-DD) in Kenya, independent of the server time zone. */
export const todayInNairobi = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

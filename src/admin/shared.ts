/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared plumbing for the superadmin API.
 *
 * Every operator endpoint needs the same five things: paginate, sort on a
 * column the caller is allowed to sort on, coerce untrusted JSON into typed
 * values, write an audit row naming who did it, and turn a failure into an
 * honest HTTP status. Doing that inline in each handler is how admin APIs end
 * up with one route that rejects `pageSize=100000` and eleven that do not, so
 * it lives here once.
 *
 * Two rules the rest of this directory relies on:
 *
 *  1. Sorting is whitelist-only. `orderBy` is built from a map the route owns,
 *     never from the raw query string — otherwise `?sortBy=passwordHash` is a
 *     supported query, and on a relation it is an unbounded join the caller
 *     chose.
 *  2. Money is an integer count of minor units everywhere, inbound and out.
 *     Nothing in this layer ever produces a float from a currency field.
 */

import type { Request, Response } from "express";
import { AuthError, writeAudit, type RequestMeta } from "../authService";
import { logger } from "../logger";

// ── Errors ───────────────────────────────────────────────────────────────────

/** A deliberate, client-visible failure raised by an admin handler. */
export class AdminError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AdminError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AdminError(400, "invalid_input", message, details);
export const notFound = (message = "Record not found.") => new AdminError(404, "not_found", message);
export const conflict = (message: string) => new AdminError(409, "conflict", message);

/**
 * Maps a thrown value to a response.
 *
 * The Prisma cases matter more than they look. P2021/P2022 mean the database is
 * behind the code — a table or column the datamodel declares does not exist
 * yet. Left unmapped that surfaces as a generic 500 and the operator goes
 * looking for a bug in the console; mapped, it says "run the migration", which
 * is the actual fix.
 */
export function sendAdminError(res: Response, err: unknown): Response {
  if (err instanceof AdminError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  const code = (err as any)?.code;

  if (code === "P2021" || code === "P2022") {
    logger.error("Admin API hit a schema that is behind the datamodel", err);
    return res.status(503).json({
      error:
        "This feature needs a database migration that has not been applied yet. " +
        "Run `npm run prisma:migrate` (or `npx prisma migrate deploy`) and reload.",
      code: "migration_required",
    });
  }
  if (code === "P2002") {
    const target = (err as any)?.meta?.target;
    return res.status(409).json({
      error: `That value is already taken${target ? ` (${String(target)})` : ""}.`,
      code: "duplicate",
    });
  }
  if (code === "P2003") {
    return res.status(400).json({
      error: "That record is still referenced by other data, or points at something that no longer exists.",
      code: "fk_violation",
    });
  }
  if (code === "P2025") {
    return res.status(404).json({ error: "Record not found.", code: "not_found" });
  }
  if (code === "P1001" || code === "P1002" || code === "P1017") {
    logger.error("Admin API could not reach the database", err);
    return res.status(503).json({ error: "The database is unreachable right now.", code: "db_unreachable" });
  }

  logger.error("Superadmin API error", err);
  return res.status(500).json({ error: "Something went wrong. Please try again.", code: "internal" });
}

/**
 * Wraps an async handler so a rejected promise becomes a response instead of an
 * unhandled rejection. Express 4 does not await handlers, so without this a
 * throw inside an `async` route hangs the request until the client times out.
 */
export function adminRoute(
  handler: (req: Request, res: Response) => Promise<unknown>
): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req, res).catch((err) => {
      if (res.headersSent) {
        logger.error("Superadmin API error after headers were sent", err);
        return;
      }
      sendAdminError(res, err);
    });
  };
}

// ── Actor identity + audit ───────────────────────────────────────────────────

export function metaOf(req: Request): RequestMeta {
  return {
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip,
    userAgent: req.headers["user-agent"],
  };
}

export interface Actor {
  /** The users.id to attribute the row to, or null for the env-based console. */
  id: string | null;
  email: string;
  /** True when this is the synthetic superadmin with no database row. */
  synthetic: boolean;
}

/**
 * Identifies who is acting.
 *
 * The env-based console signs in as `sub: "superadmin"`, which is not a row in
 * `users`. Writing that string into `audit_logs.user_id` violates the foreign
 * key, and `writeAudit` swallows its own failures — so the previous behaviour
 * would have been to silently record nothing for exactly the most privileged
 * actions in the system. Hence `id: null` plus the email carried in metadata.
 */
export function actorOf(req: Request): Actor {
  const admin = (req as any).adminUser;
  const token = (req as any).user;
  const id = admin?.id ?? token?.sub ?? null;
  const email = admin?.email ?? token?.email ?? "unknown";
  const synthetic = id === "superadmin" || id == null;
  return { id: synthetic ? null : id, email, synthetic };
}

/** Records an operator action. Never throws. */
export async function adminAudit(
  req: Request,
  action: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  const actor = actorOf(req);
  await writeAudit(action, {
    userId: actor.id,
    meta: metaOf(req),
    data: { ...data, actorEmail: actor.email, actorKind: actor.synthetic ? "superadmin_console" : "admin_user" },
  });
}

// ── Query parsing ────────────────────────────────────────────────────────────

export interface Paging {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/**
 * Reads `?page` and `?pageSize`.
 *
 * `pageSize` is clamped rather than trusted: an admin table is the one place a
 * caller can ask for every row in the busiest table in the database, and "the
 * UI only ever sends 25" is not an access control.
 */
export function parsePaging(req: Request, defaultSize = 25, maxSize = 200): Paging {
  const page = Math.max(1, toInt(req.query.page, 1));
  const pageSize = Math.min(maxSize, Math.max(1, toInt(req.query.pageSize, defaultSize)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export type SortMap = Record<string, (dir: "asc" | "desc") => unknown>;

/**
 * Builds a Prisma `orderBy` from `?sortBy` / `?sortDir`, restricted to the keys
 * the route declares. An unknown key falls back to the route's default instead
 * of erroring: a stale bookmark should still render a table.
 */
export function parseSort(req: Request, map: SortMap, fallbackKey: string): unknown {
  const requested = String(req.query.sortBy || "").trim();
  const dir: "asc" | "desc" = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const builder = map[requested] ?? map[fallbackKey];
  return builder(dir);
}

/** Simple `field: dir` sorter, the common case. */
export const sortOn =
  (field: string) =>
  (dir: "asc" | "desc") => ({ [field]: dir });

/** Sorter that reaches through a relation, e.g. `user: { email: dir }`. */
export const sortOnRelation =
  (relation: string, field: string) =>
  (dir: "asc" | "desc") => ({ [relation]: { [field]: dir } });

/** Sorter on a relation's row count, e.g. `_count: { leads: dir }`. */
export const sortOnCount =
  (relation: string) =>
  (dir: "asc" | "desc") => ({ [relation]: { _count: dir } });

export function toInt(value: unknown, fallback = 0): number {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Trimmed non-empty string, or undefined. Use for optional filters. */
export function optStr(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

/** Required string field with a length bound. */
export function reqStr(value: unknown, field: string, maxLength = 500): string {
  const s = optStr(value);
  if (!s) throw badRequest(`${field} is required.`);
  if (s.length > maxLength) throw badRequest(`${field} must be at most ${maxLength} characters.`);
  return s;
}

/** Optional string with a length bound; empty string means "clear the field". */
export function nullableStr(value: unknown, field: string, maxLength = 2000): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  if (!s.length) return null;
  if (s.length > maxLength) throw badRequest(`${field} must be at most ${maxLength} characters.`);
  return s;
}

export function optBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return undefined;
}

/** Bounded integer. Rejects rather than silently clamping, so typos surface. */
export function optInt(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`${field} must be a whole number.`);
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}.`);
  return n;
}

/**
 * Money in minor units. Rejects anything fractional: a request carrying 99.5
 * paise is a client that has confused rupees with paise, and rounding it
 * quietly is how a billing table starts disagreeing with the invoices it
 * produced.
 */
export function optMoney(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number of minor units (e.g. 99900 for ₹999).`);
  if (!Number.isInteger(n)) throw badRequest(`${field} must be a whole number of minor units, not a fraction.`);
  if (n < 0) throw badRequest(`${field} cannot be negative.`);
  if (n > 1_000_000_000_00) throw badRequest(`${field} is implausibly large.`);
  return n;
}

export function optEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const s = String(value).trim().toLowerCase() as T;
  if (!allowed.includes(s)) throw badRequest(`${field} must be one of: ${allowed.join(", ")}.`);
  return s;
}

export function reqEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const v = optEnum(value, field, allowed);
  if (!v) throw badRequest(`${field} is required and must be one of: ${allowed.join(", ")}.`);
  return v;
}

export function optDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} is not a valid date.`);
  return d;
}

export function reqDate(value: unknown, field: string): Date {
  const d = optDate(value, field);
  if (!d) throw badRequest(`${field} is required.`);
  return d;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function optEmail(value: unknown, field = "Email"): string | undefined {
  const s = optStr(value);
  if (!s) return undefined;
  const email = s.toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest(`${field} is not a valid email address.`);
  return email;
}

/**
 * A list of record ids from a bulk request body.
 *
 * Capped because a bulk action is a single transaction against the database; an
 * unbounded list is a request the operator cannot cancel and the database
 * cannot schedule around.
 */
export function parseIds(body: unknown, max = 500): string[] {
  const raw = (body as any)?.ids;
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("Select at least one row first.");
  if (raw.length > max) throw badRequest(`Too many rows selected at once. The limit is ${max}.`);
  const ids = raw.map((v) => String(v).trim()).filter(Boolean);
  if (!ids.length) throw badRequest("Select at least one row first.");
  return [...new Set(ids)];
}

/**
 * Builds a `createdAt` (or other date column) range filter from
 * `?from` / `?to`. `to` is pushed to the end of the given day when it carries no
 * time, so "to = today" includes today rather than excluding almost all of it.
 */
export function parseDateRange(req: Request, field = "createdAt"): Record<string, unknown> {
  const from = optStr(req.query.from);
  const to = optStr(req.query.to);
  if (!from && !to) return {};
  const range: Record<string, Date> = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
  }
  return Object.keys(range).length ? { [field]: range } : {};
}

/** `?days=30`, clamped to something a chart can actually render. */
export function parseDays(req: Request, fallback = 30, max = 365): number {
  return Math.min(max, Math.max(1, toInt(req.query.days, fallback)));
}

// ── Responses ────────────────────────────────────────────────────────────────

export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function pageMeta(total: number, paging: Paging): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / paging.pageSize));
  return {
    total,
    page: paging.page,
    pageSize: paging.pageSize,
    totalPages,
    hasPrev: paging.page > 1,
    hasNext: paging.page < totalPages,
  };
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * RFC 4180 escaping, plus a leading apostrophe on anything a spreadsheet would
 * treat as a formula. Without that last part, a lead whose business name starts
 * with `=` becomes an executable cell in the operator's Excel — CSV injection is
 * the standard way an export feature turns into remote code execution on the
 * person who exported it.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")).join("\r\n");
  // A BOM so Excel on Windows reads the file as UTF-8 and does not mangle
  // non-ASCII names and the ₹ sign.
  return `\uFEFF${head}\r\n${body}\r\n`;
}

export function sendCsv<T>(res: Response, filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const safe = filename.replace(/[^a-z0-9._-]/gi, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(toCsv(rows, columns));
}

/** `2026-09-23` in UTC — the key format every chart series in this API uses. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Zero-fills a daily series so a chart never draws a straight line across days
 * that simply had no rows. Grouped SQL returns no row for an empty day, and a
 * line chart cannot tell "no data" from "not plotted".
 */
export function fillDailySeries(
  rows: { day: unknown; count: unknown }[],
  days: number,
  now = new Date()
): { date: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key =
      typeof row.day === "string" ? row.day.slice(0, 10) : dayKey(new Date(row.day as any));
    map.set(key, Number(row.count) || 0);
  }
  const series: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = dayKey(d);
    series.push({ date: key, value: map.get(key) || 0 });
  }
  return series;
}

/** `2026-09` month keys, newest last, for revenue and cohort series. */
export function monthKeys(count: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export function monthStart(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

export function monthEnd(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1) - 1);
}

/** Percentage change, guarding the divide-by-zero that makes dashboards print NaN%. */
export function deltaPercent(current: number, previous: number): number | null {
  if (!previous) return current ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** BigInt-safe number coercion for `$queryRaw` aggregates. */
export function num(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

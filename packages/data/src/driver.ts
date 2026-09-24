/**
 * The one door between `@lucid/data` and an actual SQLite engine.
 *
 * Two drivers exist (APP-RUN §2 "L1.8"):
 *   - `createSqlJsDriver()` (this package, dev/test only) — sql.js / wasm, so the whole
 *     data layer is testable with vitest on the VPS, no device and no Expo runtime;
 *   - `ExpoSqliteDriver` (`apps/mobile/src/platform/ios|android/`) — the real database on
 *     the phone. It must never live in this package: `packages/data` stays pure
 *     TypeScript with no react-native / expo import (fitness rule A · oracle D21).
 *
 * Everything above this interface (schema, repo, export, delete) is engine-agnostic, so a
 * future driver (better-sqlite3 for server-side sync, op-sqlite, …) only has to implement
 * these four methods.
 */

/** A value SQLite can bind. Objects must be stringified by the caller (JSON columns). */
export type SqlParam = string | number | boolean | null | undefined | Uint8Array;

/** One row as returned by the driver: column name → value, in table column order. */
export type Row = Record<string, unknown>;

export interface DbDriver {
  /** Run one statement for its effect (DDL, PRAGMA, INSERT …). */
  exec(sql: string, params?: readonly SqlParam[]): Promise<void>;
  /** Run one query and collect every row. */
  all<T = Row>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
  /** Run one statement and report how many rows it changed. */
  run(sql: string, params?: readonly SqlParam[]): Promise<{ changes: number }>;
  /**
   * Run `fn` inside a transaction: commit when it resolves, roll back when it throws
   * (oracle D19). Nesting is allowed — inner calls use SAVEPOINTs — so a repo method may
   * open a transaction while the caller already has one open.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** Optional extras a driver may offer. Nothing in the repo depends on these. */
export interface DbDriverExtras {
  /** Serialise the database (sql.js only) — used by fixtures, never by the app. */
  export?(): Promise<Uint8Array>;
  close?(): Promise<void>;
}

export type Db = DbDriver & DbDriverExtras;

/** First row of a query, or `null`. */
export async function first<T = Row>(
  db: DbDriver,
  sql: string,
  params?: readonly SqlParam[],
): Promise<T | null> {
  const rows = await db.all<T>(sql, params);
  return rows.length > 0 ? (rows[0] as T) : null;
}

/** Single scalar of a query (first column of the first row), or `null`. */
export async function scalar<T = unknown>(
  db: DbDriver,
  sql: string,
  params?: readonly SqlParam[],
): Promise<T | null> {
  const row = await first<Row>(db, sql, params);
  if (row === null) return null;
  const keys = Object.keys(row);
  if (keys.length === 0) return null;
  return row[keys[0] as string] as T;
}

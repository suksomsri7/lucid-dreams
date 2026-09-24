/**
 * sql.js (SQLite compiled to wasm) driver — **dev and test only**.
 *
 * Why it exists: APP-RUN §0.2 rule 1 says every piece of logic must be testable with vitest
 * on the VPS with no device. The data layer is logic too (schema, stats, export, delete), so
 * the oracle `packages/data/test/L1.8-data.test.ts` runs the real SQL against a real SQLite
 * — in memory, in wasm — instead of a hand-written fake that could lie about CHECK
 * constraints, UNIQUE indexes or transaction rollback.
 *
 * `sql.js` is a **devDependency** and is never imported statically: the specifier is loaded
 * through `import(<variable>)` so no bundler (Metro, Vite) can pull wasm into the app
 * bundle, and `packages/data` keeps working in React Native where sql.js does not exist.
 */

import type { Db, Row, SqlParam } from '../driver';

/** The slice of the sql.js API this driver uses. Typed here so no `@types` dep is needed. */
interface SqlJsStatement {
  bind(values?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Row;
  reset(): void;
  free(): boolean;
}

interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): SqlJsDatabase;
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsModule {
  Database: new (data?: Uint8Array | null) => SqlJsDatabase;
}

export interface SqlJsDriverOptions {
  /** Open an existing database file (fixtures, or a JSON import round-trip test). */
  data?: Uint8Array | null;
  /** Foreign keys are on by default — the app relies on ON DELETE CASCADE. */
  foreignKeys?: boolean;
}

let modulePromise: Promise<SqlJsModule> | null = null;

async function loadSqlJs(): Promise<SqlJsModule> {
  if (modulePromise !== null) return modulePromise;

  modulePromise = (async (): Promise<SqlJsModule> => {
    // Variable specifier on purpose: keeps bundlers from following it (see file header).
    const specifier = 'sql.js';
    const imported = (await import(specifier as string)) as { default?: unknown } & Record<string, unknown>;
    const init = (imported.default ?? imported) as (config?: Record<string, unknown>) => Promise<SqlJsModule>;
    if (typeof init !== 'function') throw new Error('data: sql.js did not export an initialiser');

    try {
      return await init();
    } catch (error) {
      // Some Node/ESM combinations cannot find `sql-wasm.wasm` next to the CJS entry point;
      // resolve it explicitly before giving up.
      const located = await locateWasmDirectory();
      if (located === null) throw error;
      return await init({ locateFile: (file: string) => `${located}${file}` });
    }
  })();

  return modulePromise;
}

async function locateWasmDirectory(): Promise<string | null> {
  try {
    const moduleSpecifier = 'node:module';
    const nodeModule = (await import(moduleSpecifier as string)) as {
      createRequire: (path: string) => { resolve: (id: string) => string };
    };
    const require = nodeModule.createRequire(import.meta.url);
    const entry = require.resolve('sql.js');
    return entry.slice(0, entry.lastIndexOf('/') + 1);
  } catch {
    return null;
  }
}

/** Booleans → 0/1, `undefined` → NULL; anything else must already be a SQLite value. */
function normalise(params: readonly SqlParam[] | undefined): unknown[] {
  if (params === undefined) return [];
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

/**
 * Open an in-memory SQLite database on wasm. Call `migrate(db)` afterwards.
 * Statements are cached per SQL string, which is what keeps 960 epoch inserts well under
 * the 2 s budget of oracle D22.
 */
export async function createSqlJsDriver(options: SqlJsDriverOptions = {}): Promise<Db> {
  const SQL = await loadSqlJs();
  const database = new SQL.Database(options.data ?? null);
  const statements = new Map<string, SqlJsStatement>();
  let depth = 0;
  let savepoint = 0;
  let closed = false;

  function prepared(sql: string): SqlJsStatement {
    if (closed) throw new Error('data: driver is closed');
    let statement = statements.get(sql);
    if (statement === undefined) {
      statement = database.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  }

  /** No parameters, possibly several statements (DDL, PRAGMA, BEGIN/COMMIT). */
  function raw(sql: string): void {
    if (closed) throw new Error('data: driver is closed');
    database.run(sql);
  }

  const driver: Db = {
    async exec(sql, params) {
      if (params === undefined || params.length === 0) {
        raw(sql);
        return;
      }
      await driver.run(sql, params);
    },

    async all<T = Row>(sql: string, params?: readonly SqlParam[]): Promise<T[]> {
      const statement = prepared(sql);
      statement.bind(normalise(params));
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      statement.reset();
      return rows;
    },

    async run(sql, params) {
      const statement = prepared(sql);
      statement.bind(normalise(params));
      while (statement.step()) {
        // INSERT/UPDATE/DELETE return no rows; RETURNING clauses are drained here.
      }
      statement.reset();
      return { changes: database.getRowsModified() };
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) {
        // Nested: SAVEPOINT so an inner failure cannot commit half of the outer work.
        savepoint += 1;
        const name = `lucid_sp_${savepoint}`;
        raw(`SAVEPOINT ${name}`);
        depth += 1;
        try {
          const result = await fn();
          raw(`RELEASE ${name}`);
          return result;
        } catch (error) {
          raw(`ROLLBACK TO ${name}`);
          raw(`RELEASE ${name}`);
          throw error;
        } finally {
          depth -= 1;
        }
      }

      raw('BEGIN');
      depth = 1;
      try {
        const result = await fn();
        raw('COMMIT');
        return result;
      } catch (error) {
        raw('ROLLBACK');
        throw error;
      } finally {
        depth = 0;
      }
    },

    async export() {
      return database.export();
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const statement of statements.values()) statement.free();
      statements.clear();
      database.close();
    },
  };

  if (options.foreignKeys !== false) raw('PRAGMA foreign_keys = ON');

  return driver;
}

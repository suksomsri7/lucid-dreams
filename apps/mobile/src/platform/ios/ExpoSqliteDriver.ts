/**
 * The real database of the app: a `DbDriver` (from `@lucid/data`) on top of expo-sqlite.
 *
 * It lives here, not in `packages/data`, because that package must stay pure TypeScript with
 * no expo import so the whole data layer can be tested with vitest on a Linux box
 * (APP-RUN §0.2 rule 1 · fitness rule A · oracle D21). expo-sqlite itself is cross-platform,
 * so `platform/android/ExpoSqliteDriver.ts` simply re-exports this file; what is genuinely
 * iOS-specific is the Data Protection note at the bottom.
 *
 * Two things this adapter has to get right that the sql.js one does not:
 *
 *  1. **serialisation** — the watch flushes epochs while a screen reads the journal. All calls
 *     go through one promise chain, so a `BEGIN … COMMIT` can never be interleaved with a
 *     write from somewhere else. Calls made *inside* a transaction bypass the queue (the
 *     transaction already owns it), which is what keeps nested repo calls from deadlocking.
 *  2. **transactions by hand** — `withTransactionAsync` would hand back a separate connection
 *     object, and the repo writes through the driver it was given. `BEGIN` / `COMMIT` /
 *     `ROLLBACK` plus SAVEPOINTs give exactly the semantics `@lucid/data` expects, identical
 *     to the sql.js driver, so oracle D19 covers both.
 */

import type { Db, Row, SqlParam } from '@lucid/data';
import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

/** One database file for the whole app. Deleting it is "delete everything" (§0.5 S4). */
export const DATABASE_NAME = 'lucid.db';

export interface ExpoSqliteDriverOptions {
  databaseName?: string;
  /** Defaults to `SQLite.defaultDatabaseDirectory` (inside the app container). */
  directory?: string;
  /** WAL is on by default: shorter write locks while the watch streams epochs. */
  walMode?: boolean;
  /** Foreign keys are on by default — the schema relies on ON DELETE CASCADE. */
  foreignKeys?: boolean;
}

export interface ExpoSqliteDriver extends Db {
  /** Absolute path of the database file — needed by "delete everything" and by QC. */
  readonly databasePath: string;
  /** What `applyDataProtection()` managed to do on this OS build. */
  readonly dataProtection: DataProtectionResult;
}

export interface DataProtectionResult {
  applied: boolean;
  /** Human-readable reason, logged once at startup (never contains user data). */
  detail: string;
}

/** Booleans → 0/1 and `undefined` → NULL, exactly like the sql.js driver. */
function normalise(params: readonly SqlParam[] | undefined): SQLite.SQLiteBindValue[] {
  if (params === undefined) return [];
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value as SQLite.SQLiteBindValue;
  });
}

export async function createExpoSqliteDriver(
  options: ExpoSqliteDriverOptions = {},
): Promise<ExpoSqliteDriver> {
  const databaseName = options.databaseName ?? DATABASE_NAME;
  const directory = options.directory ?? SQLite.defaultDatabaseDirectory;
  const database = await SQLite.openDatabaseAsync(databaseName, { useNewConnection: false }, directory);

  if (options.walMode !== false) await database.execAsync('PRAGMA journal_mode = WAL');
  if (options.foreignKeys !== false) await database.execAsync('PRAGMA foreign_keys = ON');

  const databasePath = joinPath(directory, databaseName);
  const dataProtection = await applyDataProtection(databasePath);

  let tail: Promise<void> = Promise.resolve();
  let depth = 0;
  let savepoint = 0;

  /** Run `task` after everything already queued, whether that succeeded or not. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Inside a transaction the caller already holds the queue — run straight away. */
  function guarded<T>(task: () => Promise<T>): Promise<T> {
    return depth > 0 ? task() : enqueue(task);
  }

  const driver: ExpoSqliteDriver = {
    databasePath,
    dataProtection,

    async exec(sql, params) {
      if (params === undefined || params.length === 0) {
        await guarded(() => database.execAsync(sql));
        return;
      }
      await driver.run(sql, params);
    },

    async all<T = Row>(sql: string, params?: readonly SqlParam[]): Promise<T[]> {
      return guarded(() => database.getAllAsync<T>(sql, normalise(params)));
    },

    async run(sql, params) {
      const result = await guarded(() => database.runAsync(sql, normalise(params)));
      return { changes: result.changes };
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) {
        savepoint += 1;
        const name = `lucid_sp_${savepoint}`;
        await database.execAsync(`SAVEPOINT ${name}`);
        depth += 1;
        try {
          const result = await fn();
          await database.execAsync(`RELEASE ${name}`);
          return result;
        } catch (error) {
          await database.execAsync(`ROLLBACK TO ${name}`);
          await database.execAsync(`RELEASE ${name}`);
          throw error;
        } finally {
          depth -= 1;
        }
      }

      return enqueue(async () => {
        await database.execAsync('BEGIN');
        depth = 1;
        try {
          const result = await fn();
          await database.execAsync('COMMIT');
          return result;
        } catch (error) {
          await database.execAsync('ROLLBACK');
          throw error;
        } finally {
          depth = 0;
        }
      });
    },

    async close() {
      await enqueue(() => database.closeAsync());
    },
  };

  return driver;
}

/** Close and remove the database file itself — the last step of "delete everything". */
export async function deleteDatabaseFile(databaseName: string = DATABASE_NAME): Promise<void> {
  await SQLite.deleteDatabaseAsync(databaseName);
}

function joinPath(directory: string, name: string): string {
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;
}

/**
 * iOS Data Protection for the database file (APP-RUN §0.5 S4).
 *
 * Target class: `completeUntilFirstUserAuthentication` — the file is unreadable until the
 * owner unlocks the phone once after a reboot, which is the strongest class a background
 * night session can use (`complete` would make the database unreadable while the screen is
 * locked, i.e. exactly when the app is running).
 *
 * State of the platform on SDK 57 (checked 24 Sep 2026 against expo-file-system 57.0.7):
 * neither expo-file-system nor expo-sqlite exposes an API to set `NSFileProtectionKey`, so
 * this function probes for one and reports honestly when it is not there. Facts worth keeping:
 *
 *   - iOS already applies `NSFileProtectionCompleteUntilFirstUserAuthentication` **by default**
 *     to files in the app container on a device with a passcode, so the target class is the
 *     effective one in practice — this call is about making it explicit and verifiable;
 *   - the explicit setting belongs in native code (an `expo-module` / config plugin calling
 *     `FileManager.setAttributes([.protectionKey: .completeUntilFirstUserAuthentication])`
 *     on the file plus the `-wal` and `-shm` side files). Tracked as a debt in
 *     `ledger/wo-notes/L1.8.md`; it must be closed before R1 ships a real night, and QC
 *     verifies it on device (there is no way to verify it from vitest).
 */
export async function applyDataProtection(databasePath: string): Promise<DataProtectionResult> {
  const candidates = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  // Probe, don't assume: read the module as a bag of unknowns so this keeps compiling either way.
  const fileSystem = FileSystem as unknown as Record<string, unknown>;
  const protectionTypes = fileSystem.FileProtectionType as Record<string, string> | undefined;
  const setProtection = fileSystem.setProtectionAsync as
    | ((path: string, type: string) => Promise<void>)
    | undefined;

  if (typeof setProtection !== 'function' || protectionTypes === undefined) {
    return {
      applied: false,
      detail:
        'expo-file-system 57 has no file-protection API; relying on the iOS default class ' +
        '(completeUntilFirstUserAuthentication) until the native config plugin lands',
    };
  }

  const target = protectionTypes.completeUntilFirstUserAuthentication;
  if (target === undefined) {
    return { applied: false, detail: 'FileProtectionType.completeUntilFirstUserAuthentication missing' };
  }

  try {
    for (const path of candidates) await setProtection(path, target);
    return { applied: true, detail: `set ${target} on ${candidates.length} file(s)` };
  } catch (error) {
    return {
      applied: false,
      detail: `could not set file protection: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

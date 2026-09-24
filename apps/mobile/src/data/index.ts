/**
 * The app's single handle on the database.
 *
 * Everything about *what* is stored lives in `@lucid/data` (pure TypeScript, tested on the
 * VPS). This file only does the two things a package cannot: pick the platform driver and keep
 * one instance alive for the whole process.
 *
 *   const repo = await getRepo();
 *   const night = await repo.nightReport(sessionId);
 *
 * `getRepo()` is safe to call from anywhere, any number of times, concurrently: the first call
 * opens the file, runs the migrations and applies the iOS Data Protection class; later calls
 * await the same promise.
 */

import { createRepo, migrate, type Repo } from '@lucid/data';
import { systemClock } from '@lucid/engine';
import { Platform } from 'react-native';

import * as androidDriver from '../platform/android/ExpoSqliteDriver';
import * as iosDriver from '../platform/ios/ExpoSqliteDriver';
import { NotImplementedError } from '../platform/types';
import type { DataProtectionResult, ExpoSqliteDriver } from '../platform/ios/ExpoSqliteDriver';

/** Same implementation on both platforms today; selected per platform folder anyway. */
const driverModule = Platform.OS === 'android' ? androidDriver : iosDriver;

export interface OpenDatabaseResult {
  repo: Repo;
  driver: ExpoSqliteDriver;
  dataProtection: DataProtectionResult;
  /** Versions applied by this launch — empty on every launch but the first. */
  applied: number[];
}

let opening: Promise<OpenDatabaseResult> | null = null;

async function open(): Promise<OpenDatabaseResult> {
  if (Platform.OS === 'web') {
    // The web build exists for QC screenshots only (APP-RUN §0.2 rule 2); screens must render
    // from fixtures there instead of hitting SQLite.
    throw new NotImplementedError('the local database');
  }

  const driver = await driverModule.createExpoSqliteDriver();
  const { applied } = await migrate(driver);
  const repo = createRepo(driver, systemClock);
  return { repo, driver, dataProtection: driver.dataProtection, applied };
}

/** The opened database, opening it on first use. */
export async function openDatabase(): Promise<OpenDatabaseResult> {
  opening ??= open().catch((error: unknown) => {
    // A failed open must not poison the singleton: the next call may succeed (e.g. after the
    // owner unlocks the phone for the first time since boot).
    opening = null;
    throw error;
  });
  return opening;
}

/** The repository singleton — the call almost every screen makes. */
export async function getRepo(): Promise<Repo> {
  const { repo } = await openDatabase();
  return repo;
}

/** Close the handle (used by "delete everything" and by tests). */
export async function closeDatabase(): Promise<void> {
  const current = opening;
  opening = null;
  if (current === null) return;
  try {
    const { driver } = await current;
    await driver.close?.();
  } catch {
    // Nothing to close.
  }
}

export { DATABASE_NAME } from '../platform/ios/ExpoSqliteDriver';
export type { DataProtectionResult, ExpoSqliteDriver } from '../platform/ios/ExpoSqliteDriver';

/**
 * Android database adapter.
 *
 * expo-sqlite is cross-platform, so there is nothing to re-implement: this is the same driver
 * as iOS, re-exported so `platform/android/` stays a complete platform folder (APP-RUN §0.2
 * rule 8 — Android is added later by writing files in this directory only).
 *
 * The one part that does not carry over is file protection: `applyDataProtection()` is a no-op
 * on Android, where the equivalent is full-disk encryption plus `allowBackup=false`. That has
 * to be set in the manifest when Android becomes a real target (Phase 2), not here.
 */

export {
  DATABASE_NAME,
  applyDataProtection,
  createExpoSqliteDriver,
  deleteDatabaseFile,
} from '../ios/ExpoSqliteDriver';
export type {
  DataProtectionResult,
  ExpoSqliteDriver,
  ExpoSqliteDriverOptions,
} from '../ios/ExpoSqliteDriver';

/**
 * `@lucid/data` — the local database of Lucid Dream (DESIGN-APP §7 · APP-RUN §2 "L1.8").
 *
 * Pure TypeScript: no react-native, no expo, no node-only API on the hot path, so the whole
 * data layer runs under vitest on the VPS (fitness rule A · oracle D21). The phone plugs its
 * own `DbDriver` in (`apps/mobile/src/platform/ios|android/ExpoSqliteDriver.ts`); the test
 * plugs in sql.js.
 *
 * Typical use in the app:
 *
 *   const db = await createExpoSqliteDriver();   // apps/mobile
 *   await migrate(db);
 *   const repo = createRepo(db, systemClock);    // systemClock from @lucid/engine
 */

export type { Db, DbDriver, DbDriverExtras, Row, SqlParam } from './driver';
export { first, scalar } from './driver';

export {
  CUE_RESPONSES,
  EAR_SIDES,
  LUCID_ANSWERS,
  MIGRATIONS,
  META_TABLE,
  REALITY_CHECK_ANSWERS,
  SCHEMA_VERSION,
  SENSOR_SOURCES,
  SESSION_MODES,
  SLEEP_STAGES,
  TABLES,
  WAKE_CAUSES,
  assertTableName,
  migrate,
  readSchemaVersion,
  tableColumns,
} from './schema';
export type {
  CueResponse,
  EarSide,
  LucidAnswer,
  Migration,
  MigrateResult,
  RealityCheckAnswer,
  SessionMode,
  SleepStage,
  TableName,
  WakeCause,
} from './schema';

export { SENSITIVE_FIELDS, isSensitiveField, stripSensitive } from './sensitive';
export type { SensitiveField } from './sensitive';

export {
  dateIsoOf,
  epochSecondsFrom,
  formatLocal,
  isoFromEpochSeconds,
  shiftDateIso,
  toDateIso,
  toIsoUtc,
  toIsoUtcOrNull,
} from './time';

export { LUCID_VALUE, REM_LIKELY_THRESHOLD, createRepo } from './repo';
export type {
  AiScoreInput,
  AiScoreRecord,
  ApplePhaseInput,
  ApplePhaseRecord,
  CreateSessionInput,
  CueInput,
  CueRecord,
  DataDiagnosticsDraft,
  DeleteAllResult,
  DiagnosticsDraftOptions,
  DiagnosticsNightSummary,
  EarTestInput,
  EarTestRecord,
  EpochInput,
  EpochRecord,
  ExportBundle,
  NightEvent,
  NightEventKind,
  NightReport,
  NightSummary,
  Repo,
  RepoClock,
  ReportInput,
  ReportRecord,
  SessionRecord,
  StatsResult,
  WakeInput,
  WakeRecord,
} from './repo';


/** Package version, reported inside JSON exports by the app. */
export const DATA_VERSION = '0.1.0';

/**
 * Dev/test driver (sql.js · wasm) is **not** exported from here any more: Metro follows the
 * `import('sql.js')` inside `drivers/sqljs.ts` and then fails on `node:fs` when bundling the
 * iOS app (R1 build #1, 25 ก.ย. 2026). Tests import it from `@lucid/data/sqljs` instead.
 */

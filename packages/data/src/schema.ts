/**
 * The 12 tables of DESIGN-APP §7 plus the migration runner (oracle D1 · D2 · D3 · D18).
 *
 * Rules that the schema itself enforces, so no caller can write a bad row:
 *   - enums are CHECK constraints (`CueEvent.response`, `EarTest.side`, `NightSession.mode`, …);
 *   - booleans are INTEGER 0/1 with a CHECK;
 *   - one EarTest row per (night, ear): UNIQUE(sessionId, side);
 *   - one MorningReport per night, one AiScore per report;
 *   - timestamps are TEXT, ISO-8601 UTC, ending in `Z` (see `time.ts`);
 *   - list/record columns are TEXT holding JSON (`params`, `tags`, `matchedTerms`, …);
 *   - audio is a **path**, never a blob (oracle D16 · §0.5 S4).
 *
 * Migrations are append-only: never edit a shipped statement, add a new version instead —
 * a phone in the wild only ever runs the versions it has not seen yet.
 */

import type { DbDriver } from './driver';

/** Bumped by every new migration. Stored in `_meta` so an old database can catch up. */
export const SCHEMA_VERSION = 1;

/** Key/value table holding `schemaVersion`. Not a data table, so it is not in `TABLES`. */
export const META_TABLE = '_meta';

/**
 * The 12 data tables, in dependency order (parents first). Export writes them in this
 * order and import inserts in this order / deletes in reverse, so foreign keys hold.
 */
export const TABLES = [
  'UserProfile',
  'Theme',
  'NightSession',
  'SensorEpoch',
  'CueEvent',
  'WakeEvent',
  'AppleSleepPhase',
  'MorningReport',
  'AiScore',
  'RealityCheck',
  'PersonalModel',
  'EarTest',
] as const;

export type TableName = (typeof TABLES)[number];

const TABLE_SET: ReadonlySet<string> = new Set<string>(TABLES);

/** Guard used before any identifier is interpolated into SQL (oracle D20). */
export function assertTableName(name: string): TableName {
  if (!TABLE_SET.has(name)) throw new Error(`data: unknown table "${name}"`);
  return name as TableName;
}

/** `CueEvent.response` (DESIGN §7) — from the wake detector plus the morning question. */
export const CUE_RESPONSES = ['WOKE', 'NONE', 'HEARD_IN_DREAM', 'LUCID'] as const;
export type CueResponse = (typeof CUE_RESPONSES)[number];

export const SESSION_MODES = ['CUE', 'CONTROL'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const WAKE_CAUSES = ['MOTION', 'HR', 'USER'] as const;
export type WakeCause = (typeof WAKE_CAUSES)[number];

export const SLEEP_STAGES = ['REM', 'CORE', 'DEEP', 'AWAKE'] as const;
export type SleepStage = (typeof SLEEP_STAGES)[number];

export const LUCID_ANSWERS = ['YES', 'NO', 'UNSURE'] as const;
export type LucidAnswer = (typeof LUCID_ANSWERS)[number];

export const EAR_SIDES = ['L', 'R'] as const;
export type EarSide = (typeof EAR_SIDES)[number];

export const REALITY_CHECK_ANSWERS = ['DONE', 'LATER', 'NONE'] as const;
export type RealityCheckAnswer = (typeof REALITY_CHECK_ANSWERS)[number];

/** Sensor source strings — same vocabulary as `SensorEpoch.source` in `@lucid/engine`. */
export const SENSOR_SOURCES = ['WATCH', 'BLE_HR', 'PHONE_MOTION', 'MASK', 'TIMER'] as const;

function enumCheck(column: string, values: readonly string[], nullable = true): string {
  const list = values.map((v) => `'${v}'`).join(', ');
  return nullable
    ? `CHECK ("${column}" IS NULL OR "${column}" IN (${list}))`
    : `CHECK ("${column}" IN (${list}))`;
}

function boolCheck(column: string, nullable = true): string {
  return nullable
    ? `CHECK ("${column}" IS NULL OR "${column}" IN (0, 1))`
    : `CHECK ("${column}" IN (0, 1))`;
}

export interface Migration {
  version: number;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      // --- UserProfile: one row per install (`id = 'me'`). ------------------------------
      `CREATE TABLE IF NOT EXISTS "UserProfile" (
         "id" TEXT PRIMARY KEY NOT NULL,
         "locale" TEXT NOT NULL DEFAULT 'th',
         "cueLanguage" TEXT,
         "anchorSeed" TEXT,
         "anchorPhrase" TEXT,
         "anchorAudioPaths" TEXT NOT NULL DEFAULT '{}',
         "ambienceKey" TEXT,
         "volumeStart" REAL,
         "consentAi" INTEGER NOT NULL DEFAULT 0 ${boolCheck('consentAi', false)},
         "consentSafety" INTEGER NOT NULL DEFAULT 0 ${boolCheck('consentSafety', false)},
         "createdAt" TEXT NOT NULL,
         "updatedAt" TEXT NOT NULL
       )`,

      // --- Theme: the six chips plus anything the owner typed. --------------------------
      `CREATE TABLE IF NOT EXISTS "Theme" (
         "id" TEXT PRIMARY KEY NOT NULL,
         "key" TEXT NOT NULL,
         "titleTh" TEXT,
         "titleEn" TEXT,
         "emoji" TEXT,
         "seedLines" TEXT NOT NULL DEFAULT '[]',
         "ambienceKey" TEXT,
         "isCustom" INTEGER NOT NULL DEFAULT 0 ${boolCheck('isCustom', false)},
         "createdAt" TEXT NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_Theme_key" ON "Theme" ("key")`,

      // --- NightSession: one row per night. --------------------------------------------
      // `themeKey` is denormalised on purpose: the advisor can start a night from a theme
      // the owner typed before it is ever saved as a Theme row, and the journal must still
      // be able to group nights by theme after a Theme row is deleted.
      `CREATE TABLE IF NOT EXISTS "NightSession" (
         "id" TEXT PRIMARY KEY NOT NULL,
         "dateIso" TEXT NOT NULL,
         "themeId" TEXT REFERENCES "Theme" ("id") ON DELETE SET NULL,
         "themeKey" TEXT,
         "mode" TEXT NOT NULL ${enumCheck('mode', SESSION_MODES, false)},
         "startedAt" TEXT NOT NULL,
         "onsetAt" TEXT,
         "guardUntil" TEXT,
         "endedAt" TEXT,
         "watchConnected" INTEGER NOT NULL DEFAULT 0 ${boolCheck('watchConnected', false)},
         "params" TEXT NOT NULL DEFAULT '{}',
         "applePhasesFetched" INTEGER NOT NULL DEFAULT 0 ${boolCheck('applePhasesFetched', false)},
         "createdAt" TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS "idx_NightSession_dateIso" ON "NightSession" ("dateIso" DESC)`,

      // --- SensorEpoch: 30 s grid, ~960 rows per night. --------------------------------
      // The unique index is both the D18 read index and the dedupe key (§0.5 S8): a
      // re-sent epoch replaces the stored one instead of doubling the night.
      `CREATE TABLE IF NOT EXISTS "SensorEpoch" (
         "id" INTEGER PRIMARY KEY AUTOINCREMENT,
         "sessionId" TEXT NOT NULL REFERENCES "NightSession" ("id") ON DELETE CASCADE,
         "t" INTEGER NOT NULL,
         "hrMean" REAL,
         "hrSd" REAL,
         "motion" REAL,
         "battery" REAL,
         "pRem" REAL,
         "state" TEXT,
         "source" TEXT NOT NULL ${enumCheck('source', SENSOR_SOURCES, false)}
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_SensorEpoch_sessionId_t" ON "SensorEpoch" ("sessionId", "t")`,

      // --- CueEvent: every whisper, played or not (a CONTROL night records played = 0). --
      // `type` has no CHECK: the cue vocabulary belongs to the audio controller (L2.6) and
      // must be free to grow without a migration. `index` is quoted everywhere (keyword).
      `CREATE TABLE IF NOT EXISTS "CueEvent" (
         "id" INTEGER PRIMARY KEY AUTOINCREMENT,
         "sessionId" TEXT NOT NULL REFERENCES "NightSession" ("id") ON DELETE CASCADE,
         "at" TEXT NOT NULL,
         "index" INTEGER NOT NULL,
         "volume" REAL NOT NULL CHECK ("volume" >= 0 AND "volume" <= 1),
         "type" TEXT NOT NULL CHECK (length("type") > 0),
         "pRemAtCue" REAL,
         "played" INTEGER NOT NULL ${boolCheck('played', false)},
         "response" TEXT NOT NULL DEFAULT 'NONE' ${enumCheck('response', CUE_RESPONSES, false)}
       )`,
      `CREATE INDEX IF NOT EXISTS "idx_CueEvent_sessionId_at" ON "CueEvent" ("sessionId", "at")`,

      // --- WakeEvent -------------------------------------------------------------------
      `CREATE TABLE IF NOT EXISTS "WakeEvent" (
         "id" INTEGER PRIMARY KEY AUTOINCREMENT,
         "sessionId" TEXT NOT NULL REFERENCES "NightSession" ("id") ON DELETE CASCADE,
         "at" TEXT NOT NULL,
         "durationSec" INTEGER,
         "cause" TEXT ${enumCheck('cause', WAKE_CAUSES)}
       )`,
      `CREATE INDEX IF NOT EXISTS "idx_WakeEvent_sessionId_at" ON "WakeEvent" ("sessionId", "at")`,

      // --- AppleSleepPhase: the morning ground truth from HealthKit (L2.9). -------------
      `CREATE TABLE IF NOT EXISTS "AppleSleepPhase" (
         "id" INTEGER PRIMARY KEY AUTOINCREMENT,
         "sessionId" TEXT NOT NULL REFERENCES "NightSession" ("id") ON DELETE CASCADE,
         "startIso" TEXT NOT NULL,
         "endIso" TEXT NOT NULL,
         "stage" TEXT NOT NULL ${enumCheck('stage', SLEEP_STAGES, false)}
       )`,
      `CREATE INDEX IF NOT EXISTS "idx_AppleSleepPhase_sessionId_start" ON "AppleSleepPhase" ("sessionId", "startIso")`,

      // --- MorningReport: sensitive (transcript / audioPath). --------------------------
      `CREATE TABLE IF NOT EXISTS "MorningReport" (
         "id" TEXT PRIMARY KEY NOT NULL,
         "sessionId" TEXT NOT NULL UNIQUE REFERENCES "NightSession" ("id") ON DELETE CASCADE,
         "dreamed" INTEGER CHECK ("dreamed" IS NULL OR ("dreamed" >= 0 AND "dreamed" <= 10)),
         "themeMatchUser" INTEGER CHECK ("themeMatchUser" IS NULL OR ("themeMatchUser" >= 0 AND "themeMatchUser" <= 10)),
         "lucid" TEXT ${enumCheck('lucid', LUCID_ANSWERS)},
         "sleepQuality" INTEGER CHECK ("sleepQuality" IS NULL OR ("sleepQuality" >= 0 AND "sleepQuality" <= 10)),
         "cueWoke" INTEGER ${boolCheck('cueWoke')},
         "audioPath" TEXT,
         "transcript" TEXT,
         "recordedAt" TEXT NOT NULL
       )`,

      // --- AiScore: one per report (L3.2). ---------------------------------------------
      `CREATE TABLE IF NOT EXISTS "AiScore" (
         "id" TEXT PRIMARY KEY NOT NULL,
         "reportId" TEXT NOT NULL UNIQUE REFERENCES "MorningReport" ("id") ON DELETE CASCADE,
         "themeMatch" REAL CHECK ("themeMatch" IS NULL OR ("themeMatch" >= 0 AND "themeMatch" <= 10)),
         "matchedTerms" TEXT NOT NULL DEFAULT '[]',
         "lucidSignals" TEXT,
         "tags" TEXT NOT NULL DEFAULT '[]',
         "summary" TEXT,
         "model" TEXT,
         "at" TEXT NOT NULL
       )`,

      // --- RealityCheck: daytime nudges (L3.3). ----------------------------------------
      `CREATE TABLE IF NOT EXISTS "RealityCheck" (
         "id" INTEGER PRIMARY KEY AUTOINCREMENT,
         "at" TEXT NOT NULL,
         "responded" TEXT NOT NULL DEFAULT 'NONE' ${enumCheck('responded', REALITY_CHECK_ANSWERS, false)},
         "createdAt" TEXT NOT NULL
       )`,

      // --- PersonalModel: one row (`id = 'me'`), rewritten by the learning loop (L3.4). --
      `CREATE TABLE IF NOT EXISTS "PersonalModel" (
         "id" TEXT PRIMARY KEY NOT NULL,
         "remWeights" TEXT NOT NULL DEFAULT '{}',
         "remHistogram" TEXT NOT NULL DEFAULT '[]',
         "volumeCeiling" REAL,
         "bestDelay" INTEGER,
         "cueTypeStats" TEXT NOT NULL DEFAULT '{}',
         "updatedAt" TEXT NOT NULL
       )`,

      // --- EarTest: exactly two rows per night (L / R). --------------------------------
      `CREATE TABLE IF NOT EXISTS "EarTest" (
         "id" INTEGER PRIMARY KEY AUTOINCREMENT,
         "sessionId" TEXT NOT NULL REFERENCES "NightSession" ("id") ON DELETE CASCADE,
         "side" TEXT NOT NULL ${enumCheck('side', EAR_SIDES, false)},
         "rounds" INTEGER,
         "answer" INTEGER,
         "attempts" INTEGER,
         "volume" REAL,
         "at" TEXT NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_EarTest_sessionId_side" ON "EarTest" ("sessionId", "side")`,
    ],
  },
];

export interface MigrateResult {
  /** Schema version after the run — always `SCHEMA_VERSION`. */
  version: number;
  /** Versions applied by *this* call. Empty on a second run (oracle D2). */
  applied: number[];
}

/** Version currently recorded in `_meta`, or 0 for a fresh database. */
export async function readSchemaVersion(db: DbDriver): Promise<number> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS "${META_TABLE}" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL)`,
  );
  const rows = await db.all<{ value: string }>(`SELECT "value" FROM "${META_TABLE}" WHERE "key" = ?`, [
    'schemaVersion',
  ]);
  const row = rows[0];
  if (row === undefined) return 0;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeSchemaVersion(db: DbDriver, version: number): Promise<void> {
  await db.run(
    `INSERT INTO "${META_TABLE}" ("key", "value") VALUES (?, ?)
       ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`,
    ['schemaVersion', String(version)],
  );
}

/**
 * Bring a database up to `SCHEMA_VERSION`. Idempotent (oracle D2): running it twice applies
 * nothing the second time, and every statement is `IF NOT EXISTS` so even a database whose
 * `_meta` row was lost comes back to a sane state instead of throwing.
 *
 * Each version is applied inside one transaction, so a half-applied migration cannot exist.
 */
export async function migrate(db: DbDriver): Promise<MigrateResult> {
  const current = await readSchemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `data: database is at schema ${current} but this build only knows ${SCHEMA_VERSION} — refusing to touch it`,
    );
  }
  const applied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.transaction(async () => {
      for (const statement of migration.statements) await db.exec(statement);
      await writeSchemaVersion(db, migration.version);
    });
    applied.push(migration.version);
  }

  if (applied.length === 0 && current !== SCHEMA_VERSION) await writeSchemaVersion(db, SCHEMA_VERSION);

  return { version: SCHEMA_VERSION, applied };
}

/** Column names of a table, in declaration order. Used by CSV/JSON export and import. */
export async function tableColumns(db: DbDriver, table: string): Promise<string[]> {
  const name = assertTableName(table);
  const rows = await db.all<{ name: string }>(`PRAGMA table_info("${name}")`);
  return rows.map((row) => row.name);
}

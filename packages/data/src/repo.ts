/**
 * The repository — the only place in the product that writes SQL (oracle D4–D14 · D19–D22).
 *
 * Shape of the contract: `createRepo(db, clock)` returns one object with a small group per
 * table plus the queries the screens actually need (`nightReport`, `lastNights`, `stats`) and
 * the owner-facing operations (`exportJson`, `importJson`, `exportCsv`, `deleteAll`,
 * `diagnosticsDraft`).
 *
 * Hard rules held here:
 *   - every value goes through a bound parameter; only whitelisted identifiers are ever
 *     interpolated into SQL (oracle D20);
 *   - every timestamp written is ISO UTC ending in `Z` (oracle D15), stamped from the
 *     injected clock — never `Date.now()` (APP-RUN §0.2 rule 6);
 *   - list/record values are stored as JSON text columns;
 *   - dream text and audio paths are treated as sensitive on the way out (§0.5 S4/S5).
 */

import { epochCoverage, type Clock, type SensorEpoch } from '@lucid/engine';

import { assertTableName, tableColumns, SCHEMA_VERSION, TABLES } from './schema';
import {
  CUE_RESPONSES,
  EAR_SIDES,
  LUCID_ANSWERS,
  SENSOR_SOURCES,
  SESSION_MODES,
  SLEEP_STAGES,
  WAKE_CAUSES,
  type CueResponse,
  type EarSide,
  type LucidAnswer,
  type SessionMode,
  type SleepStage,
  type TableName,
  type WakeCause,
} from './schema';
import { first, type DbDriver, type Row, type SqlParam } from './driver';
import { stripSensitive } from './sensitive';
import { dateIsoOf, isoFromEpochSeconds, shiftDateIso, toDateIso, toIsoUtc, toIsoUtcOrNull } from './time';

/**
 * All the repo needs from a clock. `systemClock` and the test clocks of `@lucid/engine`
 * both satisfy it, so the `Clock` interface stays the single source of truth for time.
 */
export type RepoClock = Pick<Clock, 'nowIso'>;

// ---------------------------------------------------------------------------
// Records (what the repo returns — JSON columns parsed, 0/1 turned into booleans)
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  dateIso: string;
  themeId: string | null;
  themeKey: string | null;
  mode: SessionMode;
  startedAt: string;
  onsetAt: string | null;
  guardUntil: string | null;
  endedAt: string | null;
  watchConnected: boolean;
  params: Record<string, unknown>;
  applePhasesFetched: boolean;
  createdAt: string;
}

export interface EpochRecord {
  id: number;
  sessionId: string;
  t: number;
  hrMean: number | null;
  hrSd: number | null;
  motion: number | null;
  battery: number | null;
  pRem: number | null;
  state: string | null;
  source: string;
}

export interface CueRecord {
  id: number;
  sessionId: string;
  at: string;
  index: number;
  volume: number;
  type: string;
  pRemAtCue: number | null;
  played: boolean;
  response: CueResponse;
}

export interface WakeRecord {
  id: number;
  sessionId: string;
  at: string;
  durationSec: number | null;
  cause: WakeCause | null;
}

export interface ApplePhaseRecord {
  id: number;
  sessionId: string;
  startIso: string;
  endIso: string;
  stage: SleepStage;
}

export interface ReportRecord {
  id: string;
  sessionId: string;
  dreamed: number | null;
  themeMatchUser: number | null;
  lucid: LucidAnswer | null;
  sleepQuality: number | null;
  cueWoke: boolean | null;
  audioPath: string | null;
  transcript: string | null;
  recordedAt: string;
}

export interface AiScoreRecord {
  id: string;
  reportId: string;
  themeMatch: number | null;
  matchedTerms: string[];
  lucidSignals: unknown;
  tags: string[];
  summary: string | null;
  model: string | null;
  at: string;
}

export interface EarTestRecord {
  id: number;
  sessionId: string;
  side: EarSide;
  rounds: number | null;
  answer: number | null;
  attempts: number | null;
  volume: number | null;
  at: string;
}

/** One row of the night timeline (DESIGN §7 · mockup 07 "เหตุการณ์ทุกเสียง"). */
export type NightEventKind =
  | 'START'
  | 'SEED'
  | 'ONSET'
  | 'GUARD_END'
  | 'REM_LIKELY'
  | 'CUE'
  | 'WAKE'
  | 'END'
  | 'REPORT';

export interface NightEvent {
  at: string;
  kind: NightEventKind;
  [extra: string]: unknown;
}

export interface NightReport {
  session: SessionRecord;
  epochs: EpochRecord[];
  cues: CueRecord[];
  wakes: WakeRecord[];
  applePhases: ApplePhaseRecord[];
  report: ReportRecord | null;
  aiScore: AiScoreRecord | null;
  earTests: EarTestRecord[];
  /** Everything above merged and sorted by `at` (oracle D8). */
  events: NightEvent[];
}

export interface NightSummary extends SessionRecord {
  epochCount: number;
  cueCount: number;
  playedCueCount: number;
  wakeCount: number;
  lucid: LucidAnswer | null;
  themeMatchUser: number | null;
  dreamed: number | null;
  sleepQuality: number | null;
  hasReport: boolean;
}

export interface StatsResult {
  /** Nights in the window that have a MorningReport — the only nights that can be scored. */
  nights: number;
  cueNights: number;
  controlNights: number;
  lucidRateCue: number;
  lucidRateControl: number;
  themeMatchAvg: number;
  windowDays: number;
  fromDateIso: string;
}

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Row[]>;
}

export interface DeleteAllResult {
  /** Audio files the caller must now delete from disk (§0.5 S4 · oracle D16). */
  audioPaths: string[];
  /** Rows removed per table. */
  deleted: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  dateIso: string;
  mode: SessionMode;
  themeKey?: string | null;
  themeId?: string | null;
  params?: Record<string, unknown>;
  startedAt?: string;
  watchConnected?: boolean;
  /** Only for fixtures / import. Normally generated. */
  id?: string;
}

/** A sensor epoch as the engine defines it, plus the two fields only the DB keeps. */
export type EpochInput = SensorEpoch & { pRem?: number | null; state?: string | null };

export interface CueInput {
  at: string;
  index: number;
  volume: number;
  type: string;
  pRemAtCue?: number | null;
  played: boolean;
  response?: CueResponse;
}

export interface WakeInput {
  at: string;
  durationSec?: number | null;
  cause?: WakeCause | null;
}

export interface EarTestInput {
  sessionId: string;
  side: EarSide;
  rounds?: number | null;
  answer?: number | null;
  attempts?: number | null;
  volume?: number | null;
  at?: string;
}

export interface ReportInput {
  sessionId: string;
  dreamed?: number | null;
  themeMatchUser?: number | null;
  lucid?: LucidAnswer | null;
  sleepQuality?: number | null;
  cueWoke?: boolean | null;
  transcript?: string | null;
  audioPath?: string | null;
  recordedAt?: string;
}

export interface ApplePhaseInput {
  startIso: string;
  endIso: string;
  stage: SleepStage;
}

export interface AiScoreInput {
  reportId: string;
  themeMatch?: number | null;
  matchedTerms?: string[] | null;
  lucidSignals?: unknown;
  tags?: string[] | null;
  summary?: string | null;
  model?: string | null;
  at?: string;
}

export interface DiagnosticsDraftOptions {
  /** §0.5 S5: dream text and audio paths are excluded unless this is explicitly `true`. */
  includeText?: boolean;
  /** How many recent nights to describe. Default 7. */
  nights?: number;
  /** Only this night (the "export tonight" button of mockup 07). */
  sessionId?: string;
  /** Device/app facts the data layer cannot know — the app fills these in. */
  appVersion?: string;
  buildNumber?: string | null;
  device?: Record<string, unknown>;
  sensors?: unknown[];
  audioEvents?: unknown[];
  batterySamples?: unknown[];
  warnings?: string[];
}

export interface DiagnosticsNightSummary {
  sessionId: string;
  dateIso: string;
  mode: SessionMode;
  themeKey: string | null;
  startedAt: string;
  endedAt: string | null;
  epochs: number;
  continuity: number;
  gaps: number;
  longestGapSeconds: number;
  cues: number;
  playedCues: number;
  wakes: number;
  earTests: number;
  lucid: LucidAnswer | null;
  themeMatchUser: number | null;
  hasTranscript: boolean;
  hasAudio: boolean;
  /** Only present when `includeText: true`. */
  transcript?: string | null;
  audioPath?: string | null;
  summary?: string | null;
}

/** `DiagnosticsDraft` of `@lucid/engine` plus the nights block (kept alongside the file). */
export interface DataDiagnosticsDraft {
  appVersion: string;
  buildNumber: string | null;
  device: Record<string, unknown>;
  sensors: unknown[];
  epochs: SensorEpoch[];
  audioEvents: unknown[];
  batterySamples: unknown[];
  warnings: string[];
  nights: DiagnosticsNightSummary[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CUE_RESPONSE_SET: ReadonlySet<string> = new Set<string>(CUE_RESPONSES);
const MODE_SET: ReadonlySet<string> = new Set<string>(SESSION_MODES);
const WAKE_CAUSE_SET: ReadonlySet<string> = new Set<string>(WAKE_CAUSES);
const STAGE_SET: ReadonlySet<string> = new Set<string>(SLEEP_STAGES);
const SIDE_SET: ReadonlySet<string> = new Set<string>(EAR_SIDES);
const LUCID_SET: ReadonlySet<string> = new Set<string>(LUCID_ANSWERS);
const SOURCE_SET: ReadonlySet<string> = new Set<string>(SENSOR_SOURCES);

/** Lucid answer → reward used by stats and, later, by the learning loop (L3.4). */
export const LUCID_VALUE: Record<LucidAnswer, number> = { YES: 1, UNSURE: 0.3, NO: 0 };

/** Threshold at which a stored `pRem` counts as "REM likely" on the timeline. */
export const REM_LIKELY_THRESHOLD = 0.5;

function assertEnum<T extends string>(value: unknown, allowed: ReadonlySet<string>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`data: ${field} must be one of ${[...allowed].join('/')}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
): T | null {
  if (value === null || value === undefined) return null;
  return assertEnum<T>(value, allowed, field);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`data: expected a number, got ${JSON.stringify(value)}`);
  return parsed;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function bool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return value === 1 || value === true || value === '1';
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

let idCounter = 0;

/**
 * Local-only identifier: `<prefix>_<ms base36><counter><random>`. Sortable by creation time,
 * unique enough for one phone; the server (L3.2) never sees it.
 */
function newId(prefix: string, nowIso: string): string {
  idCounter = (idCounter + 1) % 46_656;
  const ms = Date.parse(nowIso);
  const stamp = (Number.isFinite(ms) ? ms : 0).toString(36);
  const seq = idCounter.toString(36).padStart(3, '0');
  const random = Math.floor(Math.random() * 46_656)
    .toString(36)
    .padStart(3, '0');
  return `${prefix}_${stamp}${seq}${random}`;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapSession(row: Row): SessionRecord {
  return {
    id: String(row.id),
    dateIso: String(row.dateIso),
    themeId: str(row.themeId),
    themeKey: str(row.themeKey),
    mode: row.mode as SessionMode,
    startedAt: String(row.startedAt),
    onsetAt: str(row.onsetAt),
    guardUntil: str(row.guardUntil),
    endedAt: str(row.endedAt),
    watchConnected: bool(row.watchConnected) ?? false,
    params: parseJson<Record<string, unknown>>(row.params, {}),
    applePhasesFetched: bool(row.applePhasesFetched) ?? false,
    createdAt: String(row.createdAt),
  };
}

function mapEpoch(row: Row): EpochRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.sessionId),
    t: Number(row.t),
    hrMean: num(row.hrMean),
    hrSd: num(row.hrSd),
    motion: num(row.motion),
    battery: num(row.battery),
    pRem: num(row.pRem),
    state: str(row.state),
    source: String(row.source),
  };
}

function mapCue(row: Row): CueRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.sessionId),
    at: String(row.at),
    index: Number(row.index),
    volume: Number(row.volume),
    type: String(row.type),
    pRemAtCue: num(row.pRemAtCue),
    played: bool(row.played) ?? false,
    response: row.response as CueResponse,
  };
}

function mapWake(row: Row): WakeRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.sessionId),
    at: String(row.at),
    durationSec: num(row.durationSec),
    cause: (str(row.cause) as WakeCause | null) ?? null,
  };
}

function mapApplePhase(row: Row): ApplePhaseRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.sessionId),
    startIso: String(row.startIso),
    endIso: String(row.endIso),
    stage: row.stage as SleepStage,
  };
}

function mapReport(row: Row): ReportRecord {
  return {
    id: String(row.id),
    sessionId: String(row.sessionId),
    dreamed: num(row.dreamed),
    themeMatchUser: num(row.themeMatchUser),
    lucid: (str(row.lucid) as LucidAnswer | null) ?? null,
    sleepQuality: num(row.sleepQuality),
    cueWoke: bool(row.cueWoke),
    audioPath: str(row.audioPath),
    transcript: str(row.transcript),
    recordedAt: String(row.recordedAt),
  };
}

function mapAiScore(row: Row): AiScoreRecord {
  return {
    id: String(row.id),
    reportId: String(row.reportId),
    themeMatch: num(row.themeMatch),
    matchedTerms: parseJson<string[]>(row.matchedTerms, []),
    lucidSignals: parseJson<unknown>(row.lucidSignals, null),
    tags: parseJson<string[]>(row.tags, []),
    summary: str(row.summary),
    model: str(row.model),
    at: String(row.at),
  };
}

function mapEarTest(row: Row): EarTestRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.sessionId),
    side: row.side as EarSide,
    rounds: num(row.rounds),
    answer: num(row.answer),
    attempts: num(row.attempts),
    volume: num(row.volume),
    at: String(row.at),
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC4180-ish: quote when needed, double the quotes inside, NULL becomes an empty field. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

// ---------------------------------------------------------------------------
// The repo
// ---------------------------------------------------------------------------

export interface Repo {
  readonly db: DbDriver;
  sessions: {
    create(input: CreateSessionInput): Promise<SessionRecord>;
    get(id: string): Promise<SessionRecord | null>;
    appendEpoch(sessionId: string, epoch: EpochInput): Promise<void>;
    appendEpochs(sessionId: string, epochs: readonly EpochInput[]): Promise<void>;
    appendCue(sessionId: string, cue: CueInput): Promise<CueRecord>;
    appendWake(sessionId: string, wake: WakeInput): Promise<WakeRecord>;
    markOnset(sessionId: string, onsetAtIso: string, guardUntilIso?: string | null): Promise<void>;
    setCueResponse(cueId: number, response: CueResponse): Promise<void>;
    finish(sessionId: string, endedAtIso: string): Promise<SessionRecord>;
  };
  earTests: {
    record(input: EarTestInput): Promise<EarTestRecord>;
    forSession(sessionId: string): Promise<EarTestRecord[]>;
  };
  reports: {
    save(input: ReportInput): Promise<ReportRecord>;
    forSession(sessionId: string): Promise<ReportRecord | null>;
  };
  applePhases: {
    saveMany(sessionId: string, phases: readonly ApplePhaseInput[]): Promise<ApplePhaseRecord[]>;
    forSession(sessionId: string): Promise<ApplePhaseRecord[]>;
  };
  ai: {
    save(input: AiScoreInput): Promise<AiScoreRecord>;
    forReport(reportId: string): Promise<AiScoreRecord | null>;
  };
  nightReport(sessionId: string): Promise<NightReport>;
  lastNights(n: number): Promise<NightSummary[]>;
  stats(days: number): Promise<StatsResult>;
  exportJson(): Promise<ExportBundle>;
  importJson(bundle: ExportBundle): Promise<{ imported: Record<string, number> }>;
  exportCsv(table: string): Promise<string>;
  deleteAll(): Promise<DeleteAllResult>;
  diagnosticsDraft(options?: DiagnosticsDraftOptions): Promise<DataDiagnosticsDraft>;
}

export function createRepo(db: DbDriver, clock: RepoClock): Repo {
  const now = (): string => toIsoUtc(clock.nowIso());

  async function requireSession(sessionId: string): Promise<SessionRecord> {
    const session = await getSession(sessionId);
    if (session === null) throw new Error(`data: unknown session "${sessionId}"`);
    return session;
  }

  async function getSession(sessionId: string): Promise<SessionRecord | null> {
    const row = await first<Row>(db, `SELECT * FROM "NightSession" WHERE "id" = ?`, [sessionId]);
    return row === null ? null : mapSession(row);
  }

  async function reportForSession(sessionId: string): Promise<ReportRecord | null> {
    const row = await first<Row>(db, `SELECT * FROM "MorningReport" WHERE "sessionId" = ?`, [sessionId]);
    return row === null ? null : mapReport(row);
  }

  async function aiForReport(reportId: string): Promise<AiScoreRecord | null> {
    const row = await first<Row>(db, `SELECT * FROM "AiScore" WHERE "reportId" = ?`, [reportId]);
    return row === null ? null : mapAiScore(row);
  }

  const sessions: Repo['sessions'] = {
    async create(input) {
      const mode = assertEnum<SessionMode>(input.mode, MODE_SET, 'NightSession.mode');
      const dateIso = toDateIso(input.dateIso);
      const createdAt = now();
      const startedAt = toIsoUtc(input.startedAt ?? createdAt);
      const id = input.id ?? newId('ns', createdAt);

      // Only link a Theme row that really exists: a night may start from a theme the owner
      // just typed, which is not saved as a Theme until L1.4/L3.5 decides to keep it.
      let themeId = input.themeId ?? null;
      if (themeId === null && typeof input.themeKey === 'string' && input.themeKey !== '') {
        const theme = await first<Row>(db, `SELECT "id" FROM "Theme" WHERE "key" = ?`, [input.themeKey]);
        themeId = theme === null ? null : String(theme.id);
      }

      await db.run(
        `INSERT INTO "NightSession"
           ("id","dateIso","themeId","themeKey","mode","startedAt","onsetAt","guardUntil","endedAt",
            "watchConnected","params","applePhasesFetched","createdAt")
         VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?,?,0,?)`,
        [
          id,
          dateIso,
          themeId,
          input.themeKey ?? null,
          mode,
          startedAt,
          input.watchConnected === true ? 1 : 0,
          JSON.stringify(input.params ?? {}),
          createdAt,
        ],
      );

      return requireSession(id);
    },

    get: getSession,

    async appendEpoch(sessionId, epoch) {
      const t = Number(epoch.t);
      if (!Number.isInteger(t) || t < 0) throw new Error(`data: SensorEpoch.t must be a non-negative integer`);
      assertEnum(epoch.source, SOURCE_SET, 'SensorEpoch.source');

      await db.run(
        `INSERT INTO "SensorEpoch" ("sessionId","t","hrMean","hrSd","motion","battery","pRem","state","source")
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT ("sessionId","t") DO UPDATE SET
           "hrMean" = excluded."hrMean",
           "hrSd" = excluded."hrSd",
           "motion" = excluded."motion",
           "battery" = excluded."battery",
           "pRem" = COALESCE(excluded."pRem", "SensorEpoch"."pRem"),
           "state" = COALESCE(excluded."state", "SensorEpoch"."state"),
           "source" = excluded."source"`,
        [
          sessionId,
          t,
          epoch.hrMean ?? null,
          epoch.hrSd ?? null,
          epoch.motion ?? null,
          epoch.battery ?? null,
          epoch.pRem ?? null,
          epoch.state ?? null,
          epoch.source,
        ],
      );
    },

    async appendEpochs(sessionId, epochs) {
      await db.transaction(async () => {
        for (const epoch of epochs) await sessions.appendEpoch(sessionId, epoch);
      });
    },

    async appendCue(sessionId, cue) {
      const response = assertEnum<CueResponse>(
        cue.response ?? 'NONE',
        CUE_RESPONSE_SET,
        'CueEvent.response',
      );
      const at = toIsoUtc(cue.at);
      const index = Number(cue.index);
      const volume = Number(cue.volume);
      if (!Number.isInteger(index) || index < 0) throw new Error('data: CueEvent.index must be an integer ≥ 0');
      if (!(volume >= 0 && volume <= 1)) throw new Error('data: CueEvent.volume must be within 0..1');
      if (typeof cue.type !== 'string' || cue.type === '') throw new Error('data: CueEvent.type is required');
      if (typeof cue.played !== 'boolean') throw new Error('data: CueEvent.played must be a boolean');

      await db.run(
        `INSERT INTO "CueEvent" ("sessionId","at","index","volume","type","pRemAtCue","played","response")
         VALUES (?,?,?,?,?,?,?,?)`,
        [sessionId, at, index, volume, cue.type, cue.pRemAtCue ?? null, cue.played ? 1 : 0, response],
      );

      const row = await first<Row>(
        db,
        `SELECT * FROM "CueEvent" WHERE "sessionId" = ? ORDER BY "id" DESC LIMIT 1`,
        [sessionId],
      );
      if (row === null) throw new Error('data: cue was not stored');
      return mapCue(row);
    },

    async appendWake(sessionId, wake) {
      const at = toIsoUtc(wake.at);
      const cause = optionalEnum<WakeCause>(wake.cause ?? null, WAKE_CAUSE_SET, 'WakeEvent.cause');
      await db.run(
        `INSERT INTO "WakeEvent" ("sessionId","at","durationSec","cause") VALUES (?,?,?,?)`,
        [sessionId, at, wake.durationSec ?? null, cause],
      );
      const row = await first<Row>(
        db,
        `SELECT * FROM "WakeEvent" WHERE "sessionId" = ? ORDER BY "id" DESC LIMIT 1`,
        [sessionId],
      );
      if (row === null) throw new Error('data: wake event was not stored');
      return mapWake(row);
    },

    async markOnset(sessionId, onsetAtIso, guardUntilIso) {
      const result = await db.run(
        `UPDATE "NightSession" SET "onsetAt" = ?, "guardUntil" = COALESCE(?, "guardUntil") WHERE "id" = ?`,
        [toIsoUtc(onsetAtIso), toIsoUtcOrNull(guardUntilIso ?? null), sessionId],
      );
      if (result.changes === 0) throw new Error(`data: unknown session "${sessionId}"`);
    },

    async setCueResponse(cueId, response) {
      const value = assertEnum<CueResponse>(response, CUE_RESPONSE_SET, 'CueEvent.response');
      const result = await db.run(`UPDATE "CueEvent" SET "response" = ? WHERE "id" = ?`, [value, cueId]);
      if (result.changes === 0) throw new Error(`data: unknown cue ${cueId}`);
    },

    async finish(sessionId, endedAtIso) {
      const result = await db.run(`UPDATE "NightSession" SET "endedAt" = ? WHERE "id" = ?`, [
        toIsoUtc(endedAtIso),
        sessionId,
      ]);
      if (result.changes === 0) throw new Error(`data: unknown session "${sessionId}"`);
      return requireSession(sessionId);
    },
  };

  const earTests: Repo['earTests'] = {
    async record(input) {
      const side = assertEnum<EarSide>(input.side, SIDE_SET, 'EarTest.side');
      // UNIQUE(sessionId, side) + upsert: re-testing an ear replaces its row, so a night can
      // never hold three ear tests (oracle D6).
      await db.run(
        `INSERT INTO "EarTest" ("sessionId","side","rounds","answer","attempts","volume","at")
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT ("sessionId","side") DO UPDATE SET
           "rounds" = excluded."rounds",
           "answer" = excluded."answer",
           "attempts" = excluded."attempts",
           "volume" = excluded."volume",
           "at" = excluded."at"`,
        [
          input.sessionId,
          side,
          input.rounds ?? null,
          input.answer ?? null,
          input.attempts ?? null,
          input.volume ?? null,
          toIsoUtc(input.at ?? now()),
        ],
      );
      const row = await first<Row>(db, `SELECT * FROM "EarTest" WHERE "sessionId" = ? AND "side" = ?`, [
        input.sessionId,
        side,
      ]);
      if (row === null) throw new Error('data: ear test was not stored');
      return mapEarTest(row);
    },

    async forSession(sessionId) {
      const rows = await db.all<Row>(
        `SELECT * FROM "EarTest" WHERE "sessionId" = ? ORDER BY "side" ASC, "id" ASC`,
        [sessionId],
      );
      return rows.map(mapEarTest);
    },
  };

  const reports: Repo['reports'] = {
    async save(input) {
      const existing = await reportForSession(input.sessionId);
      const recordedAt = toIsoUtc(input.recordedAt ?? now());
      const id = existing?.id ?? newId('mr', recordedAt);
      const lucid = optionalEnum<LucidAnswer>(input.lucid ?? null, LUCID_SET, 'MorningReport.lucid');

      // One report per night; `save` writes the whole row, so the morning screen can send
      // the same object again after an edit (oracle D7: every field but sessionId may be null).
      await db.run(
        `INSERT INTO "MorningReport"
           ("id","sessionId","dreamed","themeMatchUser","lucid","sleepQuality","cueWoke","audioPath","transcript","recordedAt")
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT ("sessionId") DO UPDATE SET
           "dreamed" = excluded."dreamed",
           "themeMatchUser" = excluded."themeMatchUser",
           "lucid" = excluded."lucid",
           "sleepQuality" = excluded."sleepQuality",
           "cueWoke" = excluded."cueWoke",
           "audioPath" = excluded."audioPath",
           "transcript" = excluded."transcript",
           "recordedAt" = excluded."recordedAt"`,
        [
          id,
          input.sessionId,
          input.dreamed ?? null,
          input.themeMatchUser ?? null,
          lucid,
          input.sleepQuality ?? null,
          input.cueWoke === null || input.cueWoke === undefined ? null : input.cueWoke ? 1 : 0,
          input.audioPath ?? null,
          input.transcript ?? null,
          recordedAt,
        ],
      );

      const saved = await reportForSession(input.sessionId);
      if (saved === null) throw new Error('data: morning report was not stored');
      return saved;
    },

    forSession: reportForSession,
  };

  const applePhases: Repo['applePhases'] = {
    async saveMany(sessionId, phases) {
      await db.transaction(async () => {
        await db.run(`DELETE FROM "AppleSleepPhase" WHERE "sessionId" = ?`, [sessionId]);
        for (const phase of phases) {
          const stage = assertEnum<SleepStage>(phase.stage, STAGE_SET, 'AppleSleepPhase.stage');
          await db.run(
            `INSERT INTO "AppleSleepPhase" ("sessionId","startIso","endIso","stage") VALUES (?,?,?,?)`,
            [sessionId, toIsoUtc(phase.startIso), toIsoUtc(phase.endIso), stage],
          );
        }
        await db.run(`UPDATE "NightSession" SET "applePhasesFetched" = 1 WHERE "id" = ?`, [sessionId]);
      });
      return applePhases.forSession(sessionId);
    },

    async forSession(sessionId) {
      const rows = await db.all<Row>(
        `SELECT * FROM "AppleSleepPhase" WHERE "sessionId" = ? ORDER BY "startIso" ASC, "id" ASC`,
        [sessionId],
      );
      return rows.map(mapApplePhase);
    },
  };

  const ai: Repo['ai'] = {
    async save(input) {
      const existing = await aiForReport(input.reportId);
      const at = toIsoUtc(input.at ?? now());
      const id = existing?.id ?? newId('ai', at);
      await db.run(
        `INSERT INTO "AiScore" ("id","reportId","themeMatch","matchedTerms","lucidSignals","tags","summary","model","at")
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT ("reportId") DO UPDATE SET
           "themeMatch" = excluded."themeMatch",
           "matchedTerms" = excluded."matchedTerms",
           "lucidSignals" = excluded."lucidSignals",
           "tags" = excluded."tags",
           "summary" = excluded."summary",
           "model" = excluded."model",
           "at" = excluded."at"`,
        [
          id,
          input.reportId,
          input.themeMatch ?? null,
          JSON.stringify(input.matchedTerms ?? []),
          JSON.stringify(input.lucidSignals ?? null),
          JSON.stringify(input.tags ?? []),
          input.summary ?? null,
          input.model ?? null,
          at,
        ],
      );
      const saved = await aiForReport(input.reportId);
      if (saved === null) throw new Error('data: ai score was not stored');
      return saved;
    },

    forReport: aiForReport,
  };

  function buildEvents(input: {
    session: SessionRecord;
    epochs: EpochRecord[];
    cues: CueRecord[];
    wakes: WakeRecord[];
    report: ReportRecord | null;
  }): NightEvent[] {
    const { session, epochs, cues, wakes, report } = input;
    const events: NightEvent[] = [];

    events.push({
      at: session.startedAt,
      kind: 'START',
      sessionId: session.id,
      mode: session.mode,
      themeKey: session.themeKey,
    });
    if (session.onsetAt !== null) events.push({ at: session.onsetAt, kind: 'ONSET' });
    if (session.guardUntil !== null) events.push({ at: session.guardUntil, kind: 'GUARD_END' });

    // A rising edge of pRem is what the report screen draws as "REM likely" (mockup 07).
    let above = false;
    for (const epoch of epochs) {
      if (epoch.pRem === null) continue;
      const isAbove = epoch.pRem >= REM_LIKELY_THRESHOLD;
      if (isAbove && !above) events.push({ at: isoFromEpochSeconds(epoch.t), kind: 'REM_LIKELY', pRem: epoch.pRem });
      above = isAbove;
    }

    for (const cue of cues) {
      events.push({
        at: cue.at,
        // The two seed whispers at onset are the same table with `type = 'SEED'`.
        kind: cue.type.toUpperCase() === 'SEED' ? 'SEED' : 'CUE',
        cueId: cue.id,
        index: cue.index,
        volume: cue.volume,
        type: cue.type,
        played: cue.played,
        response: cue.response,
        pRemAtCue: cue.pRemAtCue,
      });
    }

    for (const wake of wakes) {
      events.push({ at: wake.at, kind: 'WAKE', durationSec: wake.durationSec, cause: wake.cause });
    }

    if (session.endedAt !== null) events.push({ at: session.endedAt, kind: 'END' });
    if (report !== null) {
      events.push({
        at: report.recordedAt,
        kind: 'REPORT',
        lucid: report.lucid,
        themeMatchUser: report.themeMatchUser,
        dreamed: report.dreamed,
      });
    }

    // Stored timestamps are all ISO UTC with the same shape, so a string compare is a time
    // compare. `Array.prototype.sort` is stable, so equal timestamps keep the order above.
    return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  async function nightReport(sessionId: string): Promise<NightReport> {
    const session = await requireSession(sessionId);
    const [epochRows, cueRows, wakeRows] = [
      await db.all<Row>(`SELECT * FROM "SensorEpoch" WHERE "sessionId" = ? ORDER BY "t" ASC`, [sessionId]),
      await db.all<Row>(`SELECT * FROM "CueEvent" WHERE "sessionId" = ? ORDER BY "at" ASC, "index" ASC`, [
        sessionId,
      ]),
      await db.all<Row>(`SELECT * FROM "WakeEvent" WHERE "sessionId" = ? ORDER BY "at" ASC`, [sessionId]),
    ];
    const epochs = epochRows.map(mapEpoch);
    const cues = cueRows.map(mapCue);
    const wakes = wakeRows.map(mapWake);
    const phases = await applePhases.forSession(sessionId);
    const report = await reportForSession(sessionId);
    const aiScore = report === null ? null : await aiForReport(report.id);
    const tests = await earTests.forSession(sessionId);

    return {
      session,
      epochs,
      cues,
      wakes,
      applePhases: phases,
      report,
      aiScore,
      earTests: tests,
      events: buildEvents({ session, epochs, cues, wakes, report }),
    };
  }

  async function lastNights(n: number): Promise<NightSummary[]> {
    const limit = Math.max(0, Math.floor(n));
    if (limit === 0) return [];
    const rows = await db.all<Row>(
      `SELECT s.*,
              r."lucid" AS "r_lucid",
              r."themeMatchUser" AS "r_themeMatchUser",
              r."dreamed" AS "r_dreamed",
              r."sleepQuality" AS "r_sleepQuality",
              r."id" AS "r_id",
              (SELECT COUNT(*) FROM "SensorEpoch" e WHERE e."sessionId" = s."id") AS "epochCount",
              (SELECT COUNT(*) FROM "CueEvent" c WHERE c."sessionId" = s."id") AS "cueCount",
              (SELECT COUNT(*) FROM "CueEvent" c WHERE c."sessionId" = s."id" AND c."played" = 1) AS "playedCueCount",
              (SELECT COUNT(*) FROM "WakeEvent" w WHERE w."sessionId" = s."id") AS "wakeCount"
         FROM "NightSession" s
         LEFT JOIN "MorningReport" r ON r."sessionId" = s."id"
        ORDER BY s."dateIso" DESC, s."startedAt" DESC, s."id" DESC
        LIMIT ?`,
      [limit],
    );

    return rows.map((row) => ({
      ...mapSession(row),
      epochCount: Number(row.epochCount ?? 0),
      cueCount: Number(row.cueCount ?? 0),
      playedCueCount: Number(row.playedCueCount ?? 0),
      wakeCount: Number(row.wakeCount ?? 0),
      lucid: (str(row.r_lucid) as LucidAnswer | null) ?? null,
      themeMatchUser: num(row.r_themeMatchUser),
      dreamed: num(row.r_dreamed),
      sleepQuality: num(row.r_sleepQuality),
      hasReport: row.r_id !== null && row.r_id !== undefined,
    }));
  }

  /**
   * Cue vs control over the last `days` nights (oracle D10 · mockup 08).
   *
   * Only nights with a MorningReport count: a night nobody reported on says nothing about
   * whether the whisper worked. `dateIso` is a *local* night label, so the window is only
   * bounded below — a night labelled "tomorrow" for a user east of UTC must still count.
   */
  async function stats(days: number): Promise<StatsResult> {
    const windowDays = Math.max(1, Math.floor(days));
    const fromDateIso = shiftDateIso(dateIsoOf(clock.nowIso()), -(windowDays - 1));
    const rows = await db.all<Row>(
      `SELECT s."mode" AS "mode", r."lucid" AS "lucid", r."themeMatchUser" AS "themeMatchUser"
         FROM "NightSession" s
         JOIN "MorningReport" r ON r."sessionId" = s."id"
        WHERE s."dateIso" >= ?`,
      [fromDateIso],
    );

    let cueNights = 0;
    let controlNights = 0;
    let cueSum = 0;
    let controlSum = 0;
    let themeMatchSum = 0;
    let themeMatchCount = 0;

    for (const row of rows) {
      const lucid = str(row.lucid) as LucidAnswer | null;
      const value = lucid === null ? 0 : (LUCID_VALUE[lucid] ?? 0);
      if (row.mode === 'CONTROL') {
        controlNights += 1;
        controlSum += value;
      } else {
        cueNights += 1;
        cueSum += value;
      }
      const themeMatch = num(row.themeMatchUser);
      if (themeMatch !== null) {
        themeMatchSum += themeMatch;
        themeMatchCount += 1;
      }
    }

    return {
      nights: rows.length,
      cueNights,
      controlNights,
      lucidRateCue: cueNights === 0 ? 0 : cueSum / cueNights,
      lucidRateControl: controlNights === 0 ? 0 : controlSum / controlNights,
      themeMatchAvg: themeMatchCount === 0 ? 0 : themeMatchSum / themeMatchCount,
      windowDays,
      fromDateIso,
    };
  }

  /**
   * Whole-database dump (oracle D11). Rows are the raw stored values in `rowid` order and the
   * tables come in `TABLES` order, so two exports of the same data are byte-identical and an
   * import → export round trip is stable.
   */
  async function exportJson(): Promise<ExportBundle> {
    const tables: Record<string, Row[]> = {};
    for (const table of TABLES) {
      tables[table] = await db.all<Row>(`SELECT * FROM "${table}" ORDER BY "rowid" ASC`);
    }
    return { schemaVersion: SCHEMA_VERSION, exportedAt: now(), tables };
  }

  /** Replace everything with `bundle`, all inside one transaction (oracle D11). */
  async function importJson(bundle: ExportBundle): Promise<{ imported: Record<string, number> }> {
    if (bundle === null || typeof bundle !== 'object' || typeof bundle.tables !== 'object') {
      throw new Error('data: import expects { schemaVersion, exportedAt, tables }');
    }
    if (Number(bundle.schemaVersion) !== SCHEMA_VERSION) {
      throw new Error(
        `data: cannot import schema ${String(bundle.schemaVersion)} into schema ${SCHEMA_VERSION}`,
      );
    }

    const columnsByTable = new Map<TableName, string[]>();
    for (const table of TABLES) columnsByTable.set(table, await tableColumns(db, table));

    const imported: Record<string, number> = {};

    await db.transaction(async () => {
      // Children first so foreign keys hold while the old data goes away.
      for (const table of [...TABLES].reverse()) await db.run(`DELETE FROM "${table}"`);

      for (const table of TABLES) {
        const rows = bundle.tables[table] ?? [];
        if (!Array.isArray(rows)) throw new Error(`data: tables.${table} must be an array`);
        const allowed = columnsByTable.get(table) as string[];
        let count = 0;

        for (const row of rows) {
          if (row === null || typeof row !== 'object') throw new Error(`data: bad row in ${table}`);
          const keys = Object.keys(row).filter((key) => allowed.includes(key));
          const unknownKey = Object.keys(row).find((key) => !allowed.includes(key));
          if (unknownKey !== undefined) {
            throw new Error(`data: ${table} has no column "${unknownKey}" — export is from a newer build`);
          }
          if (keys.length === 0) throw new Error(`data: empty row in ${table}`);

          const columnList = keys.map((key) => `"${key}"`).join(', ');
          const placeholders = keys.map(() => '?').join(', ');
          const values = keys.map((key) => (row as Row)[key] as SqlParam);
          await db.run(`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`, values);
          count += 1;
        }
        imported[table] = count;
      }
    });

    return { imported };
  }

  /** One table as CSV, header first (oracle D12). */
  async function exportCsv(table: string): Promise<string> {
    const name = assertTableName(table);
    const columns = await tableColumns(db, name);
    const rows = await db.all<Row>(`SELECT * FROM "${name}" ORDER BY "rowid" ASC`);
    const lines = [columns.map(csvCell).join(',')];
    for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
    return lines.join('\n');
  }

  /**
   * Delete every row of every table (oracle D13). The schema and its version stay, so the app
   * keeps working on an empty database.
   *
   * The *rest* of "delete everything" belongs to the caller and is wired in L3.6: the audio
   * files listed in the result, the Keychain device token, and `DELETE /device` on the server
   * (§0.5 S4). This function returns the paths precisely so nothing is forgotten.
   */
  async function deleteAll(): Promise<DeleteAllResult> {
    const audioRows = await db.all<Row>(
      `SELECT "audioPath" FROM "MorningReport" WHERE "audioPath" IS NOT NULL AND "audioPath" <> ''`,
    );
    const anchorRows = await db.all<Row>(`SELECT "anchorAudioPaths" FROM "UserProfile"`);
    const audioPaths = audioRows.map((row) => String(row.audioPath));
    for (const row of anchorRows) {
      const paths = parseJson<Record<string, string> | string[]>(row.anchorAudioPaths, {});
      for (const value of Object.values(paths)) {
        if (typeof value === 'string' && value !== '') audioPaths.push(value);
      }
    }

    const deleted: Record<string, number> = {};
    await db.transaction(async () => {
      for (const table of [...TABLES].reverse()) {
        const result = await db.run(`DELETE FROM "${table}"`);
        deleted[table] = result.changes;
      }
    });

    return { audioPaths, deleted };
  }

  /**
   * Build the diagnostics payload (oracle D14 · §0.5 S5).
   *
   * The result is a `DiagnosticsDraft` of `@lucid/engine` (so the app can hand it straight to
   * `buildDiagnosticsExport`) plus a `nights` block summarising recent nights. With
   * `includeText: false` — the default — no dream text and no audio path can appear anywhere
   * in it: the summaries omit them and the whole object is passed through `stripSensitive`.
   */
  async function diagnosticsDraft(options: DiagnosticsDraftOptions = {}): Promise<DataDiagnosticsDraft> {
    const includeText = options.includeText === true;
    const wanted = Math.max(1, Math.floor(options.nights ?? 7));

    const sessionRows =
      options.sessionId === undefined
        ? await db.all<Row>(
            `SELECT * FROM "NightSession" ORDER BY "dateIso" DESC, "startedAt" DESC LIMIT ?`,
            [wanted],
          )
        : await db.all<Row>(`SELECT * FROM "NightSession" WHERE "id" = ?`, [options.sessionId]);

    const nights: DiagnosticsNightSummary[] = [];
    const epochs: SensorEpoch[] = [];

    for (const row of sessionRows) {
      const session = mapSession(row);
      const sessionEpochs = (
        await db.all<Row>(`SELECT * FROM "SensorEpoch" WHERE "sessionId" = ? ORDER BY "t" ASC`, [session.id])
      ).map(mapEpoch);
      const coverage = epochCoverage(
        sessionEpochs.map((epoch) => ({
          t: epoch.t,
          hrMean: epoch.hrMean,
          hrSd: epoch.hrSd,
          motion: epoch.motion,
          battery: epoch.battery,
          source: epoch.source as SensorEpoch['source'],
        })),
      );
      for (const epoch of sessionEpochs) {
        epochs.push({
          t: epoch.t,
          hrMean: epoch.hrMean,
          hrSd: epoch.hrSd,
          motion: epoch.motion,
          battery: epoch.battery,
          source: epoch.source as SensorEpoch['source'],
        });
      }

      const counts = await first<Row>(
        db,
        `SELECT
           (SELECT COUNT(*) FROM "CueEvent" c WHERE c."sessionId" = ?) AS "cues",
           (SELECT COUNT(*) FROM "CueEvent" c WHERE c."sessionId" = ? AND c."played" = 1) AS "played",
           (SELECT COUNT(*) FROM "WakeEvent" w WHERE w."sessionId" = ?) AS "wakes",
           (SELECT COUNT(*) FROM "EarTest" t WHERE t."sessionId" = ?) AS "earTests"`,
        [session.id, session.id, session.id, session.id],
      );
      const report = await reportForSession(session.id);
      const aiScore = report === null ? null : await aiForReport(report.id);

      const summary: DiagnosticsNightSummary = {
        sessionId: session.id,
        dateIso: session.dateIso,
        mode: session.mode,
        themeKey: session.themeKey,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        epochs: sessionEpochs.length,
        continuity: coverage.continuity,
        gaps: coverage.gaps,
        longestGapSeconds: coverage.longestGapSeconds,
        cues: Number(counts?.cues ?? 0),
        playedCues: Number(counts?.played ?? 0),
        wakes: Number(counts?.wakes ?? 0),
        earTests: Number(counts?.earTests ?? 0),
        lucid: report?.lucid ?? null,
        themeMatchUser: report?.themeMatchUser ?? null,
        // Booleans, not the text itself: QC needs to know a transcript exists, never what it says.
        hasTranscript: (report?.transcript ?? null) !== null && report?.transcript !== '',
        hasAudio: (report?.audioPath ?? null) !== null && report?.audioPath !== '',
      };

      if (includeText) {
        summary.transcript = report?.transcript ?? null;
        summary.audioPath = report?.audioPath ?? null;
        summary.summary = aiScore?.summary ?? null;
      }

      nights.push(summary);
    }

    const profile = await first<Row>(db, `SELECT "locale" FROM "UserProfile" ORDER BY "rowid" ASC LIMIT 1`);

    const draft: DataDiagnosticsDraft = {
      appVersion: options.appVersion ?? '0.0.0',
      buildNumber: options.buildNumber ?? null,
      // The data layer cannot read the device; the app overrides this before exporting.
      device: options.device ?? {
        platform: 'ios',
        osVersion: 'unknown',
        model: 'unknown',
        modelName: null,
        watchModel: null,
        watchPaired: false,
        locale: profile === null ? 'en' : String(profile.locale),
      },
      sensors: options.sensors ?? [],
      epochs,
      audioEvents: options.audioEvents ?? [],
      batterySamples: options.batterySamples ?? [],
      warnings: options.warnings ?? [],
      nights,
    };

    // Last gate: even if a future column slips into a summary, it cannot reach the file.
    return includeText ? draft : stripSensitive(draft);
  }

  return {
    db,
    sessions,
    earTests,
    reports,
    applePhases,
    ai,
    nightReport,
    lastNights,
    stats,
    exportJson,
    importJson,
    exportCsv,
    deleteAll,
    diagnosticsDraft,
  };
}

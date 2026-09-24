/**
 * Schema of the file the app exports from the Diagnostics screen (`diagnostics.json`).
 *
 * This is the only artefact the owner sends back after an R1 night, so it is the
 * contract that decides the stack (APP-RUN §2 "L1.1 → R1"): watch battery drift,
 * epoch continuity, audio drop-outs.
 *
 * Privacy (APP-RUN §0.5 S5): this export carries **no** dream text, transcript or
 * audio — only device/sensor/audio telemetry. Nothing here is free-form user text.
 */

import { z } from 'zod';
import { type Clock, EPOCH_SECONDS, epochIndexOf } from './clock';

/** Bumped whenever the shape below changes, so old exports stay readable. */
export const DIAGNOSTICS_SCHEMA_VERSION = 1;

/** Physiologically plausible heart-rate window (APP-RUN §0.5 S8) — outside = dropped. */
export const HR_MIN_BPM = 25;
export const HR_MAX_BPM = 220;

export const IsoDateTime = z.iso.datetime({ offset: true });

export const SensorSourceKind = z.enum(['WATCH', 'BLE_HR', 'PHONE_MOTION', 'MASK', 'TIMER']);
export type SensorSourceKind = z.infer<typeof SensorSourceKind>;

export const DeviceKind = z.enum(['PHONE', 'WATCH', 'BLE', 'HEADPHONES']);
export type DeviceKind = z.infer<typeof DeviceKind>;

/** Which phone/OS produced this file. No user identifiers. */
export const DeviceInfoSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  osVersion: z.string().min(1),
  /** e.g. `iPhone15,2` — from expo-device, may be unknown on web. */
  model: z.string().min(1),
  /** Marketing name when available, e.g. `iPhone 14 Pro`. */
  modelName: z.string().nullable().default(null),
  /** Free-form watch model string, `null` when no watch was paired. */
  watchModel: z.string().nullable().default(null),
  /** `true` when the watch companion app had ever been reachable this session. */
  watchPaired: z.boolean().default(false),
  locale: z.string().min(2),
});
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

/**
 * One 30 s epoch as delivered by a SensorSource.
 * `t` is epoch **seconds** floored onto the 30 s grid (UTC) so epochs dedupe by value.
 */
export const SensorEpochSchema = z.object({
  t: z.number().int().nonnegative(),
  hrMean: z.number().min(HR_MIN_BPM).max(HR_MAX_BPM).nullable(),
  hrSd: z.number().min(0).max(80).nullable(),
  /** Mean |a| energy of the wrist accelerometer over the epoch, in g. */
  motion: z.number().min(0).nullable(),
  /** Battery of the device that produced the epoch, 0..1. */
  battery: z.number().min(0).max(1).nullable(),
  source: SensorSourceKind,
});
export type SensorEpoch = z.infer<typeof SensorEpochSchema>;

/** Everything that can happen to the audio session over a night (APP-RUN §0.5 S7). */
export const AudioEventKind = z.enum([
  'SESSION_CONFIGURED',
  'SESSION_ACTIVATED',
  'SESSION_DEACTIVATED',
  'BED_START',
  'BED_STOP',
  'CUE_PLAYED',
  'INTERRUPTION_BEGAN',
  'INTERRUPTION_ENDED',
  'ROUTE_CHANGED',
  'ERROR',
]);
export type AudioEventKind = z.infer<typeof AudioEventKind>;

export const AudioEventSchema = z.object({
  at: IsoDateTime,
  kind: AudioEventKind,
  /** Short machine-ish detail (route name, error code). Never user text. */
  detail: z.string().max(200).nullable().default(null),
  /** Engine-owned volume at the time of the event, 0..1 (DESIGN §2.3.1). */
  volume: z.number().min(0).max(1).nullable().default(null),
});
export type AudioEvent = z.infer<typeof AudioEventSchema>;

export const BatterySampleSchema = z.object({
  at: IsoDateTime,
  device: DeviceKind,
  level: z.number().min(0).max(1),
  state: z.enum(['UNKNOWN', 'UNPLUGGED', 'CHARGING', 'FULL']),
  lowPowerMode: z.boolean().default(false),
});
export type BatterySample = z.infer<typeof BatterySampleSchema>;

export const SensorStatusSnapshotSchema = z.object({
  id: z.string().min(1),
  kind: SensorSourceKind,
  connected: z.boolean(),
  reachable: z.boolean(),
  lastEpochAt: IsoDateTime.nullable().default(null),
  battery: z.number().min(0).max(1).nullable().default(null),
  error: z.string().max(200).nullable().default(null),
});
export type SensorStatusSnapshot = z.infer<typeof SensorStatusSnapshotSchema>;

export const DiagnosticsExportSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  appVersion: z.string().min(1),
  /** Native build number (`ios.buildNumber`), useful when a TestFlight build misbehaves. */
  buildNumber: z.string().nullable().default(null),
  exportedAt: IsoDateTime,
  device: DeviceInfoSchema,
  sensors: z.array(SensorStatusSnapshotSchema).default([]),
  epochs: z.array(SensorEpochSchema).default([]),
  audioEvents: z.array(AudioEventSchema).default([]),
  batterySamples: z.array(BatterySampleSchema).default([]),
  /** Non-fatal problems collected while the night ran. */
  warnings: z.array(z.string().max(300)).default([]),
});
export type DiagnosticsExport = z.infer<typeof DiagnosticsExportSchema>;

export type DiagnosticsParseResult =
  | { ok: true; value: DiagnosticsExport }
  | { ok: false; issues: string[] };

/** Parse without throwing, with human-readable paths — used by the QC reader. */
export function parseDiagnostics(input: unknown): DiagnosticsParseResult {
  const result = DiagnosticsExportSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export interface DiagnosticsDraft {
  appVersion: string;
  buildNumber?: string | null;
  device: z.input<typeof DeviceInfoSchema>;
  sensors?: z.input<typeof SensorStatusSnapshotSchema>[];
  epochs?: SensorEpoch[];
  audioEvents?: z.input<typeof AudioEventSchema>[];
  batterySamples?: z.input<typeof BatterySampleSchema>[];
  warnings?: string[];
}

/**
 * Stamp `exportedAt` from an injected clock and validate in one step, so the app
 * can never write a file that the QC reader would reject.
 */
export function buildDiagnosticsExport(draft: DiagnosticsDraft, clock: Clock): DiagnosticsExport {
  return DiagnosticsExportSchema.parse({
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    appVersion: draft.appVersion,
    buildNumber: draft.buildNumber ?? null,
    exportedAt: clock.nowIso(),
    device: draft.device,
    sensors: draft.sensors ?? [],
    epochs: draft.epochs ?? [],
    audioEvents: draft.audioEvents ?? [],
    batterySamples: draft.batterySamples ?? [],
    warnings: draft.warnings ?? [],
  });
}

export interface EpochCoverage {
  count: number;
  /** Epochs that *should* exist between the first and last one seen. */
  expected: number;
  /** `count / expected`, 0..1. `1` when fewer than two epochs exist. */
  continuity: number;
  /** Number of gaps longer than one epoch. */
  gaps: number;
  longestGapSeconds: number;
  duplicates: number;
}

/**
 * How continuous the night was. This is the number that decides the stack in R1
 * (APP-RUN §2: "epoch ต่อเนื่องกี่ %"). Pure arithmetic — no clock needed.
 */
export function epochCoverage(
  epochs: readonly SensorEpoch[],
  epochSeconds: number = EPOCH_SECONDS,
): EpochCoverage {
  if (epochs.length === 0) {
    return { count: 0, expected: 0, continuity: 0, gaps: 0, longestGapSeconds: 0, duplicates: 0 };
  }
  const times = [...epochs].map((e) => e.t).sort((a, b) => a - b);
  const unique = [...new Set(times)];
  const duplicates = times.length - unique.length;
  const first = unique[0] as number;
  const last = unique[unique.length - 1] as number;
  const expected = Math.floor((last - first) / epochSeconds) + 1;
  let gaps = 0;
  let longestGapSeconds = 0;
  for (let i = 1; i < unique.length; i += 1) {
    const delta = (unique[i] as number) - (unique[i - 1] as number);
    if (delta > epochSeconds) {
      gaps += 1;
      if (delta > longestGapSeconds) longestGapSeconds = delta;
    }
  }
  return {
    count: unique.length,
    expected,
    continuity: expected <= 1 ? 1 : unique.length / expected,
    gaps,
    longestGapSeconds,
    duplicates,
  };
}

/**
 * Drop epochs that cannot be true and dedupe by epoch index (APP-RUN §0.5 S8).
 * Later samples win, so a re-sent epoch replaces the queued one.
 */
export function normalizeEpochs(
  raw: readonly SensorEpoch[],
  epochSeconds: number = EPOCH_SECONDS,
): SensorEpoch[] {
  const byIndex = new Map<number, SensorEpoch>();
  for (const epoch of raw) {
    if (epoch.hrMean !== null && (epoch.hrMean < HR_MIN_BPM || epoch.hrMean > HR_MAX_BPM)) continue;
    const index = epochIndexOf(epoch.t * 1000, epochSeconds);
    byIndex.set(index, { ...epoch, t: index });
  }
  return [...byIndex.values()].sort((a, b) => a.t - b.t);
}

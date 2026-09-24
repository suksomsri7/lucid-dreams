/**
 * `@lucid/engine` — all night logic, pure TypeScript.
 *
 * Hard rule (APP-RUN §0.2 rule 1): this package must never import `react-native`,
 * `expo` or any `expo-*` module. The app is only a sensor feeder, an audio player
 * and a screen; everything that decides anything lives here and is tested with
 * vitest on the VPS against synthetic and recorded nights.
 *
 * `scripts/fitness.mts` enforces the rule on every run.
 */

export {
  type Clock,
  systemClock,
  fixedClock,
  stepClock,
  EPOCH_SECONDS,
  epochIndexOf,
} from './clock';

export {
  DIAGNOSTICS_SCHEMA_VERSION,
  HR_MIN_BPM,
  HR_MAX_BPM,
  IsoDateTime,
  SensorSourceKind,
  DeviceKind,
  DeviceInfoSchema,
  type DeviceInfo,
  SensorEpochSchema,
  type SensorEpoch,
  AudioEventKind,
  AudioEventSchema,
  type AudioEvent,
  BatterySampleSchema,
  type BatterySample,
  SensorStatusSnapshotSchema,
  type SensorStatusSnapshot,
  DiagnosticsExportSchema,
  type DiagnosticsExport,
  type DiagnosticsParseResult,
  type DiagnosticsDraft,
  parseDiagnostics,
  buildDiagnosticsExport,
  type EpochCoverage,
  epochCoverage,
  normalizeEpochs,
} from './diagnostics';

/** Engine package version — reported inside diagnostics so QC knows what produced a file. */
export const ENGINE_VERSION = '0.1.0';

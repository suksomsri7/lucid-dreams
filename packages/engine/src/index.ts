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

export {
  type NightState,
  NIGHT_STATES,
  type SleepStage,
  SLEEP_STAGES,
  type StageSample,
  type PRemSample,
  isAsleep,
  type NightMode,
  type CueType,
  VOLUME_MIN,
  VOLUME_MAX,
  type NightParams,
  DEFAULT_NIGHT_PARAMS,
  resolveNightParams,
  type CueResponse,
  type CueEvent,
  type WakeCause,
  type WakeEvent,
} from './types';

export { type Rng, mulberry32, clamp, round } from './rng';

export {
  AMBIENCE_KEYS,
  type AmbienceKey,
  ANCHOR_PHRASE_MAX_WORDS,
  wordCount,
  ThemeSchema,
  type DreamTheme,
  ClarifySchema,
  type Clarify,
  DreamPlanSchema,
  type DreamPlan,
  parseDreamPlan,
  withWatermark,
  THEME_CHIP_KEYS,
  type ThemeChipKey,
  offlineThemeChips,
  isThemeChipKey,
  guessChipFromText,
  chipLabel,
  offlinePlanFromChip,
  offlinePlanFromText,
} from './dreamPlan';

export {
  type AdvisorState,
  type AdvisorMessage,
  type PlanRequest,
  type PlanProvider,
  type ThemeChip,
  type AdvisorOptions,
  type AdvisorTurn,
  type Advisor,
  MAX_CLARIFY_PER_NIGHT,
  createAdvisor,
} from './advisor';

export {
  ANCHOR_VOLUME_MIN,
  ANCHOR_VOLUME_MAX,
  clampAnchorVolume,
  type AnchorLang,
  ANCHOR_PHRASE_TH,
  ANCHOR_PHRASE_EN,
  anchorPhraseFor,
  anchorWhisperText,
  anchorPhraseKey,
  type SignatureEnvelope,
  type SignatureTimbre,
  type AnchorSignature,
  makeSignature,
  midiToHz,
  renderSignaturePcm,
} from './signature';

export {
  type EarSide,
  type MemorizationState,
  type EarTest,
  type MemorizationPlan,
  type MemorizationAnswer,
  type MemorizationTest,
  type MemorizationOptions,
  MEMORIZATION_ROUNDS_MIN,
  MEMORIZATION_ROUNDS_MAX,
  MEMORIZATION_GAP_MIN_MS,
  MEMORIZATION_GAP_MAX_MS,
  MEMORIZATION_ANSWER_MIN,
  MEMORIZATION_ANSWER_MAX,
  createMemorizationTest,
  earTestsComplete,
} from './memorization';

export {
  type ReadinessReason,
  type ReadinessCategoryReport,
  type ReadinessCheck,
  type ReadinessNextStep,
  type ReadinessReport,
  type ReadinessEarTests,
  type ReadinessInput,
  HEART_DATA_MAX_AGE_SEC,
  AUDIO_HOURS_PER_FULL_CHARGE,
  PHONE_MIN_BATTERY,
  evaluateReadiness,
} from './readiness';

export {
  type CueGateReason,
  type CueGateContext,
  type CueGateVerdict,
  CUE_MOTION_QUIET_SEC,
  CUE_SPACING_SEC,
  MAX_CUES_PER_NIGHT,
  MAX_CUES_PER_REM,
  cueGate,
} from './cueGate';

export {
  type SimulateNightOptions,
  type SimCyclePlan,
  type SimWakeBout,
  type SimNightParams,
  type SimulatedNight,
  simulateNight,
} from './simulate';

export { type ReplayInput, type ReplayReport, replayNight, replayNightReport } from './replay';

export {
  ONSET_NO_SENSOR_TIMEOUT_SEC,
  ONSET_BASELINE_EPOCHS,
  ONSET_QUIET_EPOCHS,
  ONSET_QUIET_SEC,
  ONSET_HR_DROP_RATIO,
  ONSET_MOTION_QUIET,
  ONSET_MOTION_MOVE,
  ONSET_MAX_TWITCH_EPOCHS,
  ONSET_MOTION_MEAN_FACTOR,
  ONSET_MIN_COVERAGE,
  ONSET_TIMER_COVERAGE,
  ONSET_MIN_DATA_SEC,
  ONSET_MIN_LATENCY_SEC,
  BED_VOLUME_FULL,
  BED_VOLUME_BED,
  BED_FADE_SEC,
  SEED_WHISPER_OFFSETS_SEC,
  GUARD_MIN_HOURS,
  type OnsetOptions,
  type OnsetReading,
  type OnsetVia,
  type OnsetDetector,
  type OnsetResult,
  createOnsetDetector,
  detectOnset,
  seedWhisperTimes,
  seedWhisperDue,
  type BedFadeOptions,
  bedVolumePlan,
  guardUntil,
} from './onset';

export {
  type RemWeights,
  DEFAULT_REM_WEIGHTS,
  REM_WEIGHT_MIN,
  REM_WEIGHT_MAX,
  REM_PERSONAL_MIN_NIGHTS,
  canUpdatePersonalWeights,
  type RemTuning,
  DEFAULT_REM_TUNING,
  REM_HISTOGRAM_BUCKETS,
  REM_EPOCH_SECONDS,
  flatRemHistogram,
  histogramBucket,
  type RemContext,
  type RemFeatures,
  type RemWindow,
  createRemWindow,
  pushRemWindow,
  remTimePrior,
  remFeatures,
  sigmoid,
  remProbability,
  type RemEstimatorOptions,
  type RemEstimator,
  createRemEstimator,
  type EstimateNightOptions,
  estimateNight,
  nightFeatures,
  type UpdateWeightsInput,
  updateWeights,
} from './remEstimator';

export {
  WAKE_MOTION_HIGH,
  WAKE_MOTION_LEVEL,
  WAKE_MOTION_EPOCHS,
  WAKE_HR_JUMP,
  WAKE_HR_EPOCHS,
  WAKE_HR_BASELINE_EPOCHS,
  WAKE_HR_MIN_BASELINE_EPOCHS,
  WAKE_QUIET_EPOCHS,
  CUE_WOKE_WINDOW_SEC,
  TIMER_MAX_CUES_PER_NIGHT,
  TIMER_WINDOW_SEC,
  TIMER_SCAN_STEP_SEC,
  type WakeDetectorOptions,
  type WakeReading,
  type WakeDetector,
  createWakeDetector,
  type WakeBout,
  detectWakeBouts,
  type TimerNightParams,
  timerModeParams,
  type TimerCueWindow,
  timerCueWindows,
} from './wakeDetector';

export {
  REM_LIKELY_EPOCHS,
  REM_BOUT_END_EPOCHS,
  AWAKE_QUIET_SEC,
  AWAKE_REGUARD_SEC,
  AWAKE_REGUARD_AFTER_WAKES,
  SLEEP_GUARD_WOKE_LIMIT,
  VOLUME_STEP_DOWN,
  VOLUME_STEP_UP,
  SLEEP_SCORE_NIGHTS,
  SLEEP_SCORE_POOR,
  CUE_DELAY_MIN_SEC,
  CUE_DELAY_MAX_SEC,
  LIVE_TEXT_KEYS,
  type NightControllerMode,
  type StopAudioReason,
  type NightAction,
  type NightControllerOptions,
  type NightController,
  createNightController,
  nextNightVolume,
} from './nightController';

export {
  type RemMetrics,
  remMetrics,
  type StageFractions,
  stageFractions,
  remLatencySec,
  wasoSec,
} from './metrics';

export {
  DeviceRegistry,
  summarizeDevices,
  DEVICE_CATEGORIES,
  type DeviceCategory,
  type DeviceEntry,
  type DeviceCategorySummary,
  type DeviceListener,
} from './devices';

/** Engine package version — reported inside diagnostics so QC knows what produced a file. */
export const ENGINE_VERSION = '0.1.0';

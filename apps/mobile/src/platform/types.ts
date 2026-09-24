/**
 * Every line of code that touches a platform API sits behind one of the five
 * interfaces below (APP-RUN §0.2 rule 8 · DESIGN §8.1–§8.2). Reasons:
 *
 * 1. Android can be added later by writing `platform/android/*` only.
 * 2. `packages/engine` can be driven by a fake source in vitest, so a whole night
 *    is testable on the VPS with no device.
 * 3. iOS-only modules (expo-glass-effect, watch connectivity, apple-targets) may only
 *    be imported under `src/platform/ios/` — checked by fitness + oracle S3.7.
 *
 * Shapes of sensor data are owned by `@lucid/engine` (single source of truth), so the
 * app cannot drift from what the engine and the diagnostics schema expect.
 */

import type {
  AudioEvent,
  AudioEventKind,
  BatterySample,
  DeviceKind,
  SensorEpoch,
  SensorSourceKind,
} from '@lucid/engine';

export type Unsubscribe = () => void;

/** Thrown by every `platform/android/*` stub in Phase 1. */
export class NotImplementedError extends Error {
  readonly code = 'NOT_IMPLEMENTED' as const;
  constructor(what: string) {
    super(`${what} is not implemented on this platform yet`);
    this.name = 'NotImplementedError';
  }
}

// ---------------------------------------------------------------------------
// 1. SensorSource — heart rate + motion from any device (DESIGN §8.1)
// ---------------------------------------------------------------------------

export interface SensorStatus {
  id: string;
  kind: SensorSourceKind;
  /** The transport is up (watch app installed / BLE device bonded). */
  connected: boolean;
  /** Data can flow *right now* (WCSession reachable / BLE notifying). */
  reachable: boolean;
  /** Epoch seconds of the newest epoch received, `null` before the first one. */
  lastEpochT: number | null;
  /** Battery of the sensing device, 0..1. */
  battery: number | null;
  /** Last transport error, machine-readable, never user text. */
  error: string | null;
}

/**
 * A source of evidence for the REM estimator. Several sources can run at once and
 * the engine fuses them; if all of them drop, the engine falls back to timer mode
 * (DESIGN §5.1).
 *
 * Contract:
 * - `start()` is idempotent and must resolve only once data can begin to arrive.
 * - epochs are delivered **already aligned to the 30 s grid**; the engine still
 *   dedupes and range-checks them (`normalizeEpochs`) because a transport may replay.
 * - `stop()` must be safe to call when never started, and must release the OS session.
 */
export interface SensorSource {
  readonly id: string;
  readonly kind: SensorSourceKind;
  /** Can this source exist on this device at all (watch paired, BLE permitted)? */
  isAvailable(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): SensorStatus;
  /** Fires once per 30 s epoch. */
  onEpoch(listener: (epoch: SensorEpoch) => void): Unsubscribe;
  /** Fires whenever `getStatus()` would return something different. */
  onStatus(listener: (status: SensorStatus) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
// 2. AudioPlayer — the bed loop plus, later, the anchor cue on top
// ---------------------------------------------------------------------------

export type AudioSessionState = 'idle' | 'configured' | 'playing' | 'stopped' | 'error';

export interface AudioPlayerStatus {
  state: AudioSessionState;
  /** Volume the *engine* asked for, 0..1 (DESIGN §2.3.1 — the engine owns volume). */
  volume: number;
  /** Output route name when the platform exposes it (`Headphones`, `Speaker`). */
  route: string | null;
  error: string | null;
}

/**
 * Plays one continuous "bed" loop all night and, from L1.7, overlays anchor cues.
 *
 * Safety rules that implementations must honour (APP-RUN §0.5 S7):
 * - session category `playback`, `mixWithOthers` **off**;
 * - an interruption (incoming call) stops any cue and may only resume the bed;
 * - cues are refused unless the engine says the state is CUE — enforced in the engine,
 *   never in the UI.
 */
export interface AudioPlayer {
  /** Configure the OS audio session for all-night background playback. */
  configureSession(): Promise<void>;
  startBed(volume: number): Promise<void>;
  stopBed(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  /** From L1.7: the anchor whisper, mixed over the bed. */
  playCue(options: { volume: number; cueId: string }): Promise<void>;
  getStatus(): AudioPlayerStatus;
  onEvent(listener: (event: AudioEvent) => void): Unsubscribe;
  /** Release players and deactivate the session. Safe to call twice. */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 3. LiveStatus — lock-screen / watch-face status while the night runs
// ---------------------------------------------------------------------------

export interface LiveStatusContent {
  /** Theme emoji, e.g. a whale (DESIGN §3.4). */
  emoji: string;
  /** Already-translated one-line status; this layer never translates. */
  headline: string;
  cuesPlayed: number;
  cuesPlanned: number;
  /** `null` while the estimator has not produced a number yet (DESIGN §2.2). */
  pRem: number | null;
}

/** iOS: Live Activity (ActivityKit). Android: a foreground-service notification later. */
export interface LiveStatus {
  isSupported(): boolean;
  start(content: LiveStatusContent): Promise<void>;
  update(content: LiveStatusContent): Promise<void>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 4. HealthImport — Apple's own sleep stages, read in the morning (DESIGN §5 L2.9)
// ---------------------------------------------------------------------------

export type SleepStage = 'REM' | 'CORE' | 'DEEP' | 'AWAKE' | 'IN_BED';

export interface SleepPhase {
  /** ISO-8601 with offset. */
  start: string;
  end: string;
  stage: SleepStage;
}

/**
 * Read-only access to the platform health store. Never written to during the night —
 * it is the *reference answer* we compare our estimator against the next morning.
 */
export interface HealthImport {
  isAvailable(): Promise<boolean>;
  /**
   * Ask for read access to sleep + heart-rate samples (DESIGN §4-01 · APP-RUN §2 L1.3).
   * Returns `true` only if access was actually granted — a caller must never believe it
   * has HealthKit data when it does not (APP-RUN §0.5 S10). Renamed from the L1.1 stub's
   * `requestReadAccess` to `requestAuthorization` (WO L1.3): no call sites existed yet
   * (grepped before renaming), and one verb for "ask the OS for this permission" matches
   * the sibling `SpeechToText.requestPermissions()` / the new `NotificationsPermission`
   * below more closely than "read access" did.
   */
  requestAuthorization(): Promise<boolean>;
  fetchSleepPhases(range: { fromIso: string; toIso: string }): Promise<SleepPhase[]>;
  fetchHeartRateSamples(range: {
    fromIso: string;
    toIso: string;
  }): Promise<{ atIso: string; bpm: number }[]>;
}

// ---------------------------------------------------------------------------
// 5. SpeechToText — morning recall, transcribed on-device (DESIGN §2.6)
// ---------------------------------------------------------------------------

export interface SpeechResult {
  /** Text so far. Sensitive: never logged, never leaves the device here. */
  text: string;
  isFinal: boolean;
}

/**
 * On-device transcription only. The audio file must be deleted right after
 * transcription unless the user opted to keep it (APP-RUN §0.5 S4).
 */
export interface SpeechToText {
  isAvailable(): Promise<boolean>;
  requestPermissions(): Promise<boolean>;
  /** `locale` is a BCP-47 tag; the recognised language follows the UI language. */
  start(options: { locale: string }): Promise<void>;
  stop(): Promise<void>;
  onResult(listener: (result: SpeechResult) => void): Unsubscribe;
  onError(listener: (error: string) => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
// 6. NotificationsPermission — asked once, on the devices screen's "พร้อมแล้ว" (L1.3)
// ---------------------------------------------------------------------------

/**
 * Just the permission prompt. The daytime reality-check / evening reminder notifications
 * themselves (DESIGN §3.4) are scheduled for L1.7/L3.1 — this WO only needs the ask to
 * happen at onboarding time so the system prompt is not a surprise later. No
 * `expo-notifications` dependency added for this (APP-RUN §0.5 S9 wants every new
 * dependency justified, and a single permission prompt does not need the whole
 * scheduling API yet) — same "declared but not wired" shape as `HealthImport`/`LiveStatus`
 * above: `isAvailable()` stays honest (`false`) and the ask resolves `false` until a real
 * native call lands.
 */
export interface NotificationsPermission {
  isAvailable(): Promise<boolean>;
  requestAuthorization(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Battery + the bundle the app consumes
// ---------------------------------------------------------------------------

export interface BatteryReader {
  sample(device: DeviceKind): Promise<BatterySample | null>;
}

export interface DeviceInfoReader {
  read(): Promise<{
    platform: 'ios' | 'android' | 'web';
    osVersion: string;
    model: string;
    modelName: string | null;
  }>;
}

/** What `src/platform/index.ts` hands to the rest of the app. */
export interface PlatformBundle {
  readonly name: 'ios' | 'android' | 'unsupported';
  /** `true` when real Liquid Glass is available (iOS 26+); UI falls back to blur otherwise. */
  readonly hasLiquidGlass: boolean;
  watchSensorSource: SensorSource;
  audioPlayer: AudioPlayer;
  liveStatus: LiveStatus;
  healthImport: HealthImport;
  speechToText: SpeechToText;
  notifications: NotificationsPermission;
  battery: BatteryReader;
  deviceInfo: DeviceInfoReader;
}

export type { AudioEvent, AudioEventKind, BatterySample, SensorEpoch, SensorSourceKind };

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
  SensorSample,
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
  /**
   * Unix seconds of the newest *reading* of any kind — WO L2.3.
   *
   * Not the same question as `lastEpochT`, and the difference decides whether the devices
   * screen shows a strap as alive: a BLE strap notifies every second but only produces an
   * epoch when something asked it to fold one (`onEpoch`), so during a night — where the hub
   * consumes its samples instead — `lastEpochT` stays `null` while data pours in. For the
   * Apple Watch, whose only output *is* epochs, the two are the same number.
   */
  lastDataT: number | null;
  /**
   * Newest heart rate this source has seen, bpm — `null` when the source does not measure
   * one (phone on the mattress) or has not measured one yet (WO L2.3).
   *
   * Added so the devices screen can print the mockup's own device line — "connected · heart 62 ·
   * 84% battery" (`04-dream-plan.png` frame b) — without a second, parallel channel for one
   * number: it is a *level* the source can always answer for, which is exactly what
   * `getStatus()` is for. It is deliberately not fed to the estimator from here; evidence
   * only ever travels as epochs/samples (`onEpoch`/`onSample`), never as a status field.
   */
  lastBpm: number | null;
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
  /**
   * Fires when the paired device sends an explicit command — today just the watch's own
   * "stop" button (WO L2.8, mockup `05-night.png` frame b). Separate from `onStatus`
   * because a command is an instant, one-shot event (→ `NightController.userStop()`),
   * not a level that `getStatus()` could ever describe.
   */
  onCommand(listener: (command: 'stop') => void): Unsubscribe;
}

// ---------------------------------------------------------------------------
// 1b. Sample-level sources — BLE strap, phone on the mattress (WO L2.3)
// ---------------------------------------------------------------------------

/**
 * A source that can hand over its readings **as they arrive**, not only as a finished
 * 30 s epoch.
 *
 * Why this exists next to `SensorSource.onEpoch` rather than replacing it: a chest strap
 * notifies once per heartbeat with RR intervals attached, and `@lucid/engine`'s
 * `createSensorHub` can only weight sources by evidence (and turn RR into HRV) if it sees
 * those individual readings — an epoch that has already been averaged has thrown that
 * away. The Apple Watch, by contrast, *only* ever produces finished epochs (the watch app
 * does the aggregation itself, WO L2.2n), so `onEpoch` stays the contract every source
 * honours and this is the extra one the sources that can, offer.
 *
 * `src/sensors/hub.ts` subscribes to `onSample` when a source has it and to `onEpoch`
 * otherwise — never both for the same source, which would double-count it.
 */
export interface SampleSensorSource extends SensorSource {
  onSample(listener: (sample: SensorSample) => void): Unsubscribe;
}

/** One advertiser seen during a scan. Nothing is connected to yet (APP-RUN §0.5 S8). */
export interface BleScanResult {
  /** Opaque per-phone identifier (a CoreBluetooth UUID on iOS, not a MAC address). */
  id: string;
  name: string | null;
  /** dBm, negative; `null` when the platform did not report it. */
  rssi: number | null;
  /** Advertised 16-bit service ids in short lower-case form, e.g. `['180d', '180f']`. */
  services: string[];
}

/** Why a scan cannot start. `READY` is the only state that scans. */
export type BleAvailability = 'READY' | 'OFF' | 'UNAUTHORIZED' | 'UNSUPPORTED';

export interface BleBondedDevice {
  id: string;
  name: string | null;
}

/**
 * The Bluetooth Heart Rate Profile source (DESIGN §8.1 rows 2–3: chest strap / armband).
 *
 * The scan/select half is separate from `start()/stop()` on purpose: **the app may only
 * ever bond to the device the user tapped** (APP-RUN §0.5 S8), so "what is out there"
 * (`scan`) and "this one is mine" (`select`) are two different acts, and only the second
 * one is remembered. `start()` connects to the remembered device and to nothing else.
 */
export interface BleSensorSource extends SampleSensorSource {
  /** The device the user chose, remembered across launches — `null` when none. */
  selected(): BleBondedDevice | null;
  availability(): Promise<BleAvailability>;
  /**
   * Scan for `0x180D` (heart rate) and `0x180F` (battery) advertisers, reporting the whole
   * set found so far on every change. Resolves to the stop function; scanning also stops
   * on `select()` and on `stop()`.
   */
  scan(onResults: (results: BleScanResult[]) => void): Promise<Unsubscribe>;
  /** Remember this device and connect to it. Replaces any previous choice. */
  select(device: BleBondedDevice): Promise<void>;
  /** Forget the bonded device and disconnect. */
  forget(): Promise<void>;
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
  /**
   * `source` picks which loop plays (WO L2.8: the plan's `ambienceKey`, via
   * `src/audio/ambience.ts#ambienceSource`); omitted defaults to the fixed
   * diagnostics-screen loop `IosAudioPlayer` has always used, so that existing call
   * site needs no change.
   */
  startBed(volume: number, source?: number): Promise<void>;
  stopBed(): Promise<void>;
  setVolume(volume: number): Promise<void>;
  /** From L1.7: the anchor whisper, mixed over the bed. */
  playCue(options: { volume: number; cueId: string }): Promise<void>;
  /**
   * Fire-and-forget playback of a short local clip, independent of the all-night bed
   * (WO L1.7ui). Used for the plan card's "▶ listen" preview and the ear-test screens —
   * neither of those is the gated night cue, so they do not go through `playCue`/the
   * Sleep Guard. `pan` is `-1`..`1` for callers that want it recorded/logged, but the
   * actual left/right separation on iOS is done by pre-rendering a left-only or
   * right-only stereo file (`src/audio/anchor.ts`) — expo-audio has no per-player pan
   * control (checked against the installed `expo-audio` types before choosing this
   * design). Resolves once playback finishes.
   */
  playOneShot(options: { source: string; volume: number; pan?: number }): Promise<void>;
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
  /**
   * Already-translated theme title, e.g. "Diving with whale sharks" (WO L2.2n). Together with
   * `emoji` it is the first line of the lock-screen card in mockup `05-night.png` frame b —
   * before this field existed the card could only show the emoji, which is not what the mockup
   * shows.
   */
  title: string;
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
  /**
   * The stop button *on* the status surface was pressed (WO L2.2n).
   *
   * On iOS that surface is the lock-screen Live Activity, whose button is a deep link back into
   * the app; on Android it will be the notification action. Either way it is the same kind of
   * event as `SensorSource.onCommand`: an instant "the user asked to stop from outside the app",
   * which the night wires straight to `NightController.userStop()`.
   *
   * It lives on `LiveStatus` rather than in a sixth interface because the thing that owns the
   * button is the thing that draws it — DESIGN §3.4 groups the lock screen and the watch face
   * together under one heading ("outside the app"), and this is that group's only input.
   */
  onStopRequested(listener: () => void): Unsubscribe;
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
// 6. NotificationsPermission — asked once, on the devices screen's "ready" button (L1.3)
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
// 7. Display — screen brightness during the night (DESIGN §4-05 · APP-RUN §2 L2.8)
// ---------------------------------------------------------------------------

/**
 * Just enough to dim the screen for the night (mockup `05-night.png` frame a — the
 * whole screen is already dark; this additionally turns the *hardware* backlight down
 * so a phone face-up on the nightstand does not light the room). No brightness-restore
 * method: iOS itself resets an app's brightness override the moment the screen locks
 * (`expo-brightness`'s own doc comment on `setBrightnessAsync`), which is the same
 * moment the night session stops mattering, so there is nothing this layer needs to put
 * back — `night/session.ts` still asks for a moderate level on `userStop()`/`morning()`
 * for the (rare) case the phone stays unlocked into the report screen.
 */
export interface Display {
  isAvailable(): Promise<boolean>;
  /** `value` is `0..1`; implementations must clamp. */
  setBrightness(value: number): Promise<void>;
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
  /** Chest strap / armband over the BLE Heart Rate Profile (WO L2.3). */
  bleHeartRate: BleSensorSource;
  /** "Phone on the mattress" — the phone's own accelerometer as a motion-only HEART source (WO L2.3). */
  phoneMotion: SampleSensorSource;
  audioPlayer: AudioPlayer;
  liveStatus: LiveStatus;
  healthImport: HealthImport;
  speechToText: SpeechToText;
  notifications: NotificationsPermission;
  battery: BatteryReader;
  deviceInfo: DeviceInfoReader;
  display: Display;
}

export type { AudioEvent, AudioEventKind, BatterySample, SensorEpoch, SensorSample, SensorSourceKind };

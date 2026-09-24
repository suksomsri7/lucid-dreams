/**
 * `nightController.ts` — L2.6: the night, as a state machine
 * (DESIGN-APP §5.1 state diagram · §5.3 cue controller + Sleep Guard + volume ramp ·
 * §0.5 S6/S7 · APP-RUN §2 "L2.6").
 *
 * This is the one object that decides anything at night. The app around it is a sensor
 * feeder, an audio player and a screen: it calls {@link NightController.feed} once per
 * 30 s epoch and *executes the returned actions*, nothing else. Every rule that could cost
 * the owner sleep lives here and in `cueGate.ts`, where vitest can fuzz it on hundreds of
 * synthetic nights (APP-RUN §0.2 rule 1).
 *
 * ## The state machine, exactly as implemented
 *
 * ```
 * PRE_SLEEP ──first epoch──▶ FALLING_ASLEEP ──onset (L2.4)──▶ GUARD ──now ≥ guardUntilT──▶ WATCHING
 *   (ambience 20 %)            (seed whispers min 3/8,           (silent,
 *                               bed fade 20 %→8 %)               data only)
 *
 * WATCHING ──p_REM ≥ threshold × 2 epochs + still 2 min + no HR jump──▶ REM_LIKELY
 * REM_LIKELY ──≥ cueDelaySec and cueGate() says yes──▶ CUE ──next epoch──▶ COOLDOWN
 * COOLDOWN ──now ≥ lastCue + cueSpacing──▶ WATCHING
 * REM_LIKELY ──p_REM < threshold × 2 epochs──▶ WATCHING          (the REM bout is over)
 *
 * GUARD / WATCHING / REM_LIKELY / CUE / COOLDOWN ──wake detector or markWake()──▶ AWAKE
 * AWAKE ──still 15 min──▶ WATCHING           (or ──▶ GUARD for 20 min when wakes > 2)
 * any ──morning(nowT)──▶ MORNING ──userStop()──▶ ENDED
 * any ──userStop()──▶ ENDED
 * ```
 *
 * Every transition emits `{type:'STATE', from, to}` plus a `LIVE` line for the night screen
 * (L2.8), so a night can be replayed from its action log alone.
 *
 * ## Four invariants, and where they are enforced
 *
 * 1. **No cue before the Sleep Guard ends.** Structural: `REM_LIKELY` is only reachable
 *    from `WATCHING`, and `GUARD` only leaves for `WATCHING` at `guardUntilT` — *and*
 *    `cueGate` re-checks the guard from the numbers. Two layers, as §0.5 S7 demands.
 * 2. **No cue within 2 minutes of movement.** `motionRecentSec` counts from the *end* of
 *    the moving epoch (an epoch is a 30 s window, the movement inside it is over at the
 *    end of that window), so 4 readable quiet epochs are needed, not 3 (oracle K2).
 * 3. **Volume can never leave 0.08–0.35.** `resolveNightParams` clamps on construction and
 *    the rails are hard-coded constants in `types.ts`, not settings (§0.5 S6).
 * 4. **A control night plays nothing.** The engine asks `cueGate` the counterfactual
 *    question ("would a cue night fire now?"), records the `CueEvent` with `played: false`
 *    and emits `LOG_CUE`; the real gate call with `mode: 'CONTROL'` is still made and must
 *    refuse, so the two paths can never diverge silently.
 *
 * The public `guardUntilT` is the night's Sleep Guard end and never moves after onset. The
 * short 20 min re-guard after repeated awakenings lives in a separate field
 * (`reGuardUntilT`) — folding it into `guardUntilT` would rewrite history and make "no cue
 * before the guard" unprovable after the fact.
 */

import { type Clock, EPOCH_SECONDS, systemClock } from './clock';
import { cueGate, type CueGateContext, type CueGateReason, CUE_MOTION_QUIET_SEC, CUE_SPACING_SEC } from './cueGate';
import { type SensorEpoch } from './diagnostics';
import {
  bedVolumePlan,
  createOnsetDetector,
  GUARD_MIN_HOURS,
  guardUntil,
  type OnsetOptions,
  seedWhisperTimes,
} from './onset';
import { clamp, round, type Rng } from './rng';
import {
  type CueEvent,
  type CueResponse,
  type CueType,
  DEFAULT_NIGHT_PARAMS,
  MAX_CUES_PER_NIGHT,
  MAX_CUES_PER_REM,
  type NightParams,
  type NightState,
  resolveNightParams,
  VOLUME_MAX,
  VOLUME_MIN,
  type WakeCause,
  type WakeEvent,
} from './types';
import {
  createWakeDetector,
  CUE_WOKE_WINDOW_SEC,
  TIMER_MAX_CUES_PER_NIGHT,
  type TimerCueWindow,
  timerCueWindows,
  WAKE_MOTION_HIGH,
  type WakeDetectorOptions,
} from './wakeDetector';

// ---------------------------------------------------------------------------
// Constants (DESIGN §5.1 · §5.3 — every one of them overridable per night)
// ---------------------------------------------------------------------------

/** Consecutive epochs of `p_REM ≥ remThreshold` that arm `REM_LIKELY` (§5.1). */
export const REM_LIKELY_EPOCHS = 2;
/** Consecutive epochs below the threshold that end a REM bout (and reset the per-bout cap). */
export const REM_BOUT_END_EPOCHS = 2;
/** Stillness required after a wake before watching resumes, in seconds (§5.1: 15 min). */
export const AWAKE_QUIET_SEC = 900;
/** Short re-guard after more than {@link AWAKE_REGUARD_AFTER_WAKES} wakes (§5.1: 20 min). */
export const AWAKE_REGUARD_SEC = 1200;
/** Wakes in one night after which the short re-guard is used instead of plain watching. */
export const AWAKE_REGUARD_AFTER_WAKES = 2;
/** Cue-caused awakenings that stop the night's cues for good (§5.3 Sleep Guard). */
export const SLEEP_GUARD_WOKE_LIMIT = 2;
/** Volume step when a cue woke the sleeper (§5.3: −4 %). */
export const VOLUME_STEP_DOWN = 0.04;
/** Volume step when the cue was not heard at all (§5.3: +3 %). */
export const VOLUME_STEP_UP = 0.03;
/** Nights of "slept well" scores inspected by the Sleep Guard (§5.3). */
export const SLEEP_SCORE_NIGHTS = 3;
/** Below this mean score over those nights the night's cue budget is halved (§5.3). */
export const SLEEP_SCORE_POOR = 5;
/** Epochs with no readable sensor at all after which the night falls back to the prior (10 min). */
export const SENSOR_LOST_EPOCHS = 20;
/** Delay between `REM_LIKELY` and the cue is tunable inside this range (§5.3). */
export const CUE_DELAY_MIN_SEC = 30;
export const CUE_DELAY_MAX_SEC = 180;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * `CUE` = a real night · `CONTROL` = decide identically, record, play nothing (§5.1
 * "คืนควบคุม") · `TIMER` = no heart-rate source, fire inside the prior-peak windows
 * instead of on a `p_REM` threshold (§5.1, decision of 24 Sep). `TIMER` still plays audio:
 * what the audio layer is told is always `played`, never the mode.
 */
export type NightControllerMode = 'CUE' | 'CONTROL' | 'TIMER';

/** Why the audio was cut. Reported so the night report can explain a silent stretch. */
export type StopAudioReason = 'WAKE' | 'USER_STOP' | 'MORNING';

/**
 * One instruction for the app. The engine never touches a player, a screen or a timer: it
 * returns these and the app executes them (and logs them — L2.10 reads the same list).
 */
export type NightAction =
  | { type: 'STATE'; from: NightState; to: NightState }
  | {
      type: 'PLAY_CUE';
      cueId: string;
      index: number;
      volume: number;
      cueType: CueType;
      pRem: number;
    }
  | {
      type: 'LOG_CUE';
      cueId: string;
      index: number;
      volume: number;
      cueType: CueType;
      pRem: number;
    }
  | { type: 'SET_BED_VOLUME'; volume: number }
  | { type: 'WHISPER_SEED'; index: number; at: number }
  | { type: 'STOP_AUDIO'; reason: StopAudioReason }
  | { type: 'LIVE'; text: string; state: NightState };

/**
 * i18n keys for the Live Activity / night screen, one per state. The engine stays free of
 * user-visible prose (APP-RUN §0.2 rule 7 — Thai lives in `apps/mobile/src/i18n/`).
 */
export const LIVE_TEXT_KEYS: Record<NightState, string> = {
  IDLE: 'night.live.idle',
  PRE_SLEEP: 'night.live.preSleep',
  FALLING_ASLEEP: 'night.live.fallingAsleep',
  GUARD: 'night.live.guard',
  WATCHING: 'night.live.watching',
  REM_LIKELY: 'night.live.remLikely',
  CUE: 'night.live.cue',
  COOLDOWN: 'night.live.cooldown',
  AWAKE: 'night.live.awake',
  MORNING: 'night.live.morning',
  ENDED: 'night.live.ended',
};

// ---------------------------------------------------------------------------
// Options and the public shape
// ---------------------------------------------------------------------------

export interface NightControllerOptions {
  /** Stored profile — never trusted, always clamped (see {@link NightController.params}). */
  params?: Partial<NightParams>;
  /** Injected clock. Only used for `startedAtIso`; all logic runs on epoch `t`. */
  clock?: Clock;
  /** Seeded generator, reserved for the L3.4 bandit. The controller itself is deterministic. */
  rng?: Rng;
  mode?: NightControllerMode;
  /** First epoch of the night. Defaults to the `t` of the first epoch fed. */
  startT?: number;
  /** When the night is expected to end (alarm). Defaults to `startT + 8 h`. */
  expectedEndT?: number;
  /** "Slept well" scores of the last nights, newest last (§5.3 Sleep Guard). */
  recentSleepScores?: readonly number[];
  /** Cue sound for tonight — the bandit (L3.4) picks it; default `WHISPER`. */
  cueType?: CueType;
  /** Tuning for the internal onset detector (L2.4). */
  onset?: OnsetOptions;
  /** Tuning for the internal wake detector (L2.7). */
  wake?: WakeDetectorOptions;
  /** Movement threshold (g) for the cue gate's stillness clock. */
  motionHigh?: number;
  /**
   * Fire `MORNING` automatically once `nowT` reaches this. Off by default: "woke up after
   * 05:00" (§5.1) needs the user's time zone, which belongs to the app, not the engine.
   */
  morningAfterT?: number;
}

export interface NightController {
  readonly state: NightState;
  /** Every cue of the night, in order. On a control night all of them have `played: false`. */
  readonly cues: readonly CueEvent[];
  readonly wakes: readonly WakeEvent[];
  /** Sleep onset (L2.4), `null` until declared. */
  readonly onsetT: number | null;
  /** End of the night's Sleep Guard. `Infinity` until onset — never moves afterwards. */
  readonly guardUntilT: number;
  /** End of the short re-guard after repeated wakes, `−Infinity` when none is running. */
  readonly reGuardUntilT: number;
  /** The clamped parameters actually in force tonight. */
  readonly params: NightParams;
  readonly mode: NightControllerMode;
  /** ISO-8601 stamp of when the controller was created (from the injected clock). */
  readonly startedAtIso: string;
  /** Cue budget in force tonight after the timer-mode and poor-sleep reductions. */
  readonly maxCuesTonight: number;
  /** Windows of a timer-mode night (or of a sensor-loss fallback), empty otherwise. */
  readonly timerWindows: readonly TimerCueWindow[];
  /** `true` while the night runs on the time prior because every sensor went away. */
  readonly timerFallback: boolean;
  /** Why the gate last refused, for the report's "why it stayed quiet". */
  readonly lastGateReason: CueGateReason | null;
  /** `true` once the Sleep Guard stopped the night's cues (2 cue-caused wakes). */
  readonly cuesStopped: boolean;

  feed(epoch: SensorEpoch, pRem: number | null): NightAction[];
  /** The user (or the watch) says they are awake. */
  markWake(cause?: WakeCause): NightAction[];
  /** Record what a cue did — called by the engine within 3 min, or by the morning form. */
  cueResponse(cueId: string, response: CueResponse): void;
  /** The alarm went off / the sleeper got up. */
  morning(nowT?: number): NightAction[];
  /** The user pressed stop. */
  userStop(): NightAction[];
}

function value(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** States in which the sleeper is asleep and the night engine is doing its job. */
const ASLEEP_STATES: readonly NightState[] = ['GUARD', 'WATCHING', 'REM_LIKELY', 'CUE', 'COOLDOWN'];
/** States after which nothing more happens tonight. */
const FINAL_STATES: readonly NightState[] = ['MORNING', 'ENDED'];

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/**
 * Create the controller for one night.
 *
 * ```ts
 * const c = createNightController({ params: profile, mode: 'CUE', startT: epochs[0].t });
 * for (const e of epochs) for (const action of c.feed(e, pRem(e))) execute(action);
 * for (const action of c.morning(lastT + 30)) execute(action);
 * ```
 */
export function createNightController(options: NightControllerOptions = {}): NightController {
  const mode: NightControllerMode = options.mode ?? 'CUE';
  /** What the audio layer is allowed to do. `TIMER` plays like `CUE`; only `CONTROL` is mute. */
  const playbackMode = mode === 'CONTROL' ? 'CONTROL' : 'CUE';
  const clock: Clock = options.clock ?? systemClock;
  const rng: Rng | null = options.rng ?? null;
  const cueType: CueType = options.cueType ?? 'WHISPER';
  const motionHigh = options.motionHigh ?? WAKE_MOTION_HIGH;

  // --- parameters: clamp first, trust never (§0.5 S6) -----------------------
  const resolved = resolveNightParams(options.params);
  const params: NightParams = {
    ...resolved,
    // A guard below 2 h is not a guard (APP-RUN §2 L2.4) and the caps are rails, not settings.
    guardHours: Math.max(GUARD_MIN_HOURS, resolved.guardHours),
    maxCuesPerNight: Math.min(resolved.maxCuesPerNight, MAX_CUES_PER_NIGHT),
    maxCuesPerRem: Math.min(resolved.maxCuesPerRem, MAX_CUES_PER_REM),
    cueDelaySec: Math.round(clamp(resolved.cueDelaySec, CUE_DELAY_MIN_SEC, CUE_DELAY_MAX_SEC)),
    volumeStart: clamp(resolved.volumeStart, VOLUME_MIN, VOLUME_MAX),
    volumeMin: VOLUME_MIN,
    volumeMax: VOLUME_MAX,
    mode: playbackMode,
  };
  const spacingSec = Math.max(params.cueSpacingMin * 60, CUE_SPACING_SEC);
  const volumeTonight = round(clamp(params.volumeStart, VOLUME_MIN, VOLUME_MAX), 3);

  /** §5.3 Sleep Guard: three poor nights in a row ⇒ half the cue budget. */
  const poorSleep = ((): boolean => {
    const scores = (options.recentSleepScores ?? []).filter((s) => Number.isFinite(s));
    if (scores.length < SLEEP_SCORE_NIGHTS) return false;
    const last = scores.slice(-SLEEP_SCORE_NIGHTS);
    return last.reduce((a, b) => a + b, 0) / last.length < SLEEP_SCORE_POOR;
  })();

  let maxCuesTonight = params.maxCuesPerNight;
  if (mode === 'TIMER') maxCuesTonight = Math.min(maxCuesTonight, TIMER_MAX_CUES_PER_NIGHT);
  if (poorSleep) maxCuesTonight = Math.floor(maxCuesTonight / 2);

  // --- night state ----------------------------------------------------------
  const onsetDetector = createOnsetDetector(options.onset ?? {});
  const wakeDetector = createWakeDetector(options.wake ?? {});

  let state: NightState = 'PRE_SLEEP';
  let startT: number | null = options.startT ?? null;
  let nowT: number | null = startT;
  let onsetT: number | null = null;
  let guardUntilT = Number.POSITIVE_INFINITY;
  let reGuardUntilT = Number.NEGATIVE_INFINITY;

  const cues: CueEvent[] = [];
  const cueById = new Map<string, CueEvent>();
  const wakes: WakeEvent[] = [];
  let currentWake: WakeEvent | null = null;

  let cuesThisRem = 0;
  let lastCueT: number | null = null;
  let lastCueId: string | null = null;
  let cueWokeCount = 0;
  let cuesStopped = false;
  let lastGateReason: CueGateReason | null = null;

  let pRemHighRun = 0;
  let pRemLowRun = 0;
  let remLikelyT: number | null = null;
  let cooldownUntilT = Number.NEGATIVE_INFINITY;

  /**
   * Two stillness clocks, on purpose — they answer two different questions and a single
   * clock gets one of them dangerously wrong:
   *
   *   • `lastMoveT` (**gate clock**, conservative): an unreadable epoch counts as movement,
   *     because "I cannot see the wrist" must never unlock a whisper (`cueGate` docs).
   *   • `lastActiveT` (**evidence clock**): only *wake-sized* movement the sensors reported.
   *     "Is the sleeper still awake?" must be answered from evidence — a missing epoch is
   *     not proof that somebody is thrashing around (same principle as oracle W5).
   *
   * Using the gate clock for the 15 min rule deadlocks the night: on a watch that drops
   * 15 % of its epochs, 30 unbroken readable epochs never arrive and `AWAKE` never exits
   * (found by the fuzz of this WO — `ledger/wo-notes/L2.6-2.7.md` §4.3).
   */
  let lastMoveT = Number.NEGATIVE_INFINITY;
  let lastActiveT = Number.NEGATIVE_INFINITY;
  /** Stillness for the 15 min rule is counted from here, never from before the wake. */
  let awakeQuietFromT = Number.NEGATIVE_INFINITY;

  const seedSent: boolean[] = [false, false];
  let bedVolume: number | null = null;
  /** Whatever this epoch's heart rate said — kept for the cue gate and for `tryArm`. */
  let lastHrSpike = false;

  let timerWindows: TimerCueWindow[] = [];
  let timerWindowIndex = -1;
  const timerWindowFired = new Set<number>();
  /** Consecutive epochs with neither a heart rate nor a motion value. */
  let sensorLostEpochs = 0;
  /** `true` while the night is running on the time prior because the sensors went away. */
  let timerFallback = false;

  /** Is the *moment* of the cue currently chosen by a prior window instead of `p_REM`? */
  function timerScheduling(): boolean {
    return mode === 'TIMER' || timerFallback;
  }

  /** Wall-clock stamp of the moment the night started — the only use of the clock here. */
  const startedAtIso = clock.nowIso();
  void rng; // reserved for L3.4 (volume/delay/type bandit); tonight's choice is deterministic.

  // --- small helpers --------------------------------------------------------

  /** Cue gate's guard: the later of the night guard and any short re-guard. */
  function gateGuardUntilT(): number {
    return Math.max(guardUntilT, reGuardUntilT);
  }

  /**
   * Seconds since movement ended. An epoch at `t` covers `[t, t + 30)`, so movement inside
   * it is only over at `t + 30`; counting from `t` would let a cue land 90 s after a
   * movement while claiming 120 s (oracle K2 checks the four epochs before a cue).
   */
  function motionRecentSec(t: number): number {
    if (!Number.isFinite(lastMoveT)) return Number.POSITIVE_INFINITY;
    return t - (lastMoveT + EPOCH_SECONDS);
  }

  function emit(actions: NightAction[], action: NightAction): void {
    actions.push(action);
  }

  function to(actions: NightAction[], next: NightState): void {
    if (state === next) return;
    const from = state;
    state = next;
    emit(actions, { type: 'STATE', from, to: next });
    emit(actions, { type: 'LIVE', text: LIVE_TEXT_KEYS[next], state: next });
  }

  function stopAudio(actions: NightAction[], reason: StopAudioReason): void {
    emit(actions, { type: 'STOP_AUDIO', reason });
    // The bed is gone too: whatever comes next must ask for it again.
    bedVolume = null;
  }

  /** Enter `AWAKE`: silence first, bookkeeping second (§5.4). */
  function enterAwake(actions: NightAction[], cause: WakeCause, t: number): void {
    const cueWoke = lastCueT != null && t - lastCueT <= CUE_WOKE_WINDOW_SEC;
    const event: WakeEvent = { t, durationSec: 0, cause, cueWoke };
    wakes.push(event);
    currentWake = event;
    awakeQuietFromT = Math.max(t, lastActiveT + EPOCH_SECONDS);

    stopAudio(actions, 'WAKE');
    to(actions, 'AWAKE');

    // "ตื่นภายใน 3 นาทีหลัง cue ⇒ เสียงปลุก" — the detector answers the cue itself; the
    // morning form can still overwrite it with HEARD_IN_DREAM/LUCID.
    if (cueWoke && lastCueId != null) {
      const cue = cueById.get(lastCueId);
      if (cue != null && cue.response == null) setResponse(lastCueId, 'WOKE');
    }

    // A wake ends the REM bout: nothing that happened before it may count towards the caps.
    pRemHighRun = 0;
    pRemLowRun = 0;
    cuesThisRem = 0;
    remLikelyT = null;
  }

  function setResponse(cueId: string, response: CueResponse): void {
    const cue = cueById.get(cueId);
    if (cue == null) return;
    const previous = cue.response;
    cue.response = response;
    if (response === 'WOKE' && previous !== 'WOKE') {
      cueWokeCount += 1;
      if (cueWokeCount >= SLEEP_GUARD_WOKE_LIMIT) cuesStopped = true;
    }
  }

  /** Ambience level for this epoch (§5.3 bed fade). Emitted only when it changes. */
  function bed(actions: NightAction[], t: number): void {
    if (startT == null) return;
    if (state === 'AWAKE' || FINAL_STATES.includes(state)) return;
    const want = round(bedVolumePlan(startT, onsetT, t), 3);
    if (bedVolume != null && Math.abs(bedVolume - want) < 1e-9) return;
    bedVolume = want;
    emit(actions, { type: 'SET_BED_VOLUME', volume: want });
  }

  /** The two theme whispers of `FALLING_ASLEEP` — only while still awake (§5.1 · K10). */
  function seeds(actions: NightAction[], t: number): void {
    if (startT == null || onsetT != null) return;
    if (state !== 'PRE_SLEEP' && state !== 'FALLING_ASLEEP') return;
    const times = seedWhisperTimes(startT);
    for (let i = 0; i < times.length && i < seedSent.length; i += 1) {
      const at = times[i] as number;
      if (seedSent[i] === true || t < at) continue;
      seedSent[i] = true;
      emit(actions, { type: 'WHISPER_SEED', index: i + 1, at });
    }
  }

  /** The window a timer night is currently inside, or `null`. */
  function timerWindowAt(t: number): number {
    for (let i = 0; i < timerWindows.length; i += 1) {
      const w = timerWindows[i] as TimerCueWindow;
      if (t >= w.startT && t <= w.endT) return i;
    }
    return -1;
  }

  // --- the cue decision -----------------------------------------------------

  /**
   * Ask the gate, then either play or record. The gate is never bypassed: on a control
   * night the *counterfactual* call (`mode: 'CUE'`) decides, and the real call
   * (`mode: 'CONTROL'`) is still made and must refuse — that pairing is what makes a
   * control night comparable with a cue night instead of merely quieter.
   */
  function tryCue(actions: NightAction[], t: number, pRem: number | null): boolean {
    if (cuesStopped) {
      lastGateReason = 'MAX_NIGHT';
      return false;
    }
    if (cues.length >= maxCuesTonight) {
      lastGateReason = 'MAX_NIGHT';
      return false;
    }
    if (cuesThisRem >= params.maxCuesPerRem) {
      lastGateReason = 'MAX_REM';
      return false;
    }

    const context: CueGateContext = {
      motionRecentSec: motionRecentSec(t),
      hrSpike: wakeDetector.awake || lastHrSpike,
      cuesThisNight: cues.length,
      cuesThisRem,
      sinceLastCueSec: lastCueT == null ? Number.POSITIVE_INFINITY : t - lastCueT,
      guardUntilT: gateGuardUntilT(),
      nowT: t,
      mode: 'CUE',
    };
    // Spacing: the gate knows the 300 s rail, the profile may be stricter.
    if (context.sinceLastCueSec < spacingSec) {
      lastGateReason = 'SPACING';
      return false;
    }

    const decision = cueGate(state, context);
    if (!decision.allowed) {
      lastGateReason = decision.reason;
      return false;
    }

    if (mode === 'CONTROL') {
      const real = cueGate(state, { ...context, mode: 'CONTROL' });
      if (real.allowed) return false; // unreachable: a control night must never be allowed
      lastGateReason = real.reason;
    } else {
      lastGateReason = null;
    }

    const index = cues.length + 1;
    const cueId = `cue-${index}`;
    const played = playbackMode === 'CUE';
    const cue: CueEvent = {
      t,
      index,
      volume: volumeTonight,
      type: cueType,
      pRemAtCue: round(pRem ?? 0, 3),
      played,
      response: null,
    };
    cues.push(cue);
    cueById.set(cueId, cue);
    cuesThisRem += 1;
    lastCueT = t;
    lastCueId = cueId;
    cooldownUntilT = t + spacingSec;
    if (timerScheduling() && timerWindowIndex >= 0) timerWindowFired.add(timerWindowIndex);

    // State first: §0.5 S7 — the player may only make a cue sound while state is `CUE`.
    to(actions, 'CUE');
    emit(actions, {
      type: played ? 'PLAY_CUE' : 'LOG_CUE',
      cueId,
      index,
      volume: cue.volume,
      cueType,
      pRem: cue.pRemAtCue,
    });
    return true;
  }

  /** `WATCHING` → `REM_LIKELY`? */
  function tryArm(actions: NightAction[], t: number): boolean {
    if (timerScheduling()) {
      const i = timerWindowAt(t);
      if (i < 0 || timerWindowFired.has(i)) return false;
      timerWindowIndex = i;
      remLikelyT = t;
      to(actions, 'REM_LIKELY');
      return true;
    }
    if (pRemHighRun < REM_LIKELY_EPOCHS) return false;
    // Same two conditions the gate will ask about, asked before the state changes: a
    // REM_LIKELY that is certain to be refused would only mislead the night screen.
    if (motionRecentSec(t) < CUE_MOTION_QUIET_SEC) return false;
    if (lastHrSpike) return false;
    remLikelyT = t;
    to(actions, 'REM_LIKELY');
    return true;
  }

  /** One pass of the machine. Returns `true` when it changed state. */
  function step(actions: NightAction[], t: number, pRem: number | null): boolean {
    switch (state) {
      case 'IDLE':
      case 'PRE_SLEEP':
        to(actions, 'FALLING_ASLEEP');
        return true;

      case 'FALLING_ASLEEP':
        if (onsetT == null) return false;
        to(actions, 'GUARD');
        return true;

      case 'GUARD':
        if (t < gateGuardUntilT()) return false;
        reGuardUntilT = Number.NEGATIVE_INFINITY;
        to(actions, 'WATCHING');
        return true;

      case 'WATCHING':
        return tryArm(actions, t);

      case 'REM_LIKELY': {
        if (timerScheduling()) {
          const i = timerWindowIndex;
          const window = i >= 0 ? timerWindows[i] : undefined;
          if (window == null || t > window.endT) {
            to(actions, 'WATCHING');
            return true;
          }
        } else if (pRemLowRun >= REM_BOUT_END_EPOCHS) {
          // The REM bout is over (handled again below, where the per-bout cap resets).
          to(actions, 'WATCHING');
          return true;
        }
        if (remLikelyT == null || t - remLikelyT < params.cueDelaySec) return false;
        return tryCue(actions, t, pRem);
      }

      case 'CUE':
        // The whisper (3 s fade in · 2–3 s phrase · 3 s fade out) is over inside one epoch.
        to(actions, 'COOLDOWN');
        return true;

      case 'COOLDOWN':
        if (t < cooldownUntilT) return false;
        to(actions, 'WATCHING');
        return true;

      case 'AWAKE': {
        if (wakeDetector.awake) return false;
        if (t - awakeQuietFromT < AWAKE_QUIET_SEC) return false;
        if (wakes.length > AWAKE_REGUARD_AFTER_WAKES) {
          // Broken night: give sleep 20 more minutes before watching again (§5.1).
          reGuardUntilT = t + AWAKE_REGUARD_SEC;
          to(actions, 'GUARD');
        } else {
          to(actions, 'WATCHING');
        }
        return true;
      }

      default:
        return false;
    }
  }

  const controller: NightController = {
    get state() {
      return state;
    },
    get cues() {
      return cues;
    },
    get wakes() {
      return wakes;
    },
    get onsetT() {
      return onsetT;
    },
    get guardUntilT() {
      return guardUntilT;
    },
    get reGuardUntilT() {
      return reGuardUntilT;
    },
    get params() {
      return params;
    },
    get mode() {
      return mode;
    },
    get startedAtIso() {
      return startedAtIso;
    },
    get maxCuesTonight() {
      return maxCuesTonight;
    },
    get timerWindows() {
      return timerWindows;
    },
    get timerFallback() {
      return timerFallback;
    },
    get lastGateReason() {
      return lastGateReason;
    },
    get cuesStopped() {
      return cuesStopped;
    },

    feed(epoch: SensorEpoch, pRem: number | null): NightAction[] {
      if (FINAL_STATES.includes(state)) return [];
      if (epoch == null || value(epoch.t) == null) return [];

      const actions: NightAction[] = [];
      const t = epoch.t;
      const start = startT ?? t;
      startT = start;
      nowT = t;

      // --- sensors --------------------------------------------------------
      const motion = value(epoch.motion);
      const hr = value(epoch.hrMean);

      // Sensor lost mid-night (APP-RUN §2 L2.7 "เซนเซอร์หายกลางคืน → สลับโหมดตัวจับเวลา"):
      // after 10 min with nothing readable the night keeps working off the time prior — the
      // same windows `TIMER` mode uses, and the same `fired` set, so no window can fire
      // twice across the switch, in either direction.
      if (hr == null && motion == null) sensorLostEpochs += 1;
      else sensorLostEpochs = 0;
      const wasFallback = timerFallback;
      timerFallback = mode !== 'CONTROL' && sensorLostEpochs >= SENSOR_LOST_EPOCHS;

      // An unreadable epoch is treated as movement: on this side of the engine a wrong
      // "still" costs the user their sleep (`cueGate` docs). Timer scheduling is the
      // exception — there the motion channel is *known* to be absent (`onset.ts` "no sensor").
      const moved = motion == null ? !timerScheduling() : motion > motionHigh;
      if (moved) lastMoveT = t;

      const reading = wakeDetector.feed(epoch);
      lastHrSpike = reading.hrSpike;
      // Wake-sized movement only (see `WakeReading.motionWake`): counting every 0.05 g
      // twitch here left ~2 % of fuzzed nights stuck in `AWAKE` for an hour and a half,
      // because light sleep simply is not that still (notes §4.3).
      const active = reading.motionWake || reading.hrSpike;
      if (active) lastActiveT = t;

      if (onsetT == null) {
        const onsetReading = onsetDetector.feed(epoch);
        if (onsetReading.onsetT != null) {
          onsetT = onsetReading.onsetT;
          guardUntilT = guardUntil(onsetT, params.guardHours);
        }
      }
      if (onsetT != null && timerWindows.length === 0 && (mode === 'TIMER' || (timerFallback && !wasFallback))) {
        const endT = options.expectedEndT ?? start + 8 * 3600;
        timerWindows = timerCueWindows(onsetT, endT, params, Math.max(1, maxCuesTonight));
      }

      // --- p_REM run counters (§5.1: two epochs above, two below) ----------
      const p = value(pRem);
      if (p != null && p >= params.remThreshold) {
        pRemHighRun += 1;
        pRemLowRun = 0;
      } else if (p != null) {
        pRemLowRun += 1;
        pRemHighRun = 0;
      } else {
        // Unknown is not "low": it must not end a REM bout, but it cannot arm one either.
        pRemHighRun = 0;
      }
      if (pRemLowRun >= REM_BOUT_END_EPOCHS) cuesThisRem = 0;

      // --- seeds, wake, machine -------------------------------------------
      seeds(actions, t);

      if (ASLEEP_STATES.includes(state) && reading.awake) {
        enterAwake(actions, reading.cause ?? 'MOTION', t);
      } else if (state === 'AWAKE' && currentWake != null) {
        currentWake.durationSec = Math.max(0, t - currentWake.t);
        if (active) awakeQuietFromT = Math.max(awakeQuietFromT, t + EPOCH_SECONDS);
      }

      // Several transitions can be due in one epoch (guard ends and REM is already
      // running, say). A cue ends the pass: `CUE` must be visible for one epoch.
      for (let pass = 0; pass < 8; pass += 1) {
        const before = state;
        if (!step(actions, t, p)) break;
        if (state === 'CUE' || before === 'CUE') break;
      }

      if (options.morningAfterT != null && t >= options.morningAfterT && !FINAL_STATES.includes(state)) {
        stopAudio(actions, 'MORNING');
        to(actions, 'MORNING');
        return actions;
      }

      bed(actions, t);
      return actions;
    },

    markWake(cause: WakeCause = 'USER'): NightAction[] {
      if (FINAL_STATES.includes(state)) return [];
      const t = nowT ?? startT ?? 0;
      const actions: NightAction[] = [];
      if (state === 'AWAKE') {
        // Already silent — just extend the quiet requirement.
        awakeQuietFromT = Math.max(awakeQuietFromT, t);
        return actions;
      }
      if (!ASLEEP_STATES.includes(state)) {
        // Before onset the sleeper is awake by definition; nothing to stop.
        return actions;
      }
      enterAwake(actions, cause, t);
      return actions;
    },

    cueResponse(cueId: string, response: CueResponse): void {
      setResponse(cueId, response);
    },

    morning(at?: number): NightAction[] {
      if (FINAL_STATES.includes(state)) return [];
      if (at != null && Number.isFinite(at)) nowT = at;
      const actions: NightAction[] = [];
      if (currentWake != null && nowT != null) {
        currentWake.durationSec = Math.max(currentWake.durationSec, nowT - currentWake.t);
      }
      stopAudio(actions, 'MORNING');
      to(actions, 'MORNING');
      return actions;
    },

    userStop(): NightAction[] {
      if (state === 'ENDED') return [];
      const actions: NightAction[] = [];
      stopAudio(actions, 'USER_STOP');
      to(actions, 'ENDED');
      return actions;
    },
  };

  return controller;
}

// ---------------------------------------------------------------------------
// Volume ramp between nights (§5.3)
// ---------------------------------------------------------------------------

/**
 * Tomorrow's starting volume, from what tonight's cues did (DESIGN §5.3 · oracle K12):
 *
 *   • a cue woke them → **−0.04** (too loud, whatever else happened)
 *   • they heard it inside the dream (`HEARD_IN_DREAM`/`LUCID`) → **unchanged** (it works)
 *   • they did not hear it at all (`NONE`) → **+0.03**
 *   • no answer, or nothing was played (a control night) → unchanged
 *
 * Always inside the hard rails 0.08–0.35 (§0.5 S6). The "remember the ceiling" half of
 * §5.3 is not here: a ceiling is personal state that outlives one night, so it belongs to
 * the personal model of L3.4 — see the notes §6 debt 3.
 */
export function nextNightVolume(history: readonly CueEvent[], current: number): number {
  const base = Number.isFinite(current) ? current : DEFAULT_NIGHT_PARAMS.volumeStart;
  const played = (history ?? []).filter((cue) => cue != null && cue.played !== false);
  if (played.length === 0) return clamp(base, VOLUME_MIN, VOLUME_MAX);

  const woke = played.some((cue) => cue.response === 'WOKE');
  if (woke) return round(clamp(base - VOLUME_STEP_DOWN, VOLUME_MIN, VOLUME_MAX), 3);

  const heard = played.some((cue) => cue.response === 'HEARD_IN_DREAM' || cue.response === 'LUCID');
  if (heard) return clamp(base, VOLUME_MIN, VOLUME_MAX);

  const unheard = played.some((cue) => cue.response === 'NONE');
  if (unheard) return round(clamp(base + VOLUME_STEP_UP, VOLUME_MIN, VOLUME_MAX), 3);

  return clamp(base, VOLUME_MIN, VOLUME_MAX);
}

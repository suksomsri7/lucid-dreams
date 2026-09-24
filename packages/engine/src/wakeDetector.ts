/**
 * `wakeDetector.ts` — L2.7: "is the sleeper awake?" + the no-watch timer mode
 * (DESIGN-APP §5.4 · §5.1 "โหมดไม่มีนาฬิกา" · APP-RUN §2 "L2.7").
 *
 * Two jobs, both pure and both driven by the caller's clock (epoch seconds on the 30 s
 * grid — the engine never reads a wall clock, see `clock.ts`):
 *
 *   1. {@link createWakeDetector} / {@link detectWakeBouts} — the streaming detector the
 *      night controller (L2.6) watches in order to go silent, and its batch form for the
 *      morning report ("you woke up 3 times").
 *   2. {@link timerModeParams} / {@link timerCueWindows} — the night with no heart-rate
 *      source at all. DESIGN §5.1 (owner's decision of 24 Sep, after L2.5) says this mode
 *      does **not** use a `p_REM` threshold: the time prior alone never reaches 0.70, so
 *      the cue fires inside the **prior-peak window of each ~90 min cycle** instead, at
 *      most 4 windows per night, all of them after the Sleep Guard.
 *
 * ## The rules, and why they are shaped like this
 *
 * §5.4 writes a wake as "(accel high for ≥ 60 s) or (HR ↑ ≥ 20 % within 60 s, sustained
 * 2 min) or (the user tapped)", with "movement shorter than 20 s = turning over, not a
 * wake". On the 30 s grid that reads as **two consecutive high-motion epochs** (60 s) and
 * **four consecutive elevated heart-rate epochs** (2 min). A single epoch is never enough
 * — that is the whole point of the 20 s clause.
 *
 * Taking "high motion" to be nothing more than `motion > 0.05 g` is not enough on real
 * wrist data, and the simulator shows why: an N1/N2 twitch is drawn up to ~0.15 g, so a
 * twitch pair clears 0.05 g twice in a row roughly **3 times per night** — an order of
 * magnitude over the false-alarm budget of oracle W2 (≤ 0.3/night). A wake is not just
 * "moved twice", it is *wake-sized* movement: an awake wrist sits at 0.2–0.6 g while a
 * twitch peaks at 0.15 g. So the run must also average at least
 * {@link WAKE_MOTION_LEVEL} (0.15 g, the same "this is not sleep" level the REM estimator
 * uses as `motionWakeLevel`). Measured counts for both rules are in
 * `ledger/wo-notes/L2.6-2.7.md` §4.
 *
 * The heart-rate baseline is a rolling 10 min of *sleeping* epochs: epochs that are
 * themselves elevated (and every epoch of a wake bout) are kept **out** of it, otherwise a
 * 2 min jump drags its own baseline up behind it and the rule silently stops firing on the
 * fourth epoch — exactly the epoch §5.4 wants it to fire on.
 */

import { EPOCH_SECONDS } from './clock';
import { type SensorEpoch } from './diagnostics';
import { GUARD_MIN_HOURS, guardUntil } from './onset';
import { DEFAULT_REM_TUNING, type RemContext, remTimePrior } from './remEstimator';
import { type NightParams, resolveNightParams, type WakeCause } from './types';

// ---------------------------------------------------------------------------
// Constants (every one of them overridable per night · documented in the notes §3)
// ---------------------------------------------------------------------------

/** Wrist acceleration energy (g) above which an epoch counts as movement (oracle K2/W3). */
export const WAKE_MOTION_HIGH = 0.05;
/**
 * Mean movement (g) a run must reach before it is an awakening and not a twitch. An awake
 * wrist is 0.2–0.6 g; the largest sleep twitch the literature (and the simulator) shows is
 * ~0.15 g. Without this second level the false-alarm budget of W2 is blown ~10×.
 */
export const WAKE_MOTION_LEVEL = 0.15;
/** Consecutive high-motion epochs that make a wake — 2 × 30 s = the "60 วิ" of §5.4. */
export const WAKE_MOTION_EPOCHS = 2;
/** Heart-rate rise over the sleeping baseline that counts as a jump (§5.4: 20 %). */
export const WAKE_HR_JUMP = 0.2;
/** Consecutive elevated epochs before the jump counts — 4 × 30 s = the "คงอยู่ 2 นาที". */
export const WAKE_HR_EPOCHS = 4;
/** Length of the rolling sleeping-heart-rate baseline, in epochs (10 min). */
export const WAKE_HR_BASELINE_EPOCHS = 20;
/** No heart-rate verdict before this many baseline epochs have arrived (5 min). */
export const WAKE_HR_MIN_BASELINE_EPOCHS = 10;
/** Quiet epochs that end a wake bout (2 × 30 s = 60 s of nothing happening). */
export const WAKE_QUIET_EPOCHS = 2;
/** A wake that starts within this many seconds of a cue is blamed on the cue (§5.3). */
export const CUE_WOKE_WINDOW_SEC = 180;

/** Cap on cues for a night with no heart-rate source (DESIGN §5.1 · W6). */
export const TIMER_MAX_CUES_PER_NIGHT = 4;
/** Length of one prior-peak window, in seconds (10 min — inside the 5–20 min of W7). */
export const TIMER_WINDOW_SEC = 600;
/** Resolution of the prior-peak search, in seconds. */
export const TIMER_SCAN_STEP_SEC = 60;

// ---------------------------------------------------------------------------
// Streaming detector
// ---------------------------------------------------------------------------

export interface WakeDetectorOptions {
  /** Movement threshold in g (default {@link WAKE_MOTION_HIGH}). */
  motionHigh?: number;
  /** Mean movement a run must reach to be a wake (default {@link WAKE_MOTION_LEVEL}). */
  motionLevel?: number;
  /** Consecutive high-motion epochs required (default {@link WAKE_MOTION_EPOCHS}). */
  motionEpochs?: number;
  /** Relative heart-rate rise that counts as a jump (default {@link WAKE_HR_JUMP}). */
  hrJump?: number;
  /** Consecutive elevated epochs required (default {@link WAKE_HR_EPOCHS}). */
  hrEpochs?: number;
  /** Rolling baseline length in epochs (default {@link WAKE_HR_BASELINE_EPOCHS}). */
  hrBaselineEpochs?: number;
  /** Baseline epochs needed before the heart-rate rule may fire at all. */
  hrMinBaselineEpochs?: number;
  /** Quiet epochs that end a bout (default {@link WAKE_QUIET_EPOCHS}). */
  quietEpochs?: number;
}

/**
 * What the detector knows after one epoch. `awake` is a **state**, not an edge: it stays
 * true until the bout ends ({@link WakeDetectorOptions.quietEpochs} quiet epochs).
 */
export interface WakeReading {
  awake: boolean;
  /** Which rule declared it; `null` while asleep. `USER` never comes from here. */
  cause: WakeCause | null;
  /** First epoch of the current bout (the movement itself, not the epoch that decided). */
  since: number | null;
  /** This epoch carried movement above the threshold — used by the cue gate. */
  motionHigh: boolean;
  /**
   * This epoch carried *wake-sized* movement (≥ {@link WAKE_MOTION_LEVEL}). The night
   * controller counts its "still for 15 min" from this, not from `motionHigh`: a sleeping
   * body twitches over 0.05 g every ~7 min in light sleep, so 15 min without a single
   * twitch is a condition normal sleep rarely meets (notes §4.3).
   */
  motionWake: boolean;
  /** This epoch's heart rate is ≥ 20 % over the sleeping baseline (cue gate `hrSpike`). */
  hrSpike: boolean;
  /** Sleeping heart-rate baseline in bpm, `null` until enough epochs arrived. */
  baselineHr: number | null;
}

export interface WakeDetector {
  /** Feed one epoch, ascending in `t`. O(1) per epoch. */
  feed(epoch: SensorEpoch): WakeReading;
  /** Forget everything (new night, or the sensor source changed). */
  reset(): void;
  readonly awake: boolean;
  readonly cause: WakeCause | null;
  readonly since: number | null;
  /** `t` of the last epoch that carried movement or a heart-rate jump, `null` if none. */
  readonly lastActiveT: number | null;
}

/** Read a sensor number, or `null` when the watch sent nothing usable. */
function value(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Wake detector — one instance per night.
 *
 * ```ts
 * const d = createWakeDetector({});
 * for (const epoch of epochs) if (d.feed(epoch).awake) stopAudio();
 * ```
 *
 * A missing sensor (`motion`/`hrMean` `null`) can never wake anybody: silence is not
 * evidence (oracle W5). The night controller applies the opposite bias to the *cue* gate —
 * an unreadable epoch is treated as movement there, because there a wrong "yes" costs the
 * user their sleep.
 */
export function createWakeDetector(options: WakeDetectorOptions = {}): WakeDetector {
  const motionHigh = options.motionHigh ?? WAKE_MOTION_HIGH;
  const motionLevel = Math.max(options.motionLevel ?? WAKE_MOTION_LEVEL, motionHigh);
  const motionEpochs = Math.max(1, Math.round(options.motionEpochs ?? WAKE_MOTION_EPOCHS));
  const hrJump = options.hrJump ?? WAKE_HR_JUMP;
  const hrEpochs = Math.max(1, Math.round(options.hrEpochs ?? WAKE_HR_EPOCHS));
  const hrBaselineEpochs = Math.max(2, Math.round(options.hrBaselineEpochs ?? WAKE_HR_BASELINE_EPOCHS));
  const hrMinBaselineEpochs = Math.max(
    1,
    Math.min(hrBaselineEpochs, Math.round(options.hrMinBaselineEpochs ?? WAKE_HR_MIN_BASELINE_EPOCHS)),
  );
  const quietEpochs = Math.max(1, Math.round(options.quietEpochs ?? WAKE_QUIET_EPOCHS));

  let awake = false;
  let cause: WakeCause | null = null;
  let since: number | null = null;
  let lastActiveT: number | null = null;

  let motionRun = 0;
  let motionRunSum = 0;
  let motionRunStartT: number | null = null;

  let hrRun = 0;
  let hrRunStartT: number | null = null;

  let quietRun = 0;

  /** Rolling window of *sleeping* heart rates, oldest first. */
  const hrBaseline: number[] = [];

  function baselineHr(): number | null {
    if (hrBaseline.length < hrMinBaselineEpochs) return null;
    let sum = 0;
    for (const v of hrBaseline) sum += v;
    return sum / hrBaseline.length;
  }

  return {
    feed(epoch: SensorEpoch): WakeReading {
      const t = epoch.t;
      const motion = value(epoch.motion);
      const hr = value(epoch.hrMean);

      // --- movement -------------------------------------------------------
      const motionHighNow = motion != null && motion > motionHigh;
      if (motionHighNow && motion != null) {
        motionRun += 1;
        motionRunSum += motion;
        if (motionRun === 1) motionRunStartT = t;
      } else {
        motionRun = 0;
        motionRunSum = 0;
        motionRunStartT = null;
      }
      // A run is an awakening only when it is wake-sized on average: two twitches in a row
      // are still turning over (§5.4 "พลิกตัว ... ไม่นับ").
      const motionWake = motionRun >= motionEpochs && motionRunSum / motionRun >= motionLevel;

      // --- heart rate -----------------------------------------------------
      const base = baselineHr();
      const hrSpikeNow = hr != null && base != null && hr >= base * (1 + hrJump);
      if (hr != null && !hrSpikeNow && !awake) {
        // Only quiet, asleep epochs may define what "normal" is.
        hrBaseline.push(hr);
        if (hrBaseline.length > hrBaselineEpochs) hrBaseline.shift();
      }
      if (hrSpikeNow) {
        hrRun += 1;
        if (hrRun === 1) hrRunStartT = t;
      } else {
        hrRun = 0;
        hrRunStartT = null;
      }
      const hrWake = hrRun >= hrEpochs;

      // --- bout bookkeeping ------------------------------------------------
      const active = motionHighNow || hrSpikeNow;
      if (active) lastActiveT = t;

      if (!awake) {
        if (motionWake) {
          awake = true;
          cause = 'MOTION';
          since = motionRunStartT ?? t;
          quietRun = 0;
        } else if (hrWake) {
          awake = true;
          cause = 'HR';
          since = hrRunStartT ?? t;
          quietRun = 0;
        }
      } else if (active) {
        quietRun = 0;
      } else {
        quietRun += 1;
        if (quietRun >= quietEpochs) {
          awake = false;
          cause = null;
          since = null;
          quietRun = 0;
        }
      }

      return {
        awake,
        cause,
        since,
        motionHigh: motionHighNow,
        motionWake: motion != null && motion >= motionLevel,
        hrSpike: hrSpikeNow,
        baselineHr: base,
      };
    },
    reset(): void {
      awake = false;
      cause = null;
      since = null;
      lastActiveT = null;
      motionRun = 0;
      motionRunSum = 0;
      motionRunStartT = null;
      hrRun = 0;
      hrRunStartT = null;
      quietRun = 0;
      hrBaseline.length = 0;
    },
    get awake() {
      return awake;
    },
    get cause() {
      return cause;
    },
    get since() {
      return since;
    },
    get lastActiveT() {
      return lastActiveT;
    },
  };
}

// ---------------------------------------------------------------------------
// Batch form: the wake bouts of a whole night
// ---------------------------------------------------------------------------

/** One awakening as the morning report shows it. `endT` is the last *active* epoch. */
export interface WakeBout {
  startT: number;
  endT: number;
  cause: WakeCause;
}

/**
 * Every wake bout in a recorded night — the same rules as {@link createWakeDetector}, fed
 * one epoch at a time, so the report can never disagree with what the night did live.
 *
 * A bout starts at the first epoch of the movement (not at the epoch that made the
 * decision) and ends at its last active epoch; {@link WAKE_QUIET_EPOCHS} quiet epochs
 * close it, so a sleeper who shifts twice a minute apart reads as one awakening, not two.
 */
export function detectWakeBouts(
  epochs: readonly SensorEpoch[],
  options: WakeDetectorOptions = {},
): WakeBout[] {
  const detector = createWakeDetector(options);
  const bouts: WakeBout[] = [];
  let current: WakeBout | null = null;

  for (const epoch of epochs) {
    const reading = detector.feed(epoch);
    if (reading.awake) {
      if (current == null) {
        current = { startT: reading.since ?? epoch.t, endT: epoch.t, cause: reading.cause ?? 'MOTION' };
      } else if (reading.motionHigh || reading.hrSpike) {
        current.endT = epoch.t;
      }
    } else if (current != null) {
      bouts.push(current);
      current = null;
    }
  }
  if (current != null) bouts.push(current);
  return bouts;
}

// ---------------------------------------------------------------------------
// Timer mode (no heart-rate source at all)
// ---------------------------------------------------------------------------

/**
 * Night parameters with no watch. `mode: 'TIMER'` is deliberately **not** a
 * {@link import('./types').NightMode}: `CUE`/`CONTROL` says whether audio is played at all
 * (and that is what `cueGate` checks), while `TIMER` says how the moment is *chosen*. A
 * timer night still plays, still obeys every gate, and is still allowed to be a control
 * night — those are two independent axes.
 */
export type TimerNightParams = Omit<NightParams, 'mode'> & { mode: 'TIMER' };

/**
 * Switch a profile into timer mode: at most {@link TIMER_MAX_CUES_PER_NIGHT} cues, the
 * Sleep Guard untouched (W6). The `p_REM` threshold is left in the object but is never
 * read in this mode — see {@link timerCueWindows} for what replaces it.
 */
export function timerModeParams(params?: Partial<NightParams>): TimerNightParams {
  const resolved = resolveNightParams(params);
  return {
    ...resolved,
    maxCuesPerNight: Math.min(resolved.maxCuesPerNight, TIMER_MAX_CUES_PER_NIGHT),
    mode: 'TIMER',
  };
}

/** One window in which a timer-mode night is allowed to whisper once. */
export interface TimerCueWindow {
  startT: number;
  endT: number;
  /** Peak of the time prior inside the window (the middle, except where clamped). */
  peakT: number;
  /** Value of `remTimePrior` at `peakT` — log-odds, only comparable with itself. */
  prior: number;
}

/**
 * The ≤ 4 windows of a no-watch night (DESIGN §5.1, decision of 24 Sep).
 *
 * How they are found: walk the night in {@link TIMER_SCAN_STEP_SEC} steps, ask
 * `remTimePrior` (L2.5 — the *same* prior the full estimator uses, so the two modes never
 * drift apart) and keep the highest point of every ~90 min cycle. Peaks that fall inside
 * the Sleep Guard are dropped, not shifted: a window that has been moved off its peak is
 * not a prior-peak window any more, it is just a guess. Of the survivors the four with the
 * strongest prior are kept and returned in time order.
 *
 * Every window is {@link TIMER_WINDOW_SEC} long (10 min — comfortably inside the 5–20 min
 * of oracle W7), non-overlapping by construction (peaks are a cycle apart) and clipped to
 * `[guardEnd, endT]`.
 */
export function timerCueWindows(
  onsetT: number,
  endT: number,
  params?: Partial<NightParams>,
  maxWindows: number = TIMER_MAX_CUES_PER_NIGHT,
): TimerCueWindow[] {
  if (!Number.isFinite(onsetT) || !Number.isFinite(endT)) return [];
  const guardHours = Math.max(GUARD_MIN_HOURS, params?.guardHours ?? resolveNightParams(params).guardHours);
  const guardEnd = guardUntil(onsetT, guardHours);
  if (endT <= guardEnd) return [];

  const tuning = DEFAULT_REM_TUNING;
  const ctx: RemContext = { onsetT, nightStartT: onsetT, expectedEndT: endT };
  const cycleSec = Math.max(30, tuning.cycleMin) * 60;
  const half = Math.round(TIMER_WINDOW_SEC / 2);

  // Local maxima of the prior, found by walking the night — never "the best point of a
  // 90 min bucket": the last bucket of a night is a *partial* cycle, and its best point is
  // wherever the walk happened to stop, which produced a spurious second window 10 min
  // after the real one (found by the fuzz of this WO — notes §4.4). A peak is a peak only
  // when the prior rose into it and falls out of it again.
  const peaks: { peakT: number; prior: number }[] = [];
  const scan: { t: number; p: number }[] = [];
  for (let t = onsetT; t <= endT; t += TIMER_SCAN_STEP_SEC) {
    scan.push({ t, p: remTimePrior(t, ctx, tuning) });
  }
  for (let i = 1; i < scan.length - 1; i += 1) {
    const here = scan[i] as { t: number; p: number };
    const before = scan[i - 1] as { t: number; p: number };
    const after = scan[i + 1] as { t: number; p: number };
    if (!(here.p > before.p && here.p >= after.p)) continue;
    // Drop a peak whose window cannot exist after the guard, or would not fit the night.
    if (here.t < guardEnd || here.t + half > endT) continue;
    peaks.push({ peakT: here.t, prior: here.p });
  }

  // Strongest prior first (late cycles hold most of the REM — DESIGN §5.2), at most one
  // window per cycle, then back into time order for the caller.
  const kept: { peakT: number; prior: number }[] = [];
  for (const peak of peaks.slice().sort((a, b) => b.prior - a.prior || a.peakT - b.peakT)) {
    if (kept.length >= Math.max(0, Math.round(maxWindows))) break;
    if (kept.some((k) => Math.abs(k.peakT - peak.peakT) < cycleSec / 2)) continue;
    kept.push(peak);
  }
  const chosen = kept.sort((a, b) => a.peakT - b.peakT);

  const windows: TimerCueWindow[] = [];
  for (const peak of chosen) {
    const previous = windows[windows.length - 1];
    let startT = Math.max(peak.peakT - half, guardEnd, previous ? previous.endT : Number.NEGATIVE_INFINITY);
    let end = Math.min(startT + TIMER_WINDOW_SEC, endT);
    if (end - startT < TIMER_WINDOW_SEC && end === endT) startT = Math.max(startT, end - TIMER_WINDOW_SEC);
    if (end - startT < TIMER_SCAN_STEP_SEC * 5) continue; // shorter than the 5 min floor of W7
    if (previous && startT < previous.endT) continue;
    // Keep the grid tidy: windows land on whole epochs, like everything else in the engine.
    startT = Math.floor(startT / EPOCH_SECONDS) * EPOCH_SECONDS;
    if (startT < guardEnd) startT = Math.ceil(guardEnd / EPOCH_SECONDS) * EPOCH_SECONDS;
    end = Math.min(startT + TIMER_WINDOW_SEC, endT);
    if (end - startT < TIMER_SCAN_STEP_SEC * 5) continue;
    windows.push({ startT, endT: end, peakT: peak.peakT, prior: peak.prior });
  }
  return windows;
}

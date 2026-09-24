/**
 * `onset.ts` — L2.4: falling asleep (DESIGN-APP §5.1 `FALLING_ASLEEP` · §5.3 · APP-RUN §2 "L2.4").
 *
 * Four small, pure pieces, all driven by the caller's clock (epoch seconds on the 30 s
 * grid — the engine never reads a wall clock, see `clock.ts`):
 *
 *   1. {@link createOnsetDetector} / {@link detectOnset} — "is the sleeper asleep, and
 *      when did that happen?". The answer anchors the whole night: Sleep Guard starts at
 *      `onsetT`, the seed whispers stop at `onsetT`, the ambience fades at `onsetT`.
 *   2. {@link seedWhisperTimes} — the two theme whispers at minute 3 and 8 *of the night*,
 *      only played while still awake.
 *   3. {@link bedVolumePlan} — the ambience fade 20 % → 8 % over 60 s after onset.
 *   4. {@link guardUntil} — the Sleep Guard end, never shorter than 2 h.
 *
 * ## The rule, and why it is shaped like this
 *
 * DESIGN §5.1 writes onset as "HR down ≥ 8 % from the waking baseline **and** low motion
 * for 10 minutes". Implemented literally on wrist data that rule fires far too late: the
 * pre-sleep baseline of the first 5 minutes is already N1/N2 (only ~2 bpm above quiet
 * sleep), so −8 % is not reached until **N3**, half an hour into the night
 * (`ledger/wo-notes/L2.1.md` §8 flagged this in advance). So the detector uses two paths:
 *
 *   • **settled path** (the normal one): 10 minutes of low motion *and* a heart rate that
 *     has stopped being above the waking baseline. This is what "lying still, heart come
 *     down" looks like on a watch and it is reached within a minute or two of real onset.
 *   • **deep path** (confirmation): the full −8 % drop of §5.1. It can declare onset on its
 *     own with only half the quiet window, for the nights where the sleeper was restless
 *     (many twitches) but clearly sank into deep sleep.
 *
 * Both paths report `onsetT` as the **first epoch of the quiet window**, floored at
 * {@link ONSET_MIN_LATENCY_SEC} after the start of the record: a wrist cannot see the
 * N1 → N2 boundary at all (both stages have the same heart rate and the same stillness),
 * so the only honest estimate of "when exactly" is the middle of the 5–25 min sleep-latency
 * prior. **The reported onset is therefore prior-dominated, not evidence-dominated** — see
 * `ledger/wo-notes/L2.4-2.5.md` §6 debt 1 before trusting it on a real night.
 *
 * Nothing here ever declares onset before {@link ONSET_MIN_DATA_SEC} of data (15 min): a
 * detector that fires at minute 6 would start the Sleep Guard early, and the guard is the
 * one thing that protects the first three hours of sleep.
 */

import { EPOCH_SECONDS } from './clock';
import { type SensorEpoch } from './diagnostics';
import { clamp } from './rng';

// ---------------------------------------------------------------------------
// Constants (all overridable per night, all documented in wo-notes/L2.4-2.5.md §3)
// ---------------------------------------------------------------------------

/** No sensor at all → declare onset this long after the start (DESIGN §5.1 timer mode). */
export const ONSET_NO_SENSOR_TIMEOUT_SEC = 1500;
/** Epochs of the waking baseline (first 5 minutes of the record). */
export const ONSET_BASELINE_EPOCHS = 10;
/** Length of the quiet window, in epochs — 20 × 30 s = the "10 นาที" of §5.1. */
export const ONSET_QUIET_EPOCHS = 20;
/** Heart-rate drop that counts as deep sleep, as a fraction of the waking baseline. */
export const ONSET_HR_DROP_RATIO = 0.08;
/** Wrist acceleration energy (g) below which an epoch counts as still. */
export const ONSET_MOTION_QUIET = 0.02;
/** Any epoch above this is a real movement, not a twitch — it breaks the window. */
export const ONSET_MOTION_MOVE = 0.25;
/** Twitches tolerated inside one quiet window (see §3 of the notes for the arithmetic). */
export const ONSET_MAX_TWITCH_EPOCHS = 4;
/** The window mean may reach `motionQuiet × this` — one twitch must not void 10 min. */
export const ONSET_MOTION_MEAN_FACTOR = 2;
/** Share of the quiet window that must actually carry motion data (dropout tolerance). */
export const ONSET_MIN_COVERAGE = 0.6;
/**
 * Below this share of usable epochs the record cannot support a 10 min quiet window at all,
 * and the night falls back to the timer — "ถ้าทุกแหล่งหลุด → โหมดตัวจับเวลา" (DESIGN §5.1)
 * read as "if the sources are gone *enough*", which is what a flapping watch really does.
 */
export const ONSET_TIMER_COVERAGE = 0.5;
/** Never declare onset before this much data has arrived (15 min · oracle N2). */
export const ONSET_MIN_DATA_SEC = 900;
/**
 * Floor for the reported `onsetT`, seconds after the first epoch. 15 min = the middle of
 * the 5–25 min sleep-latency prior; the wrist carries no information that beats it.
 */
export const ONSET_MIN_LATENCY_SEC = 900;

/** Ambience volume while still awake (DESIGN §5.3). */
export const BED_VOLUME_FULL = 0.2;
/** Ambience volume once asleep — the floor the whisper rises out of. */
export const BED_VOLUME_BED = 0.08;
/** Length of the fade from full to bed, in seconds. */
export const BED_FADE_SEC = 60;

/** Seed whispers at minute 3 and minute 8 of the night (DESIGN §5.1). */
export const SEED_WHISPER_OFFSETS_SEC: readonly number[] = [180, 480];

/** Sleep Guard can be shortened in settings, but never below this (APP-RUN §2 L2.4). */
export const GUARD_MIN_HOURS = 2;

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export interface OnsetOptions {
  /** Declare onset this long after the start when no sensor ever reports. */
  noSensorTimeoutSec?: number;
  /** Epochs averaged into the waking heart-rate baseline. */
  baselineEpochs?: number;
  /** Epochs that must be quiet in a row. */
  quietEpochs?: number;
  /** Required heart-rate drop for the deep path, as a fraction of the baseline. */
  hrDropRatio?: number;
  /** Motion (g) at or below which an epoch counts as still. */
  motionQuiet?: number;
  /** Motion (g) above which an epoch is a movement and voids the window. */
  motionMove?: number;
  /** Twitches tolerated inside one quiet window. */
  maxTwitchEpochs?: number;
  /** The window mean motion may reach `motionQuiet × this`. */
  motionMeanFactor?: number;
  /** Share of the quiet window that must carry motion data (0..1). */
  minCoverage?: number;
  /** Below this share of usable epochs, fall back to the timer. */
  timerCoverage?: number;
  /** Minimum seconds of data before onset may be declared. */
  minDataSec?: number;
  /** Floor for the reported `onsetT`, seconds after the first epoch. */
  minLatencySec?: number;
}

/** What the detector knows after one epoch. */
export interface OnsetReading {
  /** `true` from the epoch onset was declared onwards (sticky — it is a state, not an edge). */
  onset: boolean;
  /** Sleep onset on the caller's clock, `null` until declared. */
  onsetT: number | null;
  /** Mean heart rate of the waking baseline, `null` while it is still being collected. */
  baselineHr: number | null;
  /** Which rule declared it — `null` while still awake. */
  via: OnsetVia | null;
}

/** `SETTLED` = still + heart rate no longer elevated · `DEEP` = the −8 % drop · `TIMER` = no sensor. */
export type OnsetVia = 'SETTLED' | 'DEEP' | 'TIMER';

export interface OnsetDetector {
  /** Feed one epoch, ascending in `t`. Cheap: O(1) per epoch. */
  feed(epoch: SensorEpoch): OnsetReading;
  /** Sleep onset once declared, else `null`. */
  readonly onsetT: number | null;
  /** Waking heart-rate baseline once collected, else `null`. */
  readonly baselineHr: number | null;
  readonly via: OnsetVia | null;
  /** First epoch seen, `null` before the first `feed()`. */
  readonly startT: number | null;
}

interface QuietEntry {
  t: number;
  motion: number | null;
  hr: number | null;
}

/** Read a sensor number, or `null` when the watch sent nothing usable. */
function value(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Sleep-onset detector — one instance per night, fed one epoch at a time.
 *
 * ```ts
 * const d = createOnsetDetector({});
 * for (const epoch of epochs) {
 *   const r = d.feed(epoch);
 *   if (r.onset) { /* start the Sleep Guard at r.onsetT *\/ }
 * }
 * ```
 */
export function createOnsetDetector(options: OnsetOptions = {}): OnsetDetector {
  const noSensorTimeoutSec = options.noSensorTimeoutSec ?? ONSET_NO_SENSOR_TIMEOUT_SEC;
  const baselineEpochs = Math.max(1, Math.round(options.baselineEpochs ?? ONSET_BASELINE_EPOCHS));
  const quietEpochs = Math.max(1, Math.round(options.quietEpochs ?? ONSET_QUIET_EPOCHS));
  const hrDropRatio = options.hrDropRatio ?? ONSET_HR_DROP_RATIO;
  const motionQuiet = options.motionQuiet ?? ONSET_MOTION_QUIET;
  const motionMove = Math.max(options.motionMove ?? ONSET_MOTION_MOVE, motionQuiet);
  const maxTwitchEpochs = Math.max(0, Math.round(options.maxTwitchEpochs ?? ONSET_MAX_TWITCH_EPOCHS));
  const motionMeanFactor = Math.max(1, options.motionMeanFactor ?? ONSET_MOTION_MEAN_FACTOR);
  const minCoverage = clamp(options.minCoverage ?? ONSET_MIN_COVERAGE, 0.1, 1);
  const timerCoverage = clamp(options.timerCoverage ?? ONSET_TIMER_COVERAGE, 0, 1);
  const minDataSec = options.minDataSec ?? ONSET_MIN_DATA_SEC;
  const minLatencySec = options.minLatencySec ?? ONSET_MIN_LATENCY_SEC;

  let startT: number | null = null;
  let baselineSum = 0;
  let baselineCount = 0;
  let baselineHr: number | null = null;
  /** `true` while every epoch so far carried neither heart rate nor motion. */
  let epochsSeen = 0;
  let epochsWithData = 0;
  let onsetT: number | null = null;
  let via: OnsetVia | null = null;
  const window: QuietEntry[] = [];

  const reading = (): OnsetReading => ({ onset: onsetT != null, onsetT, baselineHr, via });

  /** Does the trailing window satisfy one of the two paths? Returns how, or `null`. */
  function windowVerdict(needEpochs: number, requireDrop: boolean): boolean {
    if (window.length < needEpochs) return false;
    const slice = window.slice(window.length - needEpochs);

    let twitches = 0;
    let motionSum = 0;
    let motionSeen = 0;
    let hrSum = 0;
    let hrSeen = 0;
    for (const entry of slice) {
      if (entry.motion != null) {
        motionSeen += 1;
        motionSum += entry.motion;
        if (entry.motion > motionMove) return false;
        if (entry.motion > motionQuiet) twitches += 1;
      }
      if (entry.hr != null) {
        hrSeen += 1;
        hrSum += entry.hr;
      }
    }
    // Motion is the load-bearing signal, but a watch that drops every third epoch still
    // says plenty: judge the epochs that arrived, as long as enough of them did.
    if (motionSeen < Math.max(1, Math.ceil(needEpochs * minCoverage))) return false;
    if (twitches > maxTwitchEpochs) return false;
    if (motionSum / motionSeen > motionQuiet * motionMeanFactor) return false;

    if (baselineHr == null || hrSeen === 0) return !requireDrop;
    const meanHr = hrSum / hrSeen;
    return requireDrop
      ? meanHr <= baselineHr * (1 - hrDropRatio)
      : // settled path: the heart has at least stopped being above the waking baseline.
        meanHr <= baselineHr;
  }

  return {
    feed(epoch: SensorEpoch): OnsetReading {
      const t = epoch.t;
      if (startT == null) startT = t;

      const motion = value(epoch.motion);
      const hr = value(epoch.hrMean);
      epochsSeen += 1;
      if (motion != null || hr != null) epochsWithData += 1;

      if (hr != null && baselineCount < baselineEpochs) {
        baselineSum += hr;
        baselineCount += 1;
        baselineHr = baselineSum / baselineCount;
      }

      window.push({ t, motion, hr });
      if (window.length > quietEpochs) window.shift();

      if (onsetT != null) return reading();

      // Not enough sensor to ever fill a quiet window (usually: nothing at all) →
      // the timer decides, exactly as DESIGN §5.1 prescribes for "no watch".
      const coverage = epochsSeen > 0 ? epochsWithData / epochsSeen : 0;
      if (coverage <= timerCoverage) {
        const deadline = startT + noSensorTimeoutSec;
        if (t >= deadline) {
          onsetT = deadline;
          via = 'TIMER';
        }
        return reading();
      }

      // Never before 15 min of data — an early guard start is worse than a late one.
      if (t - startT < minDataSec) return reading();

      const settled = windowVerdict(quietEpochs, false);
      const deep = settled ? false : windowVerdict(Math.max(1, Math.ceil(quietEpochs / 2)), true);
      if (!settled && !deep) return reading();

      const used = settled ? quietEpochs : Math.max(1, Math.ceil(quietEpochs / 2));
      const first = window[Math.max(0, window.length - used)] as QuietEntry;
      onsetT = Math.max(first.t, startT + minLatencySec);
      via = settled ? 'SETTLED' : 'DEEP';
      return reading();
    },
    get onsetT() {
      return onsetT;
    },
    get baselineHr() {
      return baselineHr;
    },
    get via() {
      return via;
    },
    get startT() {
      return startT;
    },
  };
}

export interface OnsetResult {
  onsetT: number | null;
  baselineHr: number | null;
  via: OnsetVia | null;
}

/**
 * Batch form: identical to feeding the same epochs one at a time (oracle N2), so the
 * morning report and the live night can never disagree.
 */
export function detectOnset(epochs: readonly SensorEpoch[], options: OnsetOptions = {}): OnsetResult {
  const detector = createOnsetDetector(options);
  for (const epoch of epochs) detector.feed(epoch);
  return { onsetT: detector.onsetT, baselineHr: detector.baselineHr, via: detector.via };
}

// ---------------------------------------------------------------------------
// Seed whispers · bed fade · guard
// ---------------------------------------------------------------------------

/**
 * When the two theme whispers of `FALLING_ASLEEP` are due — minute 3 and minute 8 after
 * the night started. The caller (L2.6) must skip any of them that falls after `onsetT`:
 * once asleep, the seed is over and the night belongs to the Sleep Guard.
 */
export function seedWhisperTimes(startT: number): number[] {
  return SEED_WHISPER_OFFSETS_SEC.map((offset) => startT + offset);
}

/** A seed whisper may only play while awake, and only within the first 15 min. */
export function seedWhisperDue(startT: number, onsetT: number | null, nowT: number): number | null {
  for (const at of seedWhisperTimes(startT)) {
    if (nowT !== at) continue;
    if (onsetT != null && at >= onsetT) return null;
    return at;
  }
  return null;
}

export interface BedFadeOptions {
  /** Ambience volume while awake (default {@link BED_VOLUME_FULL}). */
  full?: number;
  /** Ambience volume once asleep (default {@link BED_VOLUME_BED}). */
  bed?: number;
  /** Fade length in seconds (default {@link BED_FADE_SEC}). */
  fadeSec?: number;
}

/**
 * Ambience volume at `nowT`: `full` until onset, then a linear fade to `bed` over
 * `fadeSec`. Never returns anything outside `[min(full,bed), max(full,bed)]`, so a corrupt
 * profile cannot make the bed loud.
 */
export function bedVolumePlan(
  startT: number,
  onsetT: number | null,
  nowT: number,
  options: BedFadeOptions = {},
): number {
  const full = Number.isFinite(options.full) ? (options.full as number) : BED_VOLUME_FULL;
  const bed = Number.isFinite(options.bed) ? (options.bed as number) : BED_VOLUME_BED;
  const fadeSec = Math.max(0, Number.isFinite(options.fadeSec) ? (options.fadeSec as number) : BED_FADE_SEC);
  const lo = Math.min(full, bed);
  const hi = Math.max(full, bed);

  if (onsetT == null || nowT <= onsetT || nowT < startT) return clamp(full, lo, hi);
  if (fadeSec === 0 || nowT >= onsetT + fadeSec) return clamp(bed, lo, hi);
  const progress = (nowT - onsetT) / fadeSec;
  return clamp(full + (bed - full) * progress, lo, hi);
}

/**
 * End of the Sleep Guard. `guardHours` comes from settings and is *never* trusted:
 * anything below {@link GUARD_MIN_HOURS} is raised to it (APP-RUN §2 L2.4 — a guard
 * shorter than two hours would let a cue land in the first deep-sleep cycle).
 */
export function guardUntil(onsetT: number, guardHours: number): number {
  const hours = Number.isFinite(guardHours) ? Math.max(GUARD_MIN_HOURS, guardHours) : GUARD_MIN_HOURS;
  return onsetT + hours * 3600;
}

/** Epochs in the quiet window — exported so the notes and the report screens agree. */
export const ONSET_QUIET_SEC = ONSET_QUIET_EPOCHS * EPOCH_SECONDS;

/**
 * Synthetic night generator — the test bench for the whole night engine.
 *
 * Why this file exists (APP-RUN §0.2 rule 1): the owner sleeps once per night, so
 * a REM estimator, a cue controller or a wake detector can never be developed
 * against real nights alone. `simulateNight` produces a physiologically shaped
 * hypnogram **plus the answer key**, so every later work order can be graded on
 * hundreds of nights in a second, on the VPS, with no phone and no watch.
 *
 * ## What "realistic" means here
 * The generator is a *caricature* of adult sleep architecture, not a model of it.
 * It reproduces the handful of regularities the engine actually relies on:
 *
 * 1. **Sleep onset latency** 5–25 min, scored `N1` then `N2`; `onsetT` is the
 *    moment sleep consolidates (what L2.4's onset detector must find).
 * 2. **NREM/REM cycles of ~90 min** (jitter ±10), ordered `N2 → N3 → N2 → REM`.
 * 3. **REM latency ≥ 60 min** after onset — the first REM bout is short (~10 min).
 * 4. **REM bouts grow** across the night (20–40 min late), so most REM sits in the
 *    second half. This is the entire reason the Sleep Guard of 3 h costs so little.
 * 5. **N3 is front-loaded**: ~45 % of cycle 1's NREM, almost none after cycle 3.
 * 6. **Brief awakenings** (2–8 min) after the first hour, usually at the end of a
 *    REM bout, and re-entry through `N1`.
 * 7. **A short morning WAKE** at the end of the record.
 *
 * Sources these numbers are taken from (see `ledger/wo-notes/L2.1.md` for the
 * discussion): AASM scoring manual stage definitions; Carskadon & Dement,
 * "Normal Human Sleep: An Overview" (Principles and Practice of Sleep Medicine,
 * 6th ed.) for cycle length, REM latency, the REM-lengthens/N3-front-loads
 * pattern and adult stage percentages (N1 2–5 %, N2 45–55 %, N3 13–23 %,
 * REM 20–25 %, WASO < 5–10 %); Trinder et al. on heart rate and heart-rate
 * variability by stage (lowest and most regular in N3, higher and markedly more
 * variable in REM); and the actigraphy literature behind wrist trackers for
 * "REM is near-motionless (atonia) with rare twitches, WAKE is an order of
 * magnitude more active".
 *
 * ## Determinism
 * Everything random comes from {@link mulberry32} seeded with `opts.seed`, so a
 * seed is a night: same input, same bytes (oracle E1). No wall clock is read —
 * the night starts at `opts.sleepAtIso`.
 */

import { EPOCH_SECONDS, epochIndexOf } from './clock';
import { type SensorEpoch } from './diagnostics';
import { clamp, mulberry32, round, type Rng } from './rng';
import { type SleepStage, type StageSample } from './types';

/** Epochs in one minute at the 30 s grid. */
const EPOCHS_PER_MIN = 60 / EPOCH_SECONDS;

/** Shortest night the generator accepts — below this a 90 min cycle cannot exist. */
const MIN_DURATION_MIN = 120;

/** Heart rate rails used when clamping, kept strictly inside `SensorEpochSchema`. */
const HR_SAFE_MIN = 26;
const HR_SAFE_MAX = 210;

export interface SimulateNightOptions {
  /** Any finite number — one seed is one night. */
  seed: number;
  /** When the lights went out, ISO-8601 with offset. Floored onto the 30 s grid. */
  sleepAtIso: string;
  /** Length of the record in minutes (default 480 = 8 h). */
  durationMin?: number;
  /** Mean NREM/REM cycle length in minutes (default 90). */
  cycleMin?: number;
  /** Uniform jitter applied to each cycle, in minutes (default 10). */
  cycleJitterMin?: number;
  /** Brief mid-night awakenings to place after the first hour (default 2). */
  wakeCount?: number;
  /** Multiplier on every signal's noise. 1 = normal, 3 = a bad night on a loose strap. */
  noise?: number;
  /** Force the sleep-onset latency in minutes instead of drawing 5–25. */
  latencyMin?: number;
  /** Force the REM share of the record (0..1) instead of drawing ~0.21–0.245. */
  remFraction?: number;
  /** Probability that an epoch arrives with no usable sensor values (default 0). */
  dropoutRate?: number;
}

/** One planned NREM/REM cycle — handy when a later oracle needs to know "which bout". */
export interface SimCyclePlan {
  /** 0-based cycle number. */
  index: number;
  startT: number;
  durationSec: number;
  n3Sec: number;
  /** `null` when the cycle has no REM (only possible on a truncated night). */
  remStartT: number | null;
  remSec: number;
}

/** A mid-night awakening the generator placed. */
export interface SimWakeBout {
  startT: number;
  durationSec: number;
}

/** Everything that was decided for this night — echoed back so reports are reproducible. */
export interface SimNightParams {
  seed: number;
  sleepAtIso: string;
  /** First epoch of the record, epoch seconds on the 30 s grid. */
  startT: number;
  durationMin: number;
  epochCount: number;
  epochSeconds: number;
  cycleMin: number;
  cycleJitterMin: number;
  wakeCount: number;
  noise: number;
  dropoutRate: number;
  /** Sleep onset latency actually used, in minutes. */
  latencyMin: number;
  /** REM share of the record actually budgeted, 0..1. */
  remFraction: number;
  /** This night's resting heart rate, bpm. */
  hrBaseline: number;
  /** Morning WAKE length in minutes. */
  morningWakeMin: number;
  cycles: SimCyclePlan[];
  wakeBouts: SimWakeBout[];
}

export interface SimulatedNight {
  /** What the watch would have sent, one row per 30 s, ascending and gap-free. */
  epochs: SensorEpoch[];
  /** The answer key, 1:1 with `epochs` by `t`. */
  truth: StageSample[];
  /** Sleep onset, epoch seconds — the anchor of the Sleep Guard (DESIGN §5.1). */
  onsetT: number;
  params: SimNightParams;
}

// ---------------------------------------------------------------------------
// Physiology tables (per stage)
// ---------------------------------------------------------------------------

/** Heart rate offset from this night's resting baseline, bpm. */
const HR_OFFSET: Record<SleepStage, number> = { WAKE: 10, N1: 2, N2: 0, N3: -5, REM: 3 };

/** Epoch-to-epoch scatter of `hrMean`, bpm (1 sd). */
const HR_JITTER: Record<SleepStage, number> = { WAKE: 3, N1: 1.6, N2: 1.2, N3: 0.8, REM: 2.6 };

/** Within-epoch heart-rate variability, bpm. REM is drawn from a band, see below. */
const HR_SD: Record<SleepStage, number> = { WAKE: 6, N1: 2.5, N2: 2, N3: 1, REM: 5 };

/** Baseline wrist acceleration energy, g. */
const MOTION_BASE: Record<SleepStage, number> = {
  WAKE: 0.4,
  N1: 0.006,
  N2: 0.004,
  N3: 0.005,
  REM: 0.003,
};

/** Chance of a twitch/position change in this epoch, and how big it is (g). */
const TWITCH: Record<SleepStage, { p: number; min: number; max: number }> = {
  WAKE: { p: 0, min: 0, max: 0 },
  N1: { p: 0.12, min: 0.03, max: 0.2 },
  N2: { p: 0.08, min: 0.02, max: 0.15 },
  N3: { p: 0.02, min: 0.01, max: 0.05 },
  REM: { p: 0.02, min: 0.02, max: 0.08 },
};

/**
 * Share of a cycle's NREM time spent in N3, by cycle number. Slow-wave sleep is
 * paid off early: by cycle 4 an adult has almost none left (Carskadon & Dement).
 */
const N3_SHARE = [0.45, 0.35, 0.18, 0.06, 0.02, 0, 0, 0];

/** Relative REM length by cycle number — the "REM grows across the night" curve. */
const REM_WEIGHT = [1, 1.75, 2.3, 2.5, 2.45, 2.3, 2.2, 2.1];

// ---------------------------------------------------------------------------
// Hypnogram
// ---------------------------------------------------------------------------

interface Segment {
  stage: SleepStage;
  /** Length in epochs. */
  length: number;
  /** Cycle this segment belongs to, or -1 for latency/morning. */
  cycle: number;
}

/** Split `total` epochs into `n` cycles around `cycleMin` ± `jitterMin`, summing exactly. */
function planCycleLengths(rng: Rng, total: number, n: number, cycleMin: number, jitterMin: number): number[] {
  const lengths: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const jitter = rng.range(-jitterMin, jitterMin) * EPOCHS_PER_MIN;
    lengths.push(Math.max(40, Math.round(cycleMin * EPOCHS_PER_MIN + jitter)));
  }
  // Normalise so the cycles fill the sleep period exactly: the jitter then only
  // decides how the time is shared, never how long the night is.
  let sum = lengths.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum !== total && guard < 10000) {
    const step = sum < total ? 1 : -1;
    for (let i = 0; i < n && sum !== total; i += 1) {
      const next = (lengths[i] as number) + step;
      if (next < 40) continue;
      lengths[i] = next;
      sum += step;
    }
    guard += 1;
  }
  return lengths;
}

/**
 * Hand out the REM budget across cycles: increasing, first bout short, every bout
 * inside 15–40 min except the first (~7–13 min), and never so long that the cycle
 * has no NREM left.
 */
function planRemLengths(rng: Rng, budget: number, cycleLengths: number[]): number[] {
  const n = cycleLengths.length;
  const weights = cycleLengths.map((_, i) => {
    const base = REM_WEIGHT[Math.min(i, REM_WEIGHT.length - 1)] as number;
    return Math.max(0.5, base * (1 + rng.normal(0, 0.05)));
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const rem = weights.map((w) => Math.floor((budget * w) / weightSum));
  // Give the rounding remainder to the late cycles, where REM belongs anyway.
  let remainder = budget - rem.reduce((a, b) => a + b, 0);
  for (let i = n - 1; i >= 0 && remainder > 0; i -= 1) {
    rem[i] = (rem[i] as number) + 1;
    remainder -= 1;
  }

  const limits = cycleLengths.map((len, i) => {
    // Cycle 1 must leave ≥ 62 min of NREM in front of its REM bout, which is what
    // makes REM latency ≥ 60 min true by construction (oracle E5).
    const min = i === 0 ? 14 : 30;
    const max = i === 0 ? Math.min(26, len - 62 * EPOCHS_PER_MIN) : Math.min(80, len - 20 * EPOCHS_PER_MIN);
    return { min: Math.min(min, Math.max(0, max)), max: Math.max(0, max) };
  });

  // Clamp, then move the difference to cycles that still have slack so the total
  // REM time (and therefore the REM fraction of the night) stays what we budgeted.
  for (let i = 0; i < n; i += 1) {
    const lim = limits[i] as { min: number; max: number };
    rem[i] = clamp(rem[i] as number, lim.min, lim.max);
  }
  for (let pass = 0; pass < 6; pass += 1) {
    let delta = budget - rem.reduce((a, b) => a + b, 0);
    if (delta === 0) break;
    for (let k = 0; k < n && delta !== 0; k += 1) {
      // Prefer late cycles when adding, early ones when trimming.
      const i = delta > 0 ? n - 1 - k : k;
      const lim = limits[i] as { min: number; max: number };
      const room = delta > 0 ? lim.max - (rem[i] as number) : (rem[i] as number) - lim.min;
      if (room <= 0) continue;
      const move = Math.min(Math.abs(delta), room) * Math.sign(delta);
      rem[i] = (rem[i] as number) + move;
      delta -= move;
    }
  }
  return rem.map((r) => Math.round(r));
}

/** Build the ordered segment list of the whole record. */
function planSegments(rng: Rng, opts: Required<Pick<SimulateNightOptions, 'cycleMin' | 'cycleJitterMin'>> & {
  epochCount: number;
  latencyEpochs: number;
  morningEpochs: number;
  remBudget: number;
}): { segments: Segment[]; cycleLengths: number[]; remLengths: number[] } {
  const sleepEpochs = opts.epochCount - opts.latencyEpochs - opts.morningEpochs;
  const nCycles = clamp(Math.round(sleepEpochs / (opts.cycleMin * EPOCHS_PER_MIN)), 3, 8);
  const cycleLengths = planCycleLengths(rng, sleepEpochs, nCycles, opts.cycleMin, opts.cycleJitterMin);
  const remLengths = planRemLengths(rng, opts.remBudget, cycleLengths);

  const segments: Segment[] = [];

  // Falling asleep: a few epochs of N1, the rest N2 (DESIGN §5.1 FALLING_ASLEEP).
  const n1Latency = clamp(Math.round(opts.latencyEpochs / 3), 1, 8);
  segments.push({ stage: 'N1', length: n1Latency, cycle: -1 });
  segments.push({ stage: 'N2', length: opts.latencyEpochs - n1Latency, cycle: -1 });

  for (let i = 0; i < nCycles; i += 1) {
    const len = cycleLengths[i] as number;
    const rem = remLengths[i] as number;
    const nonRem = len - rem;
    const share = (N3_SHARE[Math.min(i, N3_SHARE.length - 1)] as number) * (1 + rng.normal(0, 0.08));
    let n3 = Math.round(clamp(share, 0, 0.6) * nonRem);
    if (nonRem - n3 < 4) n3 = Math.max(0, nonRem - 4);
    const n2 = nonRem - n3;
    // The descent into N3 is longer than the climb out of it.
    const n2a = n3 > 0 ? Math.max(2, Math.round(n2 * 0.6)) : n2;
    const n2b = n2 - n2a;

    if (n2a > 0) segments.push({ stage: 'N2', length: n2a, cycle: i });
    if (n3 > 0) segments.push({ stage: 'N3', length: n3, cycle: i });
    if (n2b > 0) segments.push({ stage: 'N2', length: n2b, cycle: i });
    if (rem > 0) segments.push({ stage: 'REM', length: rem, cycle: i });
  }

  if (opts.morningEpochs > 0) segments.push({ stage: 'WAKE', length: opts.morningEpochs, cycle: -1 });

  return { segments, cycleLengths, remLengths };
}

/**
 * Overwrite short windows of light sleep with WAKE, preferring the end of a REM
 * bout (where spontaneous awakenings really cluster) and the second half of the
 * night. Overwriting instead of inserting keeps the record exactly `durationMin`
 * long and leaves the REM budget untouched.
 */
function placeWakeBouts(
  rng: Rng,
  stages: SleepStage[],
  segments: Segment[],
  wakeCount: number,
  onsetIndex: number,
  morningEpochs: number,
): SimWakeBout[] {
  const bouts: SimWakeBout[] = [];
  if (wakeCount <= 0) return bouts;

  // Total WAKE (including the morning) stays under 10 % of the record, so a night
  // with many awakenings is still a night (oracle E4: WAKE ≤ 12 %).
  const wakeBudget = Math.max(0, Math.floor(stages.length * 0.1) - morningEpochs);
  const maxPerBout = Math.max(4, Math.floor(wakeBudget / wakeCount));

  // Candidate windows: start of a light-sleep segment, at least one hour after onset.
  interface Candidate { start: number; room: number; afterRem: boolean; cycle: number }
  const candidates: Candidate[] = [];
  let cursor = 0;
  for (let s = 0; s < segments.length; s += 1) {
    const seg = segments[s] as Segment;
    const prev = s > 0 ? (segments[s - 1] as Segment) : null;
    if (seg.stage === 'N2' || seg.stage === 'N1') {
      const start = cursor;
      if (start - onsetIndex >= 60 * EPOCHS_PER_MIN && start + 6 < stages.length - morningEpochs) {
        candidates.push({
          start,
          room: seg.length - 2,
          afterRem: prev?.stage === 'REM',
          cycle: seg.cycle,
        });
      }
    }
    cursor += seg.length;
  }

  // Post-REM windows first, latest cycles first; then anything else, shuffled.
  const preferred = candidates.filter((c) => c.afterRem).sort((a, b) => b.cycle - a.cycle);
  const rest = rng.shuffle(candidates.filter((c) => !c.afterRem));
  const ordered = [...preferred, ...rest].filter((c) => c.room >= 4);

  let spent = 0;
  for (const cand of ordered) {
    if (bouts.length >= wakeCount) break;
    const want = rng.int(4, 16);
    const length = Math.min(want, maxPerBout, cand.room, Math.max(0, wakeBudget - spent));
    if (length < 4) continue;
    for (let i = 0; i < length; i += 1) stages[cand.start + i] = 'WAKE';
    // Sleep is re-entered through N1, never straight back into N2/N3.
    for (let i = 0; i < 2; i += 1) {
      const at = cand.start + length + i;
      if (at < stages.length && stages[at] === 'N2') stages[at] = 'N1';
    }
    spent += length;
    bouts.push({ startT: cand.start, durationSec: length * EPOCH_SECONDS });
  }

  return bouts.sort((a, b) => a.startT - b.startT);
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

function simulateEpoch(
  rng: Rng,
  stage: SleepStage,
  t: number,
  progress: number,
  hrBaseline: number,
  batteryStart: number,
  batteryEnd: number,
  noise: number,
  dropoutRate: number,
): SensorEpoch {
  const battery = round(clamp(batteryStart + (batteryEnd - batteryStart) * progress, 0, 1), 2);

  if (dropoutRate > 0 && rng.bool(dropoutRate)) {
    // The watch was on the charger / off the wrist / unreachable: the epoch exists
    // (so the grid stays continuous) but carries nothing usable.
    return { t, hrMean: null, hrSd: null, motion: null, battery, source: 'WATCH' };
  }

  // Heart rate sags a little through the night on top of the stage offset.
  const drift = -1 * progress;
  const hrMean = round(
    clamp(
      hrBaseline + (HR_OFFSET[stage] as number) + drift + rng.normal(0, (HR_JITTER[stage] as number) * noise),
      HR_SAFE_MIN,
      HR_SAFE_MAX,
    ),
    1,
  );

  // REM heart rate is not just faster, it is *erratic* — that irregularity is the
  // single most useful wrist-visible REM signal (DESIGN §5.2, evidence "HR").
  const sdTarget = stage === 'REM' ? rng.range(4, 6) : (HR_SD[stage] as number);
  const hrSd = round(clamp(sdTarget + rng.normal(0, 0.3 * noise), 0.1, 60), 2);

  const twitch = TWITCH[stage] as { p: number; min: number; max: number };
  let motion = (MOTION_BASE[stage] as number) * (1 + rng.normal(0, 0.25 * noise));
  if (stage === 'WAKE') motion = rng.range(0.2, 0.6) + rng.normal(0, 0.05 * noise);
  else if (twitch.p > 0 && rng.bool(twitch.p)) motion += rng.range(twitch.min, twitch.max);

  return {
    t,
    hrMean,
    hrSd,
    motion: round(clamp(motion, 0.0005, 3), 4),
    battery,
    source: 'WATCH',
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate one night: sensor epochs on a gap-free 30 s grid plus the stage answer key.
 *
 * ```ts
 * const night = simulateNight({ seed: 42, sleepAtIso: '2026-09-24T16:00:00.000Z' });
 * night.epochs.length;              // 960 (8 h)
 * night.truth[0].stage;             // 'N1' — still falling asleep
 * night.onsetT;                     // sleep onset, epoch seconds
 * ```
 */
export function simulateNight(opts: SimulateNightOptions): SimulatedNight {
  const durationMin = opts.durationMin ?? 480;
  if (!Number.isFinite(durationMin) || durationMin < MIN_DURATION_MIN) {
    throw new Error(`simulateNight: durationMin must be ≥ ${MIN_DURATION_MIN}, got ${String(opts.durationMin)}`);
  }
  const startMs = Date.parse(opts.sleepAtIso);
  if (Number.isNaN(startMs)) throw new Error(`simulateNight: cannot parse sleepAtIso "${opts.sleepAtIso}"`);

  const cycleMin = opts.cycleMin ?? 90;
  const cycleJitterMin = opts.cycleJitterMin ?? 10;
  const wakeCount = Math.max(0, Math.round(opts.wakeCount ?? 2));
  const noise = Math.max(0, opts.noise ?? 1);
  const dropoutRate = clamp(opts.dropoutRate ?? 0, 0, 1);

  const rng = mulberry32(opts.seed);
  const startT = epochIndexOf(startMs);
  const epochCount = Math.round(durationMin * EPOCHS_PER_MIN);

  const latencyMinRaw = opts.latencyMin ?? rng.range(5, 25);
  const latencyEpochs = clamp(Math.round(latencyMinRaw * EPOCHS_PER_MIN), 4, 60);
  const morningEpochs = clamp(Math.round(rng.range(3, 8) * EPOCHS_PER_MIN), 4, 40);
  const remFraction = clamp(opts.remFraction ?? rng.range(0.205, 0.245), 0.1, 0.34);
  const remBudget = Math.round(remFraction * epochCount);

  const { segments, cycleLengths, remLengths } = planSegments(rng, {
    cycleMin,
    cycleJitterMin,
    epochCount,
    latencyEpochs,
    morningEpochs,
    remBudget,
  });

  // Flatten to one stage per epoch.
  const stages: SleepStage[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 1) stages.push(seg.stage);
  }
  // Defensive: the segment plan must fill the record exactly.
  while (stages.length < epochCount) stages.push('N2');
  stages.length = epochCount;

  // A sleeper drifts through N1 on the way into REM as well.
  let walk = 0;
  for (const seg of segments) {
    if (seg.stage === 'REM' && walk > 0 && stages[walk - 1] === 'N2') stages[walk - 1] = 'N1';
    walk += seg.length;
  }

  const onsetIndex = latencyEpochs;
  const wakeBoutIndices = placeWakeBouts(rng, stages, segments, wakeCount, onsetIndex, morningEpochs);

  // Cycle plan in absolute time, for later oracles and for the report screens.
  const cycles: SimCyclePlan[] = [];
  {
    let cursor = latencyEpochs;
    for (let i = 0; i < cycleLengths.length; i += 1) {
      const len = cycleLengths[i] as number;
      const rem = remLengths[i] as number;
      const n3 = segments.filter((s) => s.cycle === i && s.stage === 'N3').reduce((a, s) => a + s.length, 0);
      cycles.push({
        index: i,
        startT: startT + cursor * EPOCH_SECONDS,
        durationSec: len * EPOCH_SECONDS,
        n3Sec: n3 * EPOCH_SECONDS,
        remStartT: rem > 0 ? startT + (cursor + len - rem) * EPOCH_SECONDS : null,
        remSec: rem * EPOCH_SECONDS,
      });
      cursor += len;
    }
  }

  const hrBaseline = round(clamp(rng.normal(58, 3.5), 48, 70), 1);
  const batteryStart = round(clamp(rng.range(0.86, 0.93), 0, 1), 2);
  const batteryEnd = round(clamp(batteryStart - rng.range(0.26, 0.33), 0, 1), 2);

  const epochs: SensorEpoch[] = [];
  const truth: StageSample[] = [];
  for (let i = 0; i < epochCount; i += 1) {
    const t = startT + i * EPOCH_SECONDS;
    const stage = stages[i] as SleepStage;
    truth.push({ t, stage });
    epochs.push(
      simulateEpoch(
        rng,
        stage,
        t,
        epochCount > 1 ? i / (epochCount - 1) : 0,
        hrBaseline,
        batteryStart,
        batteryEnd,
        noise,
        dropoutRate,
      ),
    );
  }

  return {
    epochs,
    truth,
    onsetT: startT + onsetIndex * EPOCH_SECONDS,
    params: {
      seed: opts.seed,
      sleepAtIso: opts.sleepAtIso,
      startT,
      durationMin,
      epochCount,
      epochSeconds: EPOCH_SECONDS,
      cycleMin,
      cycleJitterMin,
      wakeCount,
      noise,
      dropoutRate,
      latencyMin: round(latencyEpochs / EPOCHS_PER_MIN, 2),
      remFraction: round(remBudget / epochCount, 4),
      hrBaseline,
      morningWakeMin: round(morningEpochs / EPOCHS_PER_MIN, 2),
      cycles,
      wakeBouts: wakeBoutIndices.map((b) => ({
        startT: startT + b.startT * EPOCH_SECONDS,
        durationSec: b.durationSec,
      })),
    },
  };
}

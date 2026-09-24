/**
 * `remEstimator.ts` — L2.5: `p_REM` per 30 s epoch (DESIGN-APP §5.2 · APP-RUN §2 "L2.5").
 *
 * Four pieces of evidence, combined in **log-odds** exactly as §5.2 tabulates them, with
 * the starting weights from that table (1.0 / 1.2 / 0.8 / 0.6) and a fifth slot already
 * wired for a future EOG mask (weight 2.5, feature 0 until a mask exists):
 *
 * | evidence | signal | REM looks like | weight |
 * |---|---|---|---|
 * | `prior`     | minutes since onset · phase inside the ~90 min cycle · how far the night got | almost never < 60 min, more every cycle, most of it in the second half | 1.0 |
 * | `hrRel`     | 5 min mean heart rate against **this night's** running baseline | a little above deep sleep | 1.2 |
 * | `hrSdRel`   | within-epoch heart-rate variability against the same baseline | **markedly irregular** — the single most useful wrist signal | 1.2 |
 * | `motionLow` | acceleration energy over the last 2 min | **almost motionless** (atonia), short twitches allowed | 0.8 |
 * | `hist`      | the user's own REM histogram by half-hour of the day (from Apple stages, L2.9) | personal | 0.6 |
 *
 * ## Three properties that matter more than the numbers
 *
 * 1. **Causal.** Every baseline is "the night *so far*" (a running median, never the whole
 *    night), so `feed()` on a live night and `estimateNight()` in the morning return
 *    bit-identical probabilities (oracle Q5). Nothing here looks ahead.
 * 2. **Every feature is signed and centred**, and a missing signal is exactly `0`
 *    ("no opinion"), never a guess. That is what makes a dropped watch degrade into the
 *    time prior alone (oracle Q4) instead of into noise, and it is why the weights can be
 *    clamped to `[0, 5]`: the *sign* lives in the feature, the *strength* in the weight.
 * 3. **The prior is a real log-odds of REM given time**, therefore negative everywhere
 *    (REM is at most ~40 % of any half hour) and very negative in the first hour after
 *    onset. This is the term that keeps the Sleep Guard hour quiet (oracle Q2).
 *
 * ## Warning about the numbers in `ledger/wo-notes/L2.4-2.5.md`
 * The F1 reported there is measured on `simulateNight`, whose `hrSd` gap between REM (4–6)
 * and N3 (~1) is **wider than a real watch will show** (`wo-notes/L2.1.md` debt 2). Treat
 * the tuned constants as a starting point to be re-fitted against real Apple stages at R2,
 * not as a validated model.
 */

import { EPOCH_SECONDS } from './clock';
import { type SensorEpoch } from './diagnostics';
import { clamp } from './rng';
import { type PRemSample, type StageSample } from './types';

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/** One weight per evidence term, plus the intercept. All are kept inside `[0, 5]`. */
export interface RemWeights {
  /** Time prior (DESIGN §5.2 = 1.0). */
  prior: number;
  /** Heart-rate level against the night's baseline (= 1.2). */
  hr: number;
  /** Heart-rate variability against the night's baseline (= 1.2). */
  hrSd: number;
  /** Stillness / recent movement (= 0.8). */
  motion: number;
  /** Personal histogram (= 0.6 — has no effect until a histogram exists). */
  hist: number;
  /** Future EOG mask (= 2.5 — has no effect until a mask exists). */
  eog: number;
  /** Intercept. Small on purpose: the base rate of REM lives in `prior`. */
  bias: number;
}

/** Starting weights straight from the DESIGN §5.2 table. */
export const DEFAULT_REM_WEIGHTS: RemWeights = {
  prior: 1.0,
  hr: 1.2,
  hrSd: 1.2,
  motion: 0.8,
  hist: 0.6,
  eog: 2.5,
  bias: 0.25,
};

/** Rails for every weight, including the intercept (oracle Q6). */
export const REM_WEIGHT_MIN = 0;
export const REM_WEIGHT_MAX = 5;

/** Nights of scored truth (Apple stages) needed before personal weights may move (§5.2). */
export const REM_PERSONAL_MIN_NIGHTS = 7;

/** Personal weights only start moving once Apple has scored enough nights. */
export function canUpdatePersonalWeights(nightsWithTruth: number): boolean {
  return Number.isFinite(nightsWithTruth) && nightsWithTruth >= REM_PERSONAL_MIN_NIGHTS;
}

// ---------------------------------------------------------------------------
// Tuning (shapes of the features · re-fit at R2 against real nights)
// ---------------------------------------------------------------------------

export interface RemTuning {
  /** Log-odds of REM during the first `coldMin` minutes after onset. */
  priorCold: number;
  /** REM latency floor, minutes — before this, `prior` = `priorCold` (DESIGN §5.2). */
  coldMin: number;
  /** Minutes over which `prior` blends from `priorCold` into the warm curve. */
  warmRampMin: number;
  /** Base log-odds of REM once past `coldMin`. */
  priorBase: number;
  /** Amplitude of the ~90 min cycle bump. */
  priorCycleAmp: number;
  /** Where in the cycle the bump peaks, 0..1 (REM sits at the end of a cycle). */
  priorCyclePeak: number;
  /** Cycle length in minutes. */
  cycleMin: number;
  /** How fast the cycle bump flattens out with cycle number (jitter accumulates). */
  priorCycleDecay: number;
  /** Amplitude of the "second half of the night" trend. */
  priorTrendAmp: number;
  /** Epochs averaged into the heart-rate level (10 = the 5 min of §5.2). */
  hrWindowEpochs: number;
  /** Epochs averaged into the variability. */
  hrSdWindowEpochs: number;
  /** Rails of `hrRel` — the upper rail is what stops WAKE from looking like REM. */
  hrRelMin: number;
  hrRelMax: number;
  /** Rails of `hrSdRel`. */
  hrSdRelMin: number;
  hrSdRelMax: number;
  /** Motion (g) at or below which an epoch counts as still. */
  motionQuiet: number;
  /** Motion (g) above which an epoch counts as a real movement, not a twitch. */
  motionMove: number;
  /** Motion (g) that is awake-sized: one such epoch is enough to apply the penalty. */
  motionWakeLevel: number;
  /** Epochs of the motion window (4 = the 2 min of DESIGN §5.3). */
  motionWindowEpochs: number;
  /** Movement epochs inside that window before the sleeper is treated as moving. */
  motionMoveEpochs: number;
  /** Value of `motionLow` when perfectly still. */
  motionQuietValue: number;
  /** Value of `motionLow` when moving — a penalty big enough to veto a cue. */
  motionMovePenalty: number;
  /** Rails of the personal-histogram term. */
  histClamp: number;
  /** Learning rate of {@link updateWeights}. */
  learningRate: number;
  /** Passes over one night in {@link updateWeights}. */
  updatePasses: number;
  /** Maximum a single weight may move in one call to {@link updateWeights}. */
  maxWeightStep: number;
  /** Decision threshold the update must not spoil (DESIGN §5.1 `REM_LIKELY` = 0.70). */
  decisionThreshold: number;
  /** How much F1 on the learning night may drop before the update is thrown away. */
  updateF1Guard: number;
}

/**
 * Constants fitted on 200 simulated nights (see `ledger/wo-notes/L2.4-2.5.md` §3 for the
 * sweep and §6 debt 1 for why they must be re-fitted on real nights).
 */
export const DEFAULT_REM_TUNING: RemTuning = {
  priorCold: -3.2,
  coldMin: 60,
  warmRampMin: 10,
  priorBase: -1.9,
  priorCycleAmp: 0.55,
  priorCyclePeak: 0.92,
  cycleMin: 90,
  priorCycleDecay: 0.35,
  priorTrendAmp: 0.75,
  hrWindowEpochs: 10,
  hrSdWindowEpochs: 3,
  hrRelMin: -3,
  hrRelMax: 1.0,
  hrSdRelMin: -2,
  hrSdRelMax: 3,
  motionQuiet: 0.02,
  motionMove: 0.06,
  motionWakeLevel: 0.15,
  motionWindowEpochs: 4,
  motionMoveEpochs: 2,
  motionQuietValue: 0.5,
  motionMovePenalty: -5,
  histClamp: 2,
  learningRate: 0.02,
  updatePasses: 2,
  maxWeightStep: 0.05,
  decisionThreshold: 0.7,
  updateF1Guard: 0.002,
};

/** Half-hour buckets in a day — the shape of a personal histogram. */
export const REM_HISTOGRAM_BUCKETS = 48;

/** A flat histogram: what a user has before Apple has scored a single night. */
export function flatRemHistogram(): number[] {
  return new Array(REM_HISTOGRAM_BUCKETS).fill(1);
}

/** Which half-hour bucket (UTC) an epoch belongs to, 0..47. */
export function histogramBucket(t: number): number {
  const date = new Date(t * 1000);
  const bucket = date.getUTCHours() * 2 + (date.getUTCMinutes() >= 30 ? 1 : 0);
  return clamp(Math.floor(bucket), 0, REM_HISTOGRAM_BUCKETS - 1);
}

// ---------------------------------------------------------------------------
// Context and features
// ---------------------------------------------------------------------------

export interface RemContext {
  /** Sleep onset from L2.4, or `null` while the sleeper is still awake. */
  onsetT: number | null;
  /** First epoch of the record. */
  nightStartT: number;
  /** When the night is expected to end (alarm / usual wake time). */
  expectedEndT: number;
}

/** The five (plus EOG) evidence terms. Signed, centred on "no opinion" = `0`, never `NaN`. */
export interface RemFeatures {
  prior: number;
  hrRel: number;
  hrSdRel: number;
  motionLow: number;
  hist: number;
  /** Future 5th evidence (EOG mask). `0` whenever no mask is connected. */
  eog: number;
}

/** Rolling, causal state of one night. Created by {@link createRemWindow}. */
export interface RemWindow {
  /** The last few epochs, oldest first — long enough for every window in the tuning. */
  recent: SensorEpoch[];
  /** Every `hrMean` of the night so far, ascending (for the running median). */
  hrSorted: number[];
  /** Every `hrSd` of the night so far, ascending. */
  hrSdSorted: number[];
  /** Personal histogram, or `null` for "no personal data yet". */
  histogram: readonly number[] | null;
  /** Normalising mean of {@link histogram}, cached. */
  histogramMean: number;
  tuning: RemTuning;
}

export function createRemWindow(tuning: RemTuning = DEFAULT_REM_TUNING, histogram?: readonly number[] | null): RemWindow {
  const usable =
    histogram && histogram.length === REM_HISTOGRAM_BUCKETS && histogram.some((v) => Number.isFinite(v) && v > 0)
      ? histogram
      : null;
  const mean = usable
    ? usable.reduce((a, v) => a + (Number.isFinite(v) ? Math.max(0, v) : 0), 0) / REM_HISTOGRAM_BUCKETS
    : 0;
  return { recent: [], hrSorted: [], hrSdSorted: [], histogram: usable, histogramMean: mean, tuning };
}

/** Insert into an ascending array (binary search) — keeps the running median cheap. */
function sortedInsert(array: number[], value: number): void {
  let lo = 0;
  let hi = array.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((array[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  array.splice(lo, 0, value);
}

/** Quantile of an ascending array, `0` when empty. */
function quantile(array: readonly number[], q: number): number {
  if (array.length === 0) return 0;
  const index = clamp(Math.floor(q * (array.length - 1)), 0, array.length - 1);
  return array[index] as number;
}

function value(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Push one epoch into the window. Must be called **before** {@link remFeatures} for that
 * same epoch: every baseline includes the current epoch and nothing after it.
 */
export function pushRemWindow(window: RemWindow, epoch: SensorEpoch): RemWindow {
  const keep = Math.max(
    window.tuning.hrWindowEpochs,
    window.tuning.hrSdWindowEpochs,
    window.tuning.motionWindowEpochs,
    1,
  );
  window.recent.push(epoch);
  if (window.recent.length > keep) window.recent.shift();

  const hr = value(epoch.hrMean);
  if (hr != null) sortedInsert(window.hrSorted, hr);
  const hrSd = value(epoch.hrSd);
  if (hrSd != null) sortedInsert(window.hrSdSorted, hrSd);
  return window;
}

/** Mean of the last `n` readable values of one field inside the window, or `null`. */
function trailingMean(window: RemWindow, n: number, pick: (e: SensorEpoch) => number | null | undefined): number | null {
  const slice = window.recent.slice(Math.max(0, window.recent.length - Math.max(1, n)));
  let sum = 0;
  let count = 0;
  for (const epoch of slice) {
    const v = value(pick(epoch));
    if (v == null) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/**
 * Log-odds of REM given *time alone* — the only term left when the watch is gone.
 *
 * Shape (DESIGN §5.2 "Prior เวลา"): flat and very low for the first hour after onset
 * (REM latency is ≥ 60 min in every healthy adult night), then a base level plus a bump at
 * the end of each ~90 min cycle (flattening as the cycle jitter accumulates) plus a steady
 * rise through the night (REM bouts grow).
 */
export function remTimePrior(
  t: number,
  ctx: RemContext,
  tuning: RemTuning = DEFAULT_REM_TUNING,
): number {
  const onsetRef = ctx.onsetT ?? ctx.nightStartT + 900;
  const minutes = (t - onsetRef) / 60;
  if (!Number.isFinite(minutes) || minutes < tuning.coldMin) return tuning.priorCold;

  const span = Math.max(3600, ctx.expectedEndT - onsetRef);
  const frac = clamp((t - onsetRef) / span, 0, 1);

  const cycle = Math.max(30, tuning.cycleMin);
  const phase = ((minutes % cycle) + cycle) % cycle / cycle;
  const bump = 0.5 * (1 + Math.cos(2 * Math.PI * (phase - tuning.priorCyclePeak)));
  const cycleIndex = Math.floor(minutes / cycle);
  const amp = tuning.priorCycleAmp / (1 + tuning.priorCycleDecay * Math.max(0, cycleIndex - 1));

  const warm = tuning.priorBase + amp * bump + tuning.priorTrendAmp * frac;

  // Short blend out of the cold hour so `p` cannot jump on a single epoch.
  const ramp = Math.max(0, tuning.warmRampMin);
  if (ramp > 0 && minutes < tuning.coldMin + ramp) {
    const k = (minutes - tuning.coldMin) / ramp;
    return tuning.priorCold + (warm - tuning.priorCold) * k;
  }
  return warm;
}

/**
 * The evidence vector for one epoch. `window` must already contain this epoch
 * ({@link pushRemWindow}). Never returns `NaN`: a missing signal is `0`.
 */
export function remFeatures(epoch: SensorEpoch, ctx: RemContext, window: RemWindow): RemFeatures {
  const tuning = window.tuning;
  const prior = remTimePrior(epoch.t, ctx, tuning);

  // --- heart rate level, against the night's running median -----------------
  let hrRel = 0;
  const hrMean = trailingMean(window, tuning.hrWindowEpochs, (e) => e.hrMean);
  if (hrMean != null && window.hrSorted.length >= 2) {
    const median = quantile(window.hrSorted, 0.5);
    // Robust spread of the night so far (IQR → sd), railed so one flat hour cannot
    // turn a 1 bpm wobble into strong evidence.
    const iqr = quantile(window.hrSorted, 0.75) - quantile(window.hrSorted, 0.25);
    const scale = clamp(iqr / 1.349, 1.2, 8);
    hrRel = clamp((hrMean - median) / scale, tuning.hrRelMin, tuning.hrRelMax);
  }

  // --- heart-rate variability, relative to the night's median ---------------
  let hrSdRel = 0;
  const hrSdMean = trailingMean(window, tuning.hrSdWindowEpochs, (e) => e.hrSd);
  if (hrSdMean != null && window.hrSdSorted.length >= 2) {
    const median = quantile(window.hrSdSorted, 0.5);
    hrSdRel = clamp((hrSdMean - median) / Math.max(0.5, median), tuning.hrSdRelMin, tuning.hrSdRelMax);
  }

  // --- stillness (atonia) and the movement penalty --------------------------
  let motionLow = 0;
  const motionSlice = window.recent.slice(Math.max(0, window.recent.length - Math.max(1, tuning.motionWindowEpochs)));
  const motions = motionSlice.map((e) => value(e.motion)).filter((v): v is number => v != null);
  if (motions.length > 0) {
    const moving = motions.filter((m) => m > tuning.motionMove).length;
    const awake = motions.some((m) => m > tuning.motionWakeLevel);
    const mean = motions.reduce((a, m) => a + m, 0) / motions.length;
    // One awake-sized swing is enough; a twitch needs company before it counts as moving
    // (REM does twitch — DESIGN §5.2 "นิ่งมาก แต่ขยับสั้นก่อน/หลังช่วง").
    if (awake || moving >= tuning.motionMoveEpochs) motionLow = tuning.motionMovePenalty;
    else if (mean <= tuning.motionQuiet) motionLow = tuning.motionQuietValue;
    else motionLow = 0; // a single twitch: REM does that, it is not evidence either way
  }

  // --- personal histogram ---------------------------------------------------
  let hist = 0;
  if (window.histogram && window.histogramMean > 0) {
    const raw = window.histogram[histogramBucket(epoch.t)];
    const share = Number.isFinite(raw) ? Math.max(0, raw as number) : 0;
    const eps = 0.02 * window.histogramMean;
    hist = clamp(Math.log((share + eps) / (window.histogramMean + eps)), -tuning.histClamp, tuning.histClamp);
  }

  return {
    prior: Number.isFinite(prior) ? prior : 0,
    hrRel: Number.isFinite(hrRel) ? hrRel : 0,
    hrSdRel: Number.isFinite(hrSdRel) ? hrSdRel : 0,
    motionLow: Number.isFinite(motionLow) ? motionLow : 0,
    hist: Number.isFinite(hist) ? hist : 0,
    eog: 0,
  };
}

/** Logistic function, guarded against overflow so `p` is always inside `[0, 1]`. */
export function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x >= 40) return 1;
  if (x <= -40) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** Combine features and weights into `p_REM` — the one place the log-odds sum lives. */
export function remProbability(features: RemFeatures, weights: RemWeights): number {
  const logOdds =
    weights.bias +
    weights.prior * features.prior +
    weights.hr * features.hrRel +
    weights.hrSd * features.hrSdRel +
    weights.motion * features.motionLow +
    weights.hist * features.hist +
    weights.eog * (features.eog ?? 0);
  return clamp(sigmoid(logOdds), 0, 1);
}

// ---------------------------------------------------------------------------
// Estimator
// ---------------------------------------------------------------------------

export interface RemEstimatorOptions {
  weights?: Partial<RemWeights>;
  /** 48 half-hour buckets of "how often Apple scored REM here for this user". */
  personalHistogram?: readonly number[] | null;
  tuning?: Partial<RemTuning>;
}

export interface RemEstimator {
  /** One epoch in, `p_REM` out. Causal: only this epoch and the ones before it. */
  feed(epoch: SensorEpoch, ctx: RemContext): number;
  /** Same call, but also handing back the evidence (for the report screens and L2.9). */
  feedDetailed(epoch: SensorEpoch, ctx: RemContext): { p: number; features: RemFeatures };
  readonly weights: RemWeights;
  readonly tuning: RemTuning;
}

function resolveWeights(partial?: Partial<RemWeights>): RemWeights {
  const merged = { ...DEFAULT_REM_WEIGHTS, ...(partial ?? {}) };
  const fix = (v: number, fallback: number): number =>
    clamp(Number.isFinite(v) ? v : fallback, REM_WEIGHT_MIN, REM_WEIGHT_MAX);
  return {
    prior: fix(merged.prior, DEFAULT_REM_WEIGHTS.prior),
    hr: fix(merged.hr, DEFAULT_REM_WEIGHTS.hr),
    hrSd: fix(merged.hrSd, DEFAULT_REM_WEIGHTS.hrSd),
    motion: fix(merged.motion, DEFAULT_REM_WEIGHTS.motion),
    hist: fix(merged.hist, DEFAULT_REM_WEIGHTS.hist),
    eog: fix(merged.eog, DEFAULT_REM_WEIGHTS.eog),
    bias: fix(merged.bias, DEFAULT_REM_WEIGHTS.bias),
  };
}

function resolveTuning(partial?: Partial<RemTuning>): RemTuning {
  return { ...DEFAULT_REM_TUNING, ...(partial ?? {}) };
}

/**
 * One estimator per night.
 *
 * ```ts
 * const est = createRemEstimator({ personalHistogram });
 * const ctx = { onsetT, nightStartT, expectedEndT };
 * for (const epoch of epochs) p = est.feed(epoch, ctx);
 * ```
 */
export function createRemEstimator(options: RemEstimatorOptions = {}): RemEstimator {
  const weights = resolveWeights(options.weights);
  const tuning = resolveTuning(options.tuning);
  const window = createRemWindow(tuning, options.personalHistogram ?? null);

  const step = (epoch: SensorEpoch, ctx: RemContext): { p: number; features: RemFeatures } => {
    pushRemWindow(window, epoch);
    const features = remFeatures(epoch, ctx, window);
    return { p: remProbability(features, weights), features };
  };

  return {
    feed: (epoch, ctx) => step(epoch, ctx).p,
    feedDetailed: step,
    get weights() {
      return { ...weights };
    },
    get tuning() {
      return { ...tuning };
    },
  };
}

export interface EstimateNightOptions extends RemEstimatorOptions {
  /** Overrides the end of the night; defaults to the last epoch of the record. */
  expectedEndT?: number;
}

/**
 * Score a whole record. Identical, epoch by epoch, to streaming the same epochs through
 * {@link createRemEstimator} (oracle Q5) — the morning report and the live night can never
 * tell two different stories.
 */
export function estimateNight(
  epochs: readonly SensorEpoch[],
  onsetT: number | null,
  options: EstimateNightOptions = {},
): PRemSample[] {
  if (!Array.isArray(epochs) || epochs.length === 0) return [];
  const estimator = createRemEstimator(options);
  const ctx: RemContext = {
    onsetT: onsetT ?? null,
    nightStartT: (epochs[0] as SensorEpoch).t,
    expectedEndT: options.expectedEndT ?? (epochs[epochs.length - 1] as SensorEpoch).t,
  };
  return epochs.map((epoch) => ({ t: epoch.t, p: estimator.feed(epoch, ctx) }));
}

/** Features of a whole record, in order — used by {@link updateWeights} and by L2.9. */
export function nightFeatures(
  epochs: readonly SensorEpoch[],
  onsetT: number | null,
  options: RemEstimatorOptions & { expectedEndT?: number } = {},
): { t: number; features: RemFeatures }[] {
  if (!Array.isArray(epochs) || epochs.length === 0) return [];
  const tuning = resolveTuning(options.tuning);
  const window = createRemWindow(tuning, options.personalHistogram ?? null);
  const ctx: RemContext = {
    onsetT: onsetT ?? null,
    nightStartT: (epochs[0] as SensorEpoch).t,
    expectedEndT: options.expectedEndT ?? (epochs[epochs.length - 1] as SensorEpoch).t,
  };
  return epochs.map((epoch) => {
    pushRemWindow(window, epoch);
    return { t: epoch.t, features: remFeatures(epoch, ctx, window) };
  });
}

// ---------------------------------------------------------------------------
// Personal weights (online logistic, small steps, clamped)
// ---------------------------------------------------------------------------

export interface UpdateWeightsInput extends RemEstimatorOptions {
  /** The night's sensor epochs — without them there are no features and nothing to learn. */
  epochs?: readonly SensorEpoch[];
  onsetT?: number | null;
  expectedEndT?: number;
  /** Overrides {@link RemTuning.learningRate} for this call. */
  learningRate?: number;
}

/**
 * One night of online logistic regression on the personal weights (DESIGN §5.2
 * "ปรับน้ำหนักบุคคล · online logistic update ขั้นเล็ก").
 *
 * Deliberately timid, in this order:
 *   • a *mean* gradient over the night (not per-epoch SGD), so one loud epoch cannot move
 *     anything;
 *   • {@link RemTuning.updatePasses} passes at {@link RemTuning.learningRate};
 *   • the total move of any single weight is capped at {@link RemTuning.maxWeightStep} per
 *     night, so a mis-scored night costs at most that much;
 *   • everything clamped into `[0, 5]`, intercept included.
 *
 * Deterministic: no shuffling, no clock, same inputs → same weights. Returns the weights
 * unchanged when it is handed no epochs (then it has no features to learn from) or no REM
 * in the truth (a night Apple scored as REM-less teaches nothing).
 *
 * The "≥ 7 nights" gate of §5.2 belongs to the caller (L2.9) — see
 * {@link canUpdatePersonalWeights}.
 */
export function updateWeights(
  weights: RemWeights,
  truth: readonly StageSample[],
  pRemSamples: readonly PRemSample[],
  input: UpdateWeightsInput = {},
): RemWeights {
  const current = resolveWeights(weights);
  const tuning = resolveTuning(input.tuning);
  const epochs = input.epochs;
  if (!Array.isArray(truth) || truth.length === 0) return current;
  if (!epochs || epochs.length === 0) return current;

  const labels = new Map<number, number>();
  let remCount = 0;
  for (const sample of truth) {
    const y = sample.stage === 'REM' ? 1 : 0;
    labels.set(sample.t, y);
    remCount += y;
  }
  if (remCount === 0) return current;

  // `onsetT` comes from the caller; fall back to the first probability sample's night.
  const onsetT = input.onsetT ?? null;
  const rows = nightFeatures(epochs, onsetT, {
    personalHistogram: input.personalHistogram ?? null,
    tuning: input.tuning,
    expectedEndT: input.expectedEndT,
  }).filter((row) => labels.has(row.t));
  if (rows.length === 0) return current;

  // `pRemSamples` are the probabilities the night was actually scored with. They are not
  // needed for the gradient (it is recomputed from the live weights each pass) but an
  // empty array means "this night was never scored" — nothing to learn from.
  if (!Array.isArray(pRemSamples) || pRemSamples.length === 0) return current;

  const lr = Math.max(0, input.learningRate ?? tuning.learningRate);
  const passes = Math.max(1, Math.round(tuning.updatePasses));
  const next: RemWeights = { ...current };

  for (let pass = 0; pass < passes; pass += 1) {
    const grad = { prior: 0, hr: 0, hrSd: 0, motion: 0, hist: 0, eog: 0, bias: 0 };
    for (const row of rows) {
      const y = labels.get(row.t) as number;
      const error = remProbability(row.features, next) - y;
      grad.prior += error * row.features.prior;
      grad.hr += error * row.features.hrRel;
      grad.hrSd += error * row.features.hrSdRel;
      grad.motion += error * row.features.motionLow;
      grad.hist += error * row.features.hist;
      grad.eog += error * (row.features.eog ?? 0);
      grad.bias += error;
    }
    const n = rows.length;
    for (const key of Object.keys(grad) as (keyof RemWeights)[]) {
      next[key] = next[key] - (lr * (grad[key] as number)) / n;
    }
  }

  const cap = Math.max(0, tuning.maxWeightStep);
  const out = {} as RemWeights;
  for (const key of Object.keys(current) as (keyof RemWeights)[]) {
    const delta = clamp(next[key] - current[key], -cap, cap);
    out[key] = clamp(current[key] + delta, REM_WEIGHT_MIN, REM_WEIGHT_MAX);
  }

  // The gradient minimises log-loss, but the app decides at a *threshold* (0.70). Those two
  // are not the same thing: a run of log-loss-improving updates can quietly squeeze every
  // probability below 0.70 and the night goes silent (measured: 60 updates from deliberately
  // bad weights → log-loss 0.78 → 0.31 while F1 fell 0.86 → 0.15). So an update that makes
  // the very night it learned from worse *at the threshold* is thrown away.
  const before = f1AtThreshold(rows, labels, current, tuning.decisionThreshold);
  const after = f1AtThreshold(rows, labels, out, tuning.decisionThreshold);
  if (after < before - Math.max(0, tuning.updateF1Guard)) return current;
  return out;
}

/** F1 of one night at a decision threshold, computed straight from features + weights. */
function f1AtThreshold(
  rows: readonly { t: number; features: RemFeatures }[],
  labels: ReadonlyMap<number, number>,
  weights: RemWeights,
  threshold: number,
): number {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of rows) {
    const y = labels.get(row.t) === 1;
    const predicted = remProbability(row.features, weights) >= threshold;
    if (predicted && y) tp += 1;
    else if (predicted && !y) fp += 1;
    else if (!predicted && y) fn += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

/** Epoch length, re-exported so callers of this module need not import `clock.ts` too. */
export const REM_EPOCH_SECONDS = EPOCH_SECONDS;

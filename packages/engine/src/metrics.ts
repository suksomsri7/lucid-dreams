/**
 * Grading the REM estimator (DESIGN §5.2 "ตอนเช้า … precision/recall ต่อคืน").
 *
 * The same arithmetic serves three callers, so it lives here once:
 *   • the L2.1/L2.5 oracles, against the simulator's answer key;
 *   • L2.9, against Apple's `asleepREM` stages of a real night;
 *   • the stats screen, which shows the user "ทายตรง 71%".
 *
 * Rules that matter more than the formulas:
 *   • an epoch is compared **only** to the answer with the identical `t` — a
 *     probability sample with no matching truth is ignored, never counted as a
 *     false positive (a missing answer is not a mistake);
 *   • every ratio is `0` when its denominator is `0`. A night with no REM at all
 *     must show "0%", not `NaN`, or the report screen renders "NaN%" to the user.
 */

import { type PRemSample, type SleepStage, type StageSample } from './types';

export interface RemMetrics {
  /** Epochs where truth = REM and `p ≥ threshold`. */
  tp: number;
  /** Epochs where truth ≠ REM but `p ≥ threshold` — a cue would have fired wrongly. */
  fp: number;
  /** Epochs where truth = REM but `p < threshold` — a missed REM window. */
  fn: number;
  /** `tp / (tp + fp)`, 0 when nothing was predicted. */
  precision: number;
  /** `tp / (tp + fn)`, 0 when the night contains no scored REM. */
  recall: number;
  /** Harmonic mean of precision and recall, 0 when both are 0. */
  f1: number;
}

const ZERO: RemMetrics = { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 };

/** Divide, but answer `0` instead of `NaN`/`Infinity`. */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Confusion counts of "is this epoch REM?" at a decision threshold.
 *
 * `threshold` defaults to 0.70 — the same number the cue controller uses to enter
 * `REM_LIKELY` (DESIGN §5.1), so the score always describes the decision the app
 * would really have made.
 */
export function remMetrics(
  truth: readonly StageSample[],
  pRem: readonly PRemSample[],
  threshold = 0.7,
): RemMetrics {
  if (!Array.isArray(truth) || truth.length === 0 || !Array.isArray(pRem) || pRem.length === 0) {
    return { ...ZERO };
  }

  const stageByT = new Map<number, SleepStage>();
  for (const sample of truth) stageByT.set(sample.t, sample.stage);

  // A re-sent probability for the same epoch replaces the earlier one, exactly as
  // `normalizeEpochs` does for sensor rows, so a duplicate cannot be counted twice.
  const pByT = new Map<number, number>();
  for (const sample of pRem) {
    if (!stageByT.has(sample.t)) continue;
    if (!Number.isFinite(sample.p)) continue;
    pByT.set(sample.t, sample.p);
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const [t, p] of pByT) {
    const isRem = stageByT.get(t) === 'REM';
    const predicted = p >= threshold;
    if (predicted && isRem) tp += 1;
    else if (predicted && !isRem) fp += 1;
    else if (!predicted && isRem) fn += 1;
  }

  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return { tp, fp, fn, precision, recall, f1: ratio(2 * precision * recall, precision + recall) };
}

// ---------------------------------------------------------------------------
// Descriptive statistics of a hypnogram (used by the CLI and the report screens)
// ---------------------------------------------------------------------------

export type StageFractions = Record<SleepStage, number>;

/** Share of the record spent in each stage, 0..1. All five keys are always present. */
export function stageFractions(truth: readonly StageSample[]): StageFractions {
  const counts: StageFractions = { WAKE: 0, N1: 0, N2: 0, N3: 0, REM: 0 };
  if (truth.length === 0) return counts;
  for (const sample of truth) counts[sample.stage] += 1;
  for (const stage of Object.keys(counts) as SleepStage[]) {
    counts[stage] = counts[stage] / truth.length;
  }
  return counts;
}

/**
 * Seconds from sleep onset to the first REM epoch — "REM latency", the number that
 * decides whether a 3 h Sleep Guard is generous or stingy. `null` when the night
 * has no REM at all.
 */
export function remLatencySec(truth: readonly StageSample[], onsetT: number): number | null {
  const first = truth.find((s) => s.stage === 'REM');
  return first ? first.t - onsetT : null;
}

/** Wake After Sleep Onset in seconds: WAKE epochs after `onsetT`, excluding none. */
export function wasoSec(truth: readonly StageSample[], onsetT: number, epochSeconds = 30): number {
  let count = 0;
  for (const sample of truth) if (sample.t >= onsetT && sample.stage === 'WAKE') count += 1;
  return count * epochSeconds;
}

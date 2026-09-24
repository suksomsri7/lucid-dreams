/**
 * Replay a night that really happened.
 *
 * The owner exports `diagnostics.json` from the app after an R-round night
 * (APP-RUN §2 "R1"); this turns that file back into the exact epoch stream the
 * engine saw, so a change to the REM estimator or the cue controller can be
 * re-graded against real sleep, not only against `simulate.ts`.
 *
 * Contract: **never throw**. A diagnostics file comes off a phone that may have
 * crashed, run out of battery mid-write or been produced by an older build, so
 * every row is treated as hostile input (APP-RUN §0.5 S8): rows that do not match
 * `SensorEpochSchema` are dropped, duplicates collapse (last one wins) and the
 * result is sorted onto the 30 s grid by `normalizeEpochs`.
 */

import { type DiagnosticsExport, normalizeEpochs, SensorEpochSchema, type SensorEpoch } from './diagnostics';

/** Anything shaped vaguely like a diagnostics export — including junk. */
export type ReplayInput = DiagnosticsExport | Partial<DiagnosticsExport> | null | undefined;

export interface ReplayReport {
  epochs: SensorEpoch[];
  /** Rows present in the file. */
  raw: number;
  /** Rows dropped because they did not match `SensorEpochSchema` (bad HR, missing `t`, …). */
  invalid: number;
  /** Rows dropped because another row already owned that epoch index. */
  duplicates: number;
}

/**
 * Validate, sort, dedupe. Returns `[]` for anything that is not a diagnostics-shaped
 * object with an `epochs` array — the QC reader reports "0 epochs", it does not crash.
 */
export function replayNight(diagnostics: ReplayInput): SensorEpoch[] {
  return replayNightReport(diagnostics).epochs;
}

/** Same as {@link replayNight} but also says what was thrown away and why. */
export function replayNightReport(diagnostics: ReplayInput): ReplayReport {
  const rows: unknown[] = Array.isArray((diagnostics as { epochs?: unknown } | null | undefined)?.epochs)
    ? ((diagnostics as { epochs: unknown[] }).epochs as unknown[])
    : [];

  const valid: SensorEpoch[] = [];
  let invalid = 0;
  for (const row of rows) {
    const parsed = SensorEpochSchema.safeParse(row);
    if (parsed.success) valid.push(parsed.data);
    else invalid += 1;
  }

  const epochs = normalizeEpochs(valid);
  return {
    epochs,
    raw: rows.length,
    invalid,
    duplicates: valid.length - epochs.length,
  };
}

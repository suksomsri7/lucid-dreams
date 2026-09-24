/**
 * Apple's own sleep stages, read the morning after (WO L2.9 · APP-RUN §2 "L2.9" ·
 * DESIGN §5.2 "ตอนเช้า … precision/recall ต่อคืน").
 *
 * Ground rule (APP-RUN §0.5 S10): a caller must never believe it has HealthKit data
 * when it does not. `platform.healthImport` is still the honest, declared-but-not-
 * wired stub `IosHealthImport` has been since WO L1.3 — no maintained Expo HealthKit
 * module targets SDK 57 yet, so its `fetchSleepPhases()` throws `NOT_WIRED` on iOS
 * today (`ledger/wo-notes/L2.8ui.md` carries this as the native-bridge debt for the
 * next Opus native WO). This file is the complete JS-side contract against that
 * interface: `importAppleForSession()` calls it, treats "unavailable" and "throws" and
 * "returned nothing" identically (no phases saved, `applePhasesFetched` stays `false`),
 * and the report screen shows "ไม่มีข้อมูล Apple" rather than "0%" either way
 * (`repo.ts#applePhases` — an empty `saveMany([])` still flips `applePhasesFetched`, so
 * the report screen must check the *phases array*, not that flag, to tell "asked and
 * got nothing" apart from "never asked" — both render the same "no data" text, but the
 * distinction is what a real Opus fix will want later).
 *
 * Retry schedule: the WO's own text allows "09:00/12:00/18:00 via
 * expo-task-manager/background fetch **or** simple on-app-open retry" — this takes the
 * second option on purpose. `expo-task-manager`/`expo-background-fetch` are new native
 * dependencies needing their own `UIBackgroundModes` entry and justification (APP-RUN
 * §0.5 S9), for a feature whose own data (HealthKit sleep analysis) is not even wired
 * yet; `retryPendingAppleImports()` below — called once from the Journal tab's mount,
 * `app/(tabs)/journal.tsx` — costs nothing new and behaves identically from the owner's
 * seat (open the app after 9am, the numbers are there) until the import itself is real.
 */

import { epochSecondsFrom, type ApplePhaseInput } from '@lucid/data';
import { EPOCH_SECONDS, remMetrics, type PRemSample, type RemMetrics, type SleepStage, type StageSample } from '@lucid/engine';

import { fetchNightReport, saveApplePhases } from '../data/report';
import { fetchLastNights } from '../data/history';
import { getPlatform, type SleepPhase } from '../platform';

/** How many recent nights `retryPendingAppleImports` is willing to look at. */
const RETRY_WINDOW_NIGHTS = 7;

/**
 * Apple's own five categories → the engine's 5-stage vocabulary, for `remMetrics`
 * alone: that function only ever asks "is this epoch `'REM'`?" (`metrics.ts`'s own
 * doc comment), so every non-REM Apple category collapses to one placeholder —
 * `'N2'`, the same stage `types.ts`'s own comment names as where Apple's `CORE`
 * (N1+N2 collapsed) would map going the other direction. `IN_BED` has no `@lucid/data`
 * column at all (`schema.ts`'s `SLEEP_STAGES` is `REM/CORE/DEEP/AWAKE`) — those minutes
 * are dropped before they ever reach the database, not stored as a stage they are not.
 */
function toEngineStage(stage: SleepPhase['stage']): SleepStage | null {
  if (stage === 'IN_BED') return null;
  return stage === 'REM' ? 'REM' : 'N2';
}

/** `platform.HealthImport.SleepPhase` → `@lucid/data`'s `ApplePhaseInput`, dropping `IN_BED`. */
function toApplePhaseInputs(phases: readonly SleepPhase[]): ApplePhaseInput[] {
  const inputs: ApplePhaseInput[] = [];
  for (const phase of phases) {
    if (phase.stage === 'IN_BED') continue;
    inputs.push({ startIso: phase.start, endIso: phase.end, stage: phase.stage });
  }
  return inputs;
}

/**
 * Expand each Apple phase across the night's own 30 s epoch grid — only at the `t`s the
 * night actually recorded (`remMetrics` ignores anything else anyway), so a night with
 * gaps never invents ground truth for a `t` with no `p_REM` to compare it against.
 */
function stageTruthForEpochs(phases: readonly ApplePhaseInput[], epochTs: readonly number[]): StageSample[] {
  const ranges = phases
    .map((phase) => ({
      startT: epochSecondsFrom(phase.startIso),
      endT: epochSecondsFrom(phase.endIso),
      stage: toEngineStage(phase.stage),
    }))
    .filter((range): range is { startT: number; endT: number; stage: SleepStage } => range.stage !== null);

  const truth: StageSample[] = [];
  for (const t of epochTs) {
    const hit = ranges.find((range) => t >= range.startT && t < range.endT);
    if (hit) truth.push({ t, stage: hit.stage });
  }
  return truth;
}

export interface AppleImportResult {
  /** `false` when HealthKit is unavailable/unauthorized/empty — the report screen must
   * show "ไม่มีข้อมูล Apple", never "0%", when this is `false` (APP-RUN §0.5 S10). */
  imported: boolean;
  phaseCount: number;
}

/**
 * Ask HealthKit for one night's sleep stages and save them (§ above). Safe to call
 * repeatedly — `applePhases.saveMany` replaces the night's rows each time, so a retry
 * after Apple finishes scoring late simply overwrites an earlier, incomplete read.
 */
export async function importAppleForSession(sessionId: string): Promise<AppleImportResult> {
  const platform = getPlatform();
  const available = await platform.healthImport.isAvailable().catch(() => false);
  if (!available) return { imported: false, phaseCount: 0 };

  const authorized = await platform.healthImport.requestAuthorization().catch(() => false);
  if (!authorized) return { imported: false, phaseCount: 0 };

  const report = await fetchNightReport(sessionId);
  const fromIso = report.session.startedAt;
  const toIso = report.session.endedAt ?? new Date().toISOString();

  let phases: SleepPhase[];
  try {
    phases = await platform.healthImport.fetchSleepPhases({ fromIso, toIso });
  } catch {
    // Native bridge not wired yet (see file header) — honest "no data", not a crash.
    return { imported: false, phaseCount: 0 };
  }
  if (phases.length === 0) return { imported: false, phaseCount: 0 };

  const inputs = toApplePhaseInputs(phases);
  const saved = await saveApplePhases(sessionId, inputs);
  return { imported: saved.length > 0, phaseCount: saved.length };
}

/**
 * On-app-open retry (see file header) — nights in the last {@link RETRY_WINDOW_NIGHTS}
 * that have ended but never got an Apple read yet. Every failure is swallowed: this
 * runs unattended from a screen mount, and a HealthKit hiccup must not surface as an
 * error the owner did nothing to cause.
 */
export async function retryPendingAppleImports(): Promise<void> {
  let nights;
  try {
    nights = await fetchLastNights(RETRY_WINDOW_NIGHTS);
  } catch {
    return;
  }
  for (const summary of nights) {
    if (summary.endedAt === null || summary.applePhasesFetched) continue;
    await importAppleForSession(summary.id).catch(() => undefined);
  }
}

/**
 * Precision/recall of tonight's `p_REM` against Apple's own stages (`metrics.ts`'s
 * `remMetrics`, shared with the L2.1/L2.5 oracles and the report screen's "ทายตรง n%").
 * `null` when there is nothing to compare against — the caller's cue to show
 * "ไม่มีข้อมูล Apple" instead of a metric (APP-RUN §0.5 S10).
 */
export function compareAppleToEstimate(
  applePhases: readonly ApplePhaseInput[],
  epochs: readonly { t: number; pRem: number | null }[],
): RemMetrics | null {
  if (applePhases.length === 0) return null;
  const epochTs = epochs.map((epoch) => epoch.t);
  const truth = stageTruthForEpochs(applePhases, epochTs);
  if (truth.length === 0) return null;

  const pRemSamples: PRemSample[] = epochs
    .filter((epoch): epoch is { t: number; pRem: number } => epoch.pRem !== null)
    .map((epoch) => ({ t: epoch.t, p: epoch.pRem }));

  return remMetrics(truth, pRemSamples);
}

/** Re-exported so callers do not need to know `EPOCH_SECONDS` lives in `@lucid/engine`. */
export const APPLE_EPOCH_SECONDS = EPOCH_SECONDS;

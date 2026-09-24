/**
 * `@lucid/data` calls for WO L2.9 (Apple sleep import) and L2.10 (the night report
 * screen) — split from `./index.ts` by Metro's platform-extension resolution, same
 * reason as `history.ts`/`night.ts` (that file's header explains why in full):
 * `./index.ts` statically imports `expo-sqlite`, whose installed web build has no wasm
 * asset, so any module that reaches `getRepo` breaks `expo export --platform web` even
 * though `getRepo()` already refuses to run on web at runtime. `report.web.ts` is this
 * file's web counterpart — `app/report/[id].tsx` always uses `?fixture=report` there.
 */

import type { ApplePhaseInput, ApplePhaseRecord, ExportBundle, NightReport } from '@lucid/data';

import { getRepo } from './index';

export async function fetchNightReport(sessionId: string): Promise<NightReport> {
  const repo = await getRepo();
  return repo.nightReport(sessionId);
}

/** WO L2.9: replaces the night's `AppleSleepPhase` rows and marks `applePhasesFetched`. */
export async function saveApplePhases(
  sessionId: string,
  phases: readonly ApplePhaseInput[],
): Promise<ApplePhaseRecord[]> {
  const repo = await getRepo();
  return repo.applePhases.saveMany(sessionId, phases);
}

export async function exportNightJson(): Promise<ExportBundle> {
  const repo = await getRepo();
  return repo.exportJson();
}

export async function exportNightCsv(table: string): Promise<string> {
  const repo = await getRepo();
  return repo.exportCsv(table);
}

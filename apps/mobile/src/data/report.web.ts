/**
 * Web counterpart of `report.ts` — see that file's header. `app/report/[id].tsx` always
 * takes the `?fixture=report` / local-store path on web (`Platform.OS === 'web'`) and
 * never actually calls these; this module only has to exist and stay free of
 * `expo-sqlite` so Metro's web bundle never resolves the broken `.wasm` asset.
 */

import type { ApplePhaseInput, ApplePhaseRecord, ExportBundle, NightReport } from '@lucid/data';

import { NotImplementedError } from '../platform/types';

export async function fetchNightReport(_sessionId: string): Promise<NightReport> {
  throw new NotImplementedError('the night report database');
}

export async function saveApplePhases(
  _sessionId: string,
  _phases: readonly ApplePhaseInput[],
): Promise<ApplePhaseRecord[]> {
  throw new NotImplementedError('Apple sleep phase storage');
}

export async function exportNightJson(): Promise<ExportBundle> {
  throw new NotImplementedError('the export database');
}

export async function exportNightCsv(_table: string): Promise<string> {
  throw new NotImplementedError('the export database');
}

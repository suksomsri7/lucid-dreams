/**
 * Web counterpart of `morning.ts` — see that file's header. `MorningFlow.tsx` always
 * takes the `?fixture=morning-*` path on web and never actually calls these; this module
 * only has to exist and stay free of `expo-sqlite` so Metro's web bundle never resolves
 * the broken `.wasm` asset in the first place (same convention as `report.web.ts`/`night.web.ts`).
 */

import type { AiScoreInput, AiScoreRecord, ReportInput, ReportRecord } from '@lucid/data';

import { NotImplementedError } from '../platform/types';

export async function saveMorningReport(_input: ReportInput): Promise<ReportRecord> {
  throw new NotImplementedError('the morning report database');
}

export async function saveMorningAiScore(_input: AiScoreInput): Promise<AiScoreRecord> {
  throw new NotImplementedError('the morning report database');
}

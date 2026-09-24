/**
 * Web counterpart of `night.ts` — see that file's header. The pre-night screens always
 * use the fixture/local-store path on web (`Platform.OS === 'web'`, same convention as
 * `history.web.ts`) and never actually rely on these return values; this module only
 * has to exist and stay free of `expo-sqlite` so Metro's web bundle never resolves the
 * broken `.wasm` asset in the first place.
 */

import type { DreamPlan, EarSide } from '@lucid/engine';

export interface EarTestResultInput {
  side: EarSide;
  rounds: number;
  answer: number;
  attempts: number;
  volume: number;
}

export async function ensureNightSession(
  sessionId: string | null,
  _plan: DreamPlan,
  _dateIso: string,
): Promise<string> {
  return sessionId ?? 'web-fixture-session';
}

export async function saveEarTestToRepo(_sessionId: string, _entry: EarTestResultInput): Promise<void> {
  // no-op on web — see file header.
}

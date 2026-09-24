/**
 * Web counterpart of `night.ts` — see that file's header. The pre-night screens always
 * use the fixture/local-store path on web (`Platform.OS === 'web'`, same convention as
 * `history.web.ts`) and never actually rely on these return values; this module only
 * has to exist and stay free of `expo-sqlite` so Metro's web bundle never resolves the
 * broken `.wasm` asset in the first place.
 */

import type { CueResponse, EarSide, SensorEpoch, WakeCause } from '@lucid/engine';

import type { DreamPlan } from '../advisor/types';

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

// ---------------------------------------------------------------------------
// WO L2.8 — web counterparts (see `night.ts`); `?fixture=night` never calls these
// (its own controller/estimator run with no repo at all — `src/night/session.ts`).
// ---------------------------------------------------------------------------

export interface NightCueInput {
  atIso: string;
  index: number;
  volume: number;
  type: string;
  pRemAtCue: number | null;
  played: boolean;
  response: CueResponse | null;
}

export interface NightWakeInput {
  atIso: string;
  durationSec: number | null;
  cause: WakeCause | null;
}

export async function recordNightEpoch(
  _sessionId: string,
  _epoch: SensorEpoch,
  _pRem: number | null,
  _state: string,
): Promise<void> {
  // no-op on web
}

export async function recordNightCue(_sessionId: string, _cue: NightCueInput): Promise<void> {
  // no-op on web
}

export async function recordNightWake(_sessionId: string, _wake: NightWakeInput): Promise<void> {
  // no-op on web
}

export async function markNightOnset(_sessionId: string, _onsetAtIso: string, _guardUntilIso: string | null): Promise<void> {
  // no-op on web
}

export async function finishNightSession(_sessionId: string, _endedAtIso: string): Promise<void> {
  // no-op on web
}

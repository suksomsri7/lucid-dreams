/**
 * `night.tsx`'s (well, `app/plan/*`'s) calls into `@lucid/data` — split from `./index.ts`
 * by Metro's platform-extension resolution the same way `history.ts`/`history.web.ts`
 * (WO L1.4) already do, and for the identical reason: `./index.ts` statically imports
 * `expo-sqlite` through the platform drivers, and this repo's installed `expo-sqlite`
 * has no web wasm asset, so any module that reaches `getRepo` breaks
 * `expo export --platform web` even though `getRepo()` already refuses to run on web
 * at runtime. `night.web.ts` is this file's web counterpart.
 *
 * Owns exactly two things a pre-night screen needs from the database:
 *   - lazily creating **one** `NightSession` row for tonight, the first time an ear
 *     test needs somewhere to attach to (not at plan-save time — a plan the user never
 *     gets to "start" should not leave an orphan session behind);
 *   - writing a passed `EarTest` row.
 *
 * WO L2.8 extends this file with the writes the *running* night makes
 * (`src/night/session.ts`): one epoch/cue/wake at a time, `markOnset` once, `finish`
 * once. The morning report and the L2.10 report screen's *reads* are a separate
 * concern — `src/data/report.ts`.
 */

import type { CueResponse, EarSide, SensorEpoch, WakeCause } from '@lucid/engine';

import type { DreamPlan } from '../advisor/types';
import { getRepo } from './index';

export interface EarTestResultInput {
  side: EarSide;
  rounds: number;
  answer: number;
  attempts: number;
  volume: number;
}

/**
 * Returns the existing session id unchanged, or creates a fresh `NightSession` for
 * tonight's plan and returns its id. `mode` is always `'CUE'` here — the 1-in-4
 * control-night selection (DESIGN §9 settings) is not built yet in any WO; this at
 * least reproduces the sessions table shape correctly for the day it lands (documented
 * debt in `ledger/wo-notes/L1.7ui.md`).
 */
export async function ensureNightSession(
  sessionId: string | null,
  plan: DreamPlan,
  dateIso: string,
): Promise<string> {
  if (sessionId !== null) return sessionId;
  const repo = await getRepo();
  const session = await repo.sessions.create({
    dateIso,
    mode: 'CUE',
    themeKey: plan.theme.titleEn,
    params: { plan },
  });
  return session.id;
}

export async function saveEarTestToRepo(sessionId: string, entry: EarTestResultInput): Promise<void> {
  const repo = await getRepo();
  await repo.earTests.record({
    sessionId,
    side: entry.side,
    rounds: entry.rounds,
    answer: entry.answer,
    attempts: entry.attempts,
    volume: entry.volume,
  });
}

// ---------------------------------------------------------------------------
// WO L2.8 — the running night's own writes
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

/** One `SensorEpoch` plus the two fields only the database keeps (`repo.ts`'s `EpochInput`). */
export async function recordNightEpoch(
  sessionId: string,
  epoch: SensorEpoch,
  pRem: number | null,
  state: string,
): Promise<void> {
  const repo = await getRepo();
  await repo.sessions.appendEpoch(sessionId, { ...epoch, pRem, state });
}

export async function recordNightCue(sessionId: string, cue: NightCueInput): Promise<void> {
  const repo = await getRepo();
  await repo.sessions.appendCue(sessionId, {
    at: cue.atIso,
    index: cue.index,
    volume: cue.volume,
    type: cue.type,
    pRemAtCue: cue.pRemAtCue,
    played: cue.played,
    response: cue.response ?? undefined,
  });
}

export async function recordNightWake(sessionId: string, wake: NightWakeInput): Promise<void> {
  const repo = await getRepo();
  await repo.sessions.appendWake(sessionId, {
    at: wake.atIso,
    durationSec: wake.durationSec,
    cause: wake.cause,
  });
}

export async function markNightOnset(sessionId: string, onsetAtIso: string, guardUntilIso: string | null): Promise<void> {
  const repo = await getRepo();
  await repo.sessions.markOnset(sessionId, onsetAtIso, guardUntilIso);
}

/** Called once, when the controller reaches `MORNING` or `ENDED` (`ledger/wo-notes/L2.6-2.7.md` debt 1). */
export async function finishNightSession(sessionId: string, endedAtIso: string): Promise<void> {
  const repo = await getRepo();
  await repo.sessions.finish(sessionId, endedAtIso);
}

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
 * Everything else about a night (epochs, cues, wakes, the morning report) belongs to
 * the night engine work (L2.x) and `app/night.tsx`'s real screen, not this WO.
 */

import type { DreamPlan, EarSide } from '@lucid/engine';

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

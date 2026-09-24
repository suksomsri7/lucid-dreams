/**
 * `@lucid/data` writes for WO L3.1 (the morning flow) — split from `./index.ts` by
 * Metro's platform-extension resolution, same reason as `report.ts`/`night.ts` (those
 * files' headers explain it in full): `./index.ts` statically imports `expo-sqlite`,
 * whose installed web build has no wasm asset, so any module that reaches `getRepo`
 * breaks `expo export --platform web` even though `getRepo()` already refuses to run on
 * web at runtime. `morning.web.ts` is this file's web counterpart — `MorningFlow.tsx`
 * only ever takes the `?fixture=morning-*` path there (`src/dev/fixtures.ts`).
 *
 * Reads go through `src/data/report.ts#fetchNightReport` (already returns everything a
 * pending-morning check needs: `session.endedAt`, `report`, `cues`) — this file only adds
 * the two writes `repo.reports`/`repo.ai` do not yet have a call site for.
 */

import type { AiScoreInput, AiScoreRecord, ReportInput, ReportRecord } from '@lucid/data';

import { getRepo } from './index';

/**
 * Upsert (`repo.ts#reports.save`'s own doc comment: "One report per night ... send the
 * same object again after an edit") — safe to call after every single answer, which is
 * exactly what `useMorning.ts` does (DESIGN §7 `MorningReport`: "partial answers allowed").
 */
export async function saveMorningReport(input: ReportInput): Promise<ReportRecord> {
  const repo = await getRepo();
  return repo.reports.save(input);
}

/** Only called once, after `/ai/score` returns something `sanitizeAiScore` could use. */
export async function saveMorningAiScore(input: AiScoreInput): Promise<AiScoreRecord> {
  const repo = await getRepo();
  return repo.ai.save(input);
}

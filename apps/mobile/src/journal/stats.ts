/**
 * `journal.tsx`'s one call into `@lucid/data`'s `repo.stats()` — split from `../data/index.ts`
 * by Metro's platform-extension resolution, same reason as `history.ts`/`report.ts`
 * (those files' headers explain it in full). Lives under `src/journal/` (not `src/data/`)
 * so the tab's one data dependency sits next to the screen it belongs to.
 */

import type { StatsResult } from '@lucid/data';

import { getRepo } from '../data';

export async function fetchJournalStats(days: number): Promise<StatsResult> {
  const repo = await getRepo();
  return repo.stats(days);
}

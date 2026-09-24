/**
 * `journal.tsx`'s one call into `@lucid/data`'s `repo.stats()` — split from `./index.ts`
 * by Metro's platform-extension resolution, same reason as `history.ts`/`report.ts`
 * (those files' headers explain it in full).
 */

import type { StatsResult } from '@lucid/data';

import { getRepo } from './index';

export async function fetchJournalStats(days: number): Promise<StatsResult> {
  const repo = await getRepo();
  return repo.stats(days);
}

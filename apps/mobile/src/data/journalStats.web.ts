/**
 * Web counterpart of `journalStats.ts` — see that file's header. `journal.tsx` always
 * takes the `?fixture=journal` path on web.
 */

import type { StatsResult } from '@lucid/data';

export async function fetchJournalStats(_days: number): Promise<StatsResult> {
  return { nights: 0, cueNights: 0, controlNights: 0, lucidRateCue: 0, lucidRateControl: 0, themeMatchAvg: 0, windowDays: 30, fromDateIso: '' };
}

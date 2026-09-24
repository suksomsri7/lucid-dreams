/**
 * Web counterpart of `realityCheck.ts` — see that file's header and `report.web.ts`'s
 * header for why this split exists.
 */

import type { RealityCheckAnswer } from '@lucid/data';

export async function recordRealityCheck(_atIso: string, _responded: RealityCheckAnswer): Promise<void> {
  // no-op on web — see file header.
}

export interface RealityCheckSummary {
  total: number;
  done: number;
  later: number;
  none: number;
}

export async function summarizeRealityChecks(_sinceIso: string): Promise<RealityCheckSummary> {
  return { total: 0, done: 0, later: 0, none: 0 };
}

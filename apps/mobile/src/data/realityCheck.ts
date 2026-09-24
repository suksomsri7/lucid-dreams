/**
 * `RealityCheck` (DESIGN §7 · WO L3.3 · mockup `10-outside.png`'s "Done/Later" pair).
 * Same situation as `personalModel.ts`: the table exists, the repo has no accessor group
 * for it, and `packages/data` is off-limits to this WO — so this is a small raw-driver
 * wrapper, not a repo change.
 */

import type { RealityCheckAnswer, Row } from '@lucid/data';

import { getRepo } from './index';

export async function recordRealityCheck(atIso: string, responded: RealityCheckAnswer): Promise<void> {
  const repo = await getRepo();
  await repo.db.run(`INSERT INTO "RealityCheck" ("at","responded","createdAt") VALUES (?, ?, ?)`, [
    atIso,
    responded,
    new Date().toISOString(),
  ]);
}

export interface RealityCheckSummary {
  total: number;
  done: number;
  later: number;
  none: number;
}

/** Used by `journal.tsx`/diagnostics-style screens later; not required by this WO's own oracle but a natural companion to `recordRealityCheck`, and cheap to keep here rather than invent a second table wrapper file for one query. */
export async function summarizeRealityChecks(sinceIso: string): Promise<RealityCheckSummary> {
  const repo = await getRepo();
  const rows = await repo.db.all<Row>(`SELECT "responded" FROM "RealityCheck" WHERE "at" >= ?`, [sinceIso]);
  const summary: RealityCheckSummary = { total: rows.length, done: 0, later: 0, none: 0 };
  for (const row of rows) {
    if (row.responded === 'DONE') summary.done += 1;
    else if (row.responded === 'LATER') summary.later += 1;
    else summary.none += 1;
  }
  return summary;
}

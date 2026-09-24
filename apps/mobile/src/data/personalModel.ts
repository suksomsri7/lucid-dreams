/**
 * `PersonalModel` (DESIGN §7 · schema `packages/data/src/schema.ts`) — WO L3.4's saved
 * learning loop. The table already exists (created for this WO by L1.8's migration); the
 * repo (`packages/data/src/repo.ts`) has no accessor group for it yet, and `packages/
 * data`/`packages/engine` are off-limits to this WO (APP-RUN §2 "L3.4 app": "add a repo
 * accessor ONLY via a small wrapper in apps/mobile/src/data using raw driver if the repo
 * lacks one"). This file is exactly that wrapper — one row, `id = 'me'`, read/written
 * through `(await getRepo()).db` with the same bound-parameter discipline `repo.ts` uses
 * everywhere else (never interpolate a value into SQL).
 *
 * What is actually stored in each column, since the schema's names were written ahead of
 * this WO and are broader than one bandit:
 *   - `cueTypeStats` — **not just cue types**: the whole Thompson-sampling posterior
 *     (`Record<armKey, {a,b}>`, `@lucid/engine`'s `BetaPosterior` per `ARMS` entry) plus
 *     the night count, as one JSON blob `{ posterior, nights }`. The arm space already
 *     includes `cueType` as one of its three dimensions (`bandit.ts`'s own header), so
 *     "cue type stats" is an honest (if incomplete) name for it.
 *   - `volumeCeiling` / `bestDelay` — the derived view (`personalModelFromBandit`'s
 *     `volumeCeiling`/`topArm.delaySec`) at the moment of the last save, kept for a human
 *     reading the raw table; the app always recomputes both from the posterior, never
 *     trusts these two columns as authoritative.
 *   - `remWeights` / `remHistogram` — **not touched by this file.** Those belong to the
 *     REM estimator's own personalisation (`packages/engine/src/remEstimator.ts`'s
 *     `RemWeights` — a different WO's concern); every write below preserves whatever is
 *     already in those two columns rather than clobbering them with `'{}'`/`'[]'`.
 */

import type { BetaPosterior } from '@lucid/engine';
import type { Row } from '@lucid/data';

import { getRepo } from './index';

const PERSONAL_MODEL_ID = 'me';

export interface PersonalModelRow {
  posterior: Record<string, BetaPosterior>;
  nights: number;
  volumeCeiling: number | null;
  bestDelay: number | null;
  updatedAt: string;
}

function parsePosterior(raw: unknown): { posterior: Record<string, BetaPosterior>; nights: number } {
  if (typeof raw !== 'string' || raw === '') return { posterior: {}, nights: 0 };
  try {
    const parsed = JSON.parse(raw) as { posterior?: Record<string, BetaPosterior>; nights?: number };
    return { posterior: parsed.posterior ?? {}, nights: Number.isFinite(parsed.nights) ? Number(parsed.nights) : 0 };
  } catch {
    return { posterior: {}, nights: 0 };
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `null` when no night has ever folded into the bandit yet (a fresh install). */
export async function loadPersonalModel(): Promise<PersonalModelRow | null> {
  const repo = await getRepo();
  const rows = await repo.db.all<Row>(`SELECT * FROM "PersonalModel" WHERE "id" = ?`, [PERSONAL_MODEL_ID]);
  const row = rows[0];
  if (row === undefined) return null;
  const { posterior, nights } = parsePosterior(row.cueTypeStats);
  return {
    posterior,
    nights,
    volumeCeiling: num(row.volumeCeiling),
    bestDelay: num(row.bestDelay),
    updatedAt: String(row.updatedAt ?? ''),
  };
}

export interface SavePersonalModelInput {
  posterior: Record<string, BetaPosterior>;
  nights: number;
  volumeCeiling: number | null;
  bestDelay: number | null;
  updatedAtIso: string;
}

/** Upsert the single `id='me'` row — never touches `remWeights`/`remHistogram` (see header). */
export async function savePersonalModel(input: SavePersonalModelInput): Promise<void> {
  const repo = await getRepo();
  const cueTypeStats = JSON.stringify({ posterior: input.posterior, nights: input.nights });
  await repo.db.run(
    `INSERT INTO "PersonalModel" ("id","remWeights","remHistogram","volumeCeiling","bestDelay","cueTypeStats","updatedAt")
       VALUES (?, '{}', '[]', ?, ?, ?, ?)
     ON CONFLICT ("id") DO UPDATE SET
       "volumeCeiling" = excluded."volumeCeiling",
       "bestDelay" = excluded."bestDelay",
       "cueTypeStats" = excluded."cueTypeStats",
       "updatedAt" = excluded."updatedAt"`,
    [PERSONAL_MODEL_ID, input.volumeCeiling, input.bestDelay, cueTypeStats, input.updatedAtIso],
  );
}

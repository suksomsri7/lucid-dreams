/**
 * `history.tsx`'s one call into `@lucid/data` — split from `./index.ts` by Metro's
 * platform-extension resolution (`history.web.ts` wins when bundling for web) on
 * purpose: `./index.ts` statically imports `expo-sqlite` (via the platform drivers),
 * and this dependency tree's installed `expo-sqlite` is missing its web wasm asset
 * (`node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm` does not exist — an upstream
 * packaging gap, not something WO L1.4 can fix from inside `apps/mobile`). Without this
 * split, `history.tsx` importing `getRepo` at all makes `expo export --platform web`
 * fail outright, even though `getRepo()` already refuses to run on web at runtime
 * (`./index.ts`'s own `NotImplementedError`). See `ledger/wo-notes/L1.4.md`.
 */

import type { NightSummary } from '@lucid/data';

import { getRepo } from './index';

export async function fetchLastNights(n: number): Promise<NightSummary[]> {
  const repo = await getRepo();
  return repo.lastNights(n);
}

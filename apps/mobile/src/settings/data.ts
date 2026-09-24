/**
 * `settings.tsx`'s two calls into `@lucid/data` — split from `../data/index.ts` by
 * Metro's platform-extension resolution, same reason as `history.ts`/`report.ts`/
 * `journal/stats.ts` (those files' headers explain it in full): `../data/index.ts`
 * statically imports `expo-sqlite`, whose installed web build has no wasm asset, so any
 * module that reaches `getRepo` breaks `expo export --platform web` even though
 * `getRepo()` already refuses to run on web at runtime.
 *
 * `deleteEverythingLocal` also does the file-system half of "delete everything"
 * (`repo.deleteAll()`'s own doc comment: it returns the audio paths precisely so the
 * caller can't forget them) and closes the database handle — the parts of §0.5 S4 that
 * are about the local device rather than the server or other AsyncStorage keys, which
 * stay in `settings.tsx` itself (`deleteDevice`, `clearNightPlan`, the two
 * `resetXAfterDeleteAll` calls) since none of those touch `@lucid/data`.
 */

import { File } from 'expo-file-system';

import type { ExportBundle } from '@lucid/data';

import { closeDatabase, getRepo } from '../data';

export async function exportAllData(): Promise<ExportBundle> {
  const repo = await getRepo();
  return repo.exportJson();
}

export async function deleteEverythingLocal(): Promise<void> {
  const repo = await getRepo();
  const result = await repo.deleteAll();
  for (const path of result.audioPaths) {
    try {
      const file = new File(path);
      if (file.exists) file.delete();
    } catch {
      // Best-effort per file — one bad path must not stop the rest of the wipe.
    }
  }
  await closeDatabase();
}

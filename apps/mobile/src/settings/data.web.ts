/**
 * Web counterpart of `data.ts` — see that file's header. `settings.tsx` guards both
 * calls with `Platform.OS === 'web'` and never actually reaches these; this module only
 * has to exist and stay free of `expo-sqlite` so Metro's web bundle never resolves the
 * broken `.wasm` asset in the first place.
 */

import type { ExportBundle } from '@lucid/data';

import { NotImplementedError } from '../platform/types';

export async function exportAllData(): Promise<ExportBundle> {
  throw new NotImplementedError('the export database');
}

export async function deleteEverythingLocal(): Promise<void> {
  throw new NotImplementedError('the local database');
}

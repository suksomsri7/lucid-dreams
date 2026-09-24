/**
 * Web counterpart of `history.ts` — see that file's header. `history.tsx` always uses
 * its own fixture rows on web (`Platform.OS === 'web'`) and never actually calls this,
 * but the module must still exist and stay free of `expo-sqlite` so Metro's web bundle
 * never has a reason to resolve the broken `.wasm` asset in the first place.
 */

import type { NightSummary } from '@lucid/data';

export async function fetchLastNights(_n: number): Promise<NightSummary[]> {
  return [];
}

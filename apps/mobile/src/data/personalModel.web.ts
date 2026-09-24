/**
 * Web counterpart of `personalModel.ts` — see that file's header and `report.web.ts`'s
 * header for why this split exists (Metro/`expo-sqlite`'s missing web wasm asset).
 * `src/learning/index.ts` always takes the "no personal model yet" branch on web.
 */

import type { BetaPosterior } from '@lucid/engine';

export interface PersonalModelRow {
  posterior: Record<string, BetaPosterior>;
  nights: number;
  volumeCeiling: number | null;
  bestDelay: number | null;
  updatedAt: string;
}

export async function loadPersonalModel(): Promise<PersonalModelRow | null> {
  return null;
}

export interface SavePersonalModelInput {
  posterior: Record<string, BetaPosterior>;
  nights: number;
  volumeCeiling: number | null;
  bestDelay: number | null;
  updatedAtIso: string;
}

export async function savePersonalModel(_input: SavePersonalModelInput): Promise<void> {
  // no-op on web — see file header.
}

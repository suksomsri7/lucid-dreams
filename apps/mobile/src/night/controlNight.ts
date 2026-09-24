/**
 * Control nights (WO L3.3 · DESIGN §5.5 "control nights randomised at 25% … told only in
 * the morning" · APP-RUN §2 "L3.3").
 *
 * One in four nights (by default) plays nothing: the engine still decides every
 * `CueEvent` it *would* have fired (`NightControllerMode: 'CONTROL'`, `packages/engine/
 * src/nightController.ts`) but never calls the player, so `journal.tsx`'s "27% lucid on
 * whisper nights vs 8% on control nights" has something honest to compare against. The pick has to be
 * **deterministic per night** (APP-RUN §0.2 rule 6: no hidden state, no `Math.random()`)
 * so a night can be replayed and so the same "was tonight a control night" answer holds
 * if this function is called more than once before the session row is written
 * (`src/data/night.ts#ensureNightSession` — the actual call site).
 *
 * `dateIso` (the night's own local date label, same string `NightSession.dateIso`
 * stores) plus a per-install seed (the anchor seed — already the one stable per-install
 * string this app keeps, `src/audio/anchor.ts#getAnchorSeed`) are folded into one
 * `mulberry32` draw. Two installs, or the same install on two different nights, get
 * independent draws; the same install asking twice about the same night gets the same
 * answer.
 */

import { mulberry32 } from '@lucid/engine';

/** DESIGN §5.5 / mockup `09-settings.png` "control nights, 1 in 4". */
export const CONTROL_NIGHT_RATIO = 0.25;

/**
 * FNV-1a — small, dependency-free, and only needs to spread `${seed}|${dateIso}`
 * strings across the 32-bit space `mulberry32` wants; not a security hash.
 */
function seedFromString(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * `true` when `dateIso` should run as a control night. `ratio <= 0` (the settings
 * switch turned off, `src/settings/store.ts#controlNightsEnabled`) always returns
 * `false` without ever drawing a random number — turning the switch off must be able to
 * guarantee "never a control night again", not just "usually not".
 */
export function isControlNight(dateIso: string, ratio: number = CONTROL_NIGHT_RATIO, seed = 'default'): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  if (ratio >= 1) return true;
  const rng = mulberry32(seedFromString(`${seed}|${dateIso}`));
  return rng.next() < ratio;
}

/**
 * The four ambience beds a `DreamPlan.ambienceKey` can pick (DESIGN §6 · §5.3 · WO
 * L1.7ui deliverable #2). `AMBIENCE_KEYS`/`AmbienceKey` are the engine's own union
 * (`packages/engine/src/dreamPlan.ts`) — this file only maps each key to the asset
 * Metro should bundle, so the two can never drift (a 5th ambience key would fail to
 * compile here, not fail silently at night).
 *
 * Files (`apps/mobile/assets/audio/ambience-*.m4a`, 20–30 s seamless loops, < 300 KB
 * each — generated with ffmpeg, see `ledger/wo-notes/L1.7ui.md` for the exact filter
 * chains):
 *   - `underwater` — low-passed brown noise with a slow amplitude LFO (a "breathing" hum).
 *   - `wind`       — band-passed pink noise, slower LFO — an open, airy hiss.
 *   - `rain`       — high-passed white noise with a faster LFO — reads as patter, not hiss.
 *   - `silence`    — 1 s of true digital silence (the "อวกาศ"/space theme's bed).
 */

import type { AmbienceKey } from '@lucid/engine';

// Metro asset imports — each `require` is a number the RN image/audio pipeline resolves
// to a bundled file, exactly like `IosAudioPlayer.ts`'s `BED_SOURCE`.
const AMBIENCE_SOURCES: Record<AmbienceKey, number> = {
  underwater: require('../../assets/audio/ambience-underwater.m4a') as number,
  wind: require('../../assets/audio/ambience-wind.m4a') as number,
  rain: require('../../assets/audio/ambience-rain.m4a') as number,
  silence: require('../../assets/audio/ambience-silence.m4a') as number,
};

/** The bundled asset for one ambience bed — pass straight to `createAudioPlayer`/`playOneShot`. */
export function ambienceSource(key: AmbienceKey): number {
  return AMBIENCE_SOURCES[key];
}

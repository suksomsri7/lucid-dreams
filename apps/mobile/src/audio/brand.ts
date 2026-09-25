/**
 * The brand anchor tone (WO L3.7 §B4) — the app's own short signature melody, played
 * exactly once in two places: while the intro overlay is still on screen (cold launch,
 * `src/intro/IntroOverlay.tsx`) and the moment the user taps "Start tonight"
 * (`src/advisor/AdvisorRoom.tsx#handleStart`).
 *
 * It is deliberately the **user's own anchor**, not a canned marketing jingle: the same
 * `makeSignature(seed, lang)` melody the night whisper and the ear tests use
 * (`src/audio/anchor.ts`), rendered centre (`pan: 0`) like the plan card's "▶ listen"
 * preview. Hearing it at launch and again at "start tonight" is part of the memorisation
 * the whole method rests on (DESIGN §2 principle 3) — one more repetition, for free.
 *
 * Three rules this file exists to enforce:
 *  1. **It can never break the app.** Everything is inside one try/catch: a missing cache
 *     directory, a storage read that fails, a busy audio session — all of it degrades to a
 *     log line and a silent launch, never a thrown promise out of a render effect.
 *  2. **It respects the user's volume.** `volumeStart` from the settings store (WO L3.6) is
 *     what the user set; before that store has hydrated (a cold launch is exactly that race)
 *     it falls back to {@link FALLBACK_BRAND_VOLUME}, the same 0.15 `app/plan/index.tsx`
 *     uses for its preview button.
 *  3. **It never awaits the caller.** Both call sites do `void playBrandAnchor()` — the tone
 *     starts, the UI carries on. On web `playAnchorOnce` is already a stub that logs and
 *     returns (`src/audio/player.ts`), so the QC export has nothing to do here.
 */

import { getLocale } from '../i18n';
import { getSettings, isSettingsHydrated } from '../settings/store';
import { buildAnchorSignature, getAnchorSeed, playAnchorOnce } from './player';

/**
 * Used until `src/settings/store.ts` has read `AsyncStorage` — the same value
 * `app/plan/index.tsx`'s preview button passes, and the store's own
 * `DEFAULT_VOLUME_START`, so a launch that beats hydration sounds identical to one
 * that does not for every user who never moved the slider.
 */
export const FALLBACK_BRAND_VOLUME = 0.15;

/**
 * Launch / "Start tonight" happen in daylight, usually on the speaker: the night-time starting
 * level (0.15, tuned for headphones on a pillow) is inaudible there — the owner opened the
 * TestFlight build and heard nothing (R1, 25 ก.ย.). The brand tone therefore plays at a floor
 * of {@link BRAND_MIN_VOLUME}; the user's own setting still wins when it is higher.
 */
export const BRAND_MIN_VOLUME = 0.5;

/** Resolve the level to play at: the user's setting once known, the shared default before that. */
function brandVolume(): number {
  const configured = isSettingsHydrated() ? getSettings().volumeStart : FALLBACK_BRAND_VOLUME;
  return Math.max(configured, BRAND_MIN_VOLUME);
}

/**
 * Play the user's anchor signature once, centre-panned. Never rejects.
 *
 * Call it with `void playBrandAnchor()`; the returned promise resolves when playback has
 * been *started and finished* by the platform player, which is long after the caller
 * should have moved on.
 */
export async function playBrandAnchor(): Promise<void> {
  try {
    const seed = await getAnchorSeed();
    const signature = buildAnchorSignature(seed, getLocale());
    await playAnchorOnce(signature, { volume: brandVolume(), pan: 0 });
  } catch (error) {
    // eslint-disable-next-line no-console -- the brand tone must never break a launch (WO L3.7 §B4)
    console.warn('[audio] brand anchor did not play', error);
  }
}

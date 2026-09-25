/**
 * Thin facade over `platform.audioPlayer` for everything that is **not** the all-night
 * bed (WO L1.7ui deliverable #2): the plan card's "▶ listen" preview, the ear-test
 * screens' repeated playback, and — once a night controller exists (L2.6/L2.8) — the
 * gated whisper itself. Screens never call `getPlatform().audioPlayer.playOneShot`
 * directly; they call the functions below, so there is exactly one place that renders
 * the anchor to a file and exactly one place that can play a night cue.
 */

import { Platform } from 'react-native';

import {
  cueGate,
  type AnchorSignature,
  type CueGateContext,
  type CueGateVerdict,
  type MemorizationPlan,
  type NightState,
} from '@lucid/engine';

import { getPlatform } from '../platform';
import { ambienceSource } from './ambience';
import { buildAnchorSignature, ensureAnchorWavUri, getAnchorSeed, resetAnchorSeed, type AnchorPan } from './anchor';
import { ensureFullAnchorUri, prefetchFullAnchor } from './anchorRemote';
import type { AnchorLang } from '@lucid/engine';

export { ambienceSource, buildAnchorSignature, getAnchorSeed, resetAnchorSeed, prefetchFullAnchor };
export type { AnchorPan };

export interface PlayAnchorOptions {
  volume: number;
  /** `-1`/`1` for a hard-panned ear test round, `0` (default) for the plan card preview. */
  pan?: AnchorPan;
  /**
   * Which language's file to look for in the full-anchor cache (WO L3.8). Defaults to
   * `signature.lang`, which is the only value that can ever match the server's `x-anchor-hash`
   * — pass it only if the signature and the UI locale have deliberately diverged.
   */
  lang?: AnchorLang;
  /** Night cues: use the full file only if it is already on disk — never fetch at cue time. */
  cachedOnly?: boolean;
}

/**
 * What `playAnchorOnce` actually played (WO L3.8). `fullAnchor: false` means the user heard the
 * bell alone — the night session records that per cue so R1 can tell a silent-whisper night
 * from a working one instead of guessing.
 */
export interface AnchorPlayback {
  fullAnchor: boolean;
  /** The file that was handed to the platform player, `null` when nothing played (web stub). */
  source: string | null;
}

/**
 * Play the anchor tone once. Web has no real audio backend in this repo (the QC export
 * bundle gets the same stub `AudioPlayer` Android does — `platform/android/index.ts`),
 * so this short-circuits there *before* touching the filesystem-backed renderer in
 * `anchor.ts` — `expo-file-system`'s `File`/`Directory` classes are native-only shapes
 * with empty web stand-ins, and a screen's mount effect must never throw on the web QC
 * build over something a screenshot does not need anyway.
 *
 * WO L3.8 adds the half the method actually needs: **centre playback prefers the full anchor**
 * (bell + the whispered "You are dreaming.", downloaded once by `anchorRemote.ts`), and falls
 * back to the locally-rendered bell WAV whenever that file is not on disk. A hard-panned round
 * (`pan ≠ 0`, the ear tests) is untouched and always plays the short one-sided WAV: the
 * downloaded mp3 is a stereo mix, so it could not prove "you heard nothing on this side"
 * anyway, and `IosAudioPlayer` would (correctly) record a `PAN_SOURCE_MISMATCH` for it.
 */
export async function playAnchorOnce(
  signature: AnchorSignature,
  options: PlayAnchorOptions,
): Promise<AnchorPlayback> {
  const pan = options.pan ?? 0;
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-console -- intentional web stub log (WO L1.7ui)
    console.log('[audio] playAnchorOnce stub on web', { hash: signature.hash, pan, volume: options.volume });
    return { fullAnchor: false, source: null };
  }
  const full =
    pan === 0
      ? await ensureFullAnchorUri(signature, options.lang ?? signature.lang, { cachedOnly: options.cachedOnly === true })
      : null;
  const source = full ?? (await ensureAnchorWavUri(signature, pan));
  await getPlatform().audioPlayer.playOneShot({ source, volume: options.volume, pan });
  return { fullAnchor: full !== null, source };
}

/**
 * WO L3.10 (R1 hotfix #2): the level every "▶" preview tap in the advisor room/plan
 * card should play at — `0.15` (used everywhere else `playAnchorOnce` is called with an
 * explicit volume, e.g. `app/plan/index.tsx`) is tuned for the *night cue*, heard through
 * headphones in a silent room. A daytime tap on a card, through the phone's own speaker,
 * is nearly inaudible at that level (R1 report: "no sound" on first tap) — `0.5` is loud
 * enough to confirm the anchor is real without this becoming the level anything actually
 * cues at overnight.
 */
export const PREVIEW_VOLUME = 0.5;

/**
 * The advisor room's/plan card's "▶" preview — centre-panned, at `PREVIEW_VOLUME` (not
 * whatever the night cue uses), and always the full anchor when it can be (bell +
 * whispered phrase) so tapping ▶ previews what the user will actually hear tonight, not
 * just the bare tone.
 */
export async function playAnchorPreview(signature: AnchorSignature, lang: AnchorLang): Promise<AnchorPlayback> {
  return playAnchorOnce(signature, { volume: PREVIEW_VOLUME, pan: 0, lang });
}

/**
 * Run one full round-trip of `createMemorizationTest().start()`'s plan: play the
 * signature `plan.rounds` times on `plan.pan`, with `plan.gapsMs[i]` of silence between
 * plays (there is one fewer gap than rounds — the loop below simply has nothing to wait
 * on after the last play). `onRoundStart` lets the screen animate a waveform per round;
 * resolves once the last play has finished, which is when the screen should call the
 * engine's `test.ask()` and show the "how many rounds?" chips.
 */
export async function playMemorizationPlan(
  signature: AnchorSignature,
  plan: MemorizationPlan,
  volume: number,
  onRoundStart?: (roundIndex: number) => void,
): Promise<void> {
  for (let round = 0; round < plan.rounds; round += 1) {
    onRoundStart?.(round);
    await playAnchorOnce(signature, { volume, pan: plan.pan });
    const gapMs = plan.gapsMs[round];
    if (gapMs !== undefined) await sleep(gapMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The app-side half of the cue gate (`packages/engine/src/cueGate.ts`). No night
 * controller exists yet to call this for real (that is L2.6's "cue controller" /
 * L2.8's night screen) — it is wired in now so the anchor player can **never** be
 * connected to a whisper without going through the same rule the engine enforces
 * (`cueGate.ts`'s own header: "two independent layers that can say no"), and so L2.6
 * has a ready call site instead of inventing "ask the engine, then play" from scratch.
 * Mirrors `cueGate`'s signature exactly; returns the verdict either way so the caller
 * can log *why* it stayed quiet even when it does not play.
 */
export async function playNightCueIfAllowed(
  signature: AnchorSignature,
  state: NightState,
  ctx: CueGateContext,
  volume: number,
): Promise<CueGateVerdict> {
  const verdict = cueGate(state, ctx);
  if (verdict.allowed) await playAnchorOnce(signature, { volume, pan: 0 });
  return verdict;
}

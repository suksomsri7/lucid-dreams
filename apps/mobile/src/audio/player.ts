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
import { buildAnchorSignature, ensureAnchorWavUri, getAnchorSeed, type AnchorPan } from './anchor';

export { ambienceSource, buildAnchorSignature, getAnchorSeed };
export type { AnchorPan };

export interface PlayAnchorOptions {
  volume: number;
  /** `-1`/`1` for a hard-panned ear test round, `0` (default) for the plan card preview. */
  pan?: AnchorPan;
}

/**
 * Play the anchor tone once. Web has no real audio backend in this repo (the QC export
 * bundle gets the same stub `AudioPlayer` Android does — `platform/android/index.ts`),
 * so this short-circuits there *before* touching the filesystem-backed renderer in
 * `anchor.ts` — `expo-file-system`'s `File`/`Directory` classes are native-only shapes
 * with empty web stand-ins, and a screen's mount effect must never throw on the web QC
 * build over something a screenshot does not need anyway.
 */
export async function playAnchorOnce(signature: AnchorSignature, options: PlayAnchorOptions): Promise<void> {
  const pan = options.pan ?? 0;
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-console -- intentional web stub log (WO L1.7ui)
    console.log('[audio] playAnchorOnce stub on web', { hash: signature.hash, pan, volume: options.volume });
    return;
  }
  const uri = await ensureAnchorWavUri(signature, pan);
  await getPlatform().audioPlayer.playOneShot({ source: uri, volume: options.volume, pan });
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

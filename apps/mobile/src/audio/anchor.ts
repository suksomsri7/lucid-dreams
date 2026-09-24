/**
 * The anchor asset (WO L1.7ui deliverable #2 · DESIGN §2 principle 3 · §4-04 c/d).
 *
 * `makeSignature`/`renderSignaturePcm` (from `@lucid/engine`) produce the user's
 * personal watermark melody as raw `Float32Array` PCM — pure maths, no `AudioContext`,
 * so it is identical on the phone and in `vitest` on the VPS (`ledger/wo-notes/L1.6e.md`
 * §1). This file is the one place that turns that PCM into a **file** `expo-audio` can
 * open (`createAudioPlayer`/`playOneShot` both take a source, not a buffer) and caches
 * it on disk by the signature's own `hash` so the ear-test screens and the plan card's
 * "▶ listen" preview never re-render the same clip twice in one install.
 *
 * Hard L/R separation (`memorization.ts`'s `pan: -1 | 1`) is done here, not by a player
 * setting: `expo-audio`'s `AudioPlayer` has no `pan` property (checked against the
 * installed package's `.d.ts` before choosing this — `node_modules/expo-audio/build/
 * AudioModule.types.d.ts` lists `volume`/`playbackRate`/… and nothing panning-shaped),
 * so "left ear only" / "right ear only" are two different **stereo files**, one channel
 * zeroed, per the WO's own suggested fallback.
 *
 * The whispered sentence after the melody (`anchorPhraseFor(lang)`) is **not** rendered
 * here — that is server-side TTS (`POST /ai/tts`, cached per `anchorPhraseKey`), still
 * unbuilt on the app side. This file only ever plays the tone; the phrase is a debt,
 * flagged in `ledger/wo-notes/L1.7ui.md`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import {
  makeSignature,
  renderSignaturePcm,
  type AnchorLang,
  type AnchorSignature,
} from '@lucid/engine';

/** `-1`/`1` mirror `MemorizationPlan.pan`; `0` is the un-panned plan-card preview. */
export type AnchorPan = -1 | 0 | 1;

const SAMPLE_RATE = 48000;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM

function panSuffix(pan: AnchorPan): 'c' | 'l' | 'r' {
  return pan === -1 ? 'l' : pan === 1 ? 'r' : 'c';
}

/** Convert one `-1..1` float sample to a clamped 16-bit signed integer. */
function floatTo16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/**
 * Build a 44-byte-header PCM16 WAV, stereo, with `pan` deciding which channel (if any)
 * carries the signal — the other channel is true silence, not just quiet, so the ear
 * test screens can trust "you heard nothing on this side" to mean exactly that.
 */
function encodeWavPcm16(mono: Float32Array, pan: AnchorPan, sampleRate = SAMPLE_RATE): Uint8Array {
  const channels = 2;
  const dataBytes = mono.length * channels * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE;
  const blockAlign = channels * BYTES_PER_SAMPLE;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  const leftOn = pan <= 0; // pan -1 (left-only) and 0 (center) both carry the left channel
  const rightOn = pan >= 0; // pan 1 (right-only) and 0 (center) both carry the right channel
  for (let i = 0; i < mono.length; i += 1) {
    const sample16 = floatTo16(mono[i] as number);
    view.setInt16(offset, leftOn ? sample16 : 0, true);
    view.setInt16(offset + 2, rightOn ? sample16 : 0, true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

function anchorDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'anchor');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** The user's watermark for tonight's language — pure, deterministic, no I/O. */
export function buildAnchorSignature(seed: string, lang: AnchorLang): AnchorSignature {
  return makeSignature(seed, lang);
}

const ANCHOR_SEED_STORAGE_KEY = 'lucid.anchor.seed';
let cachedAnchorSeed: string | null = null;

function randomSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The per-install seed `makeSignature()` folds into the watermark. `signature.ts`'s own
 * header says this is meant to be generated once, at onboarding — no earlier WO actually
 * did that (checked `src/store/onboarding.ts`: no seed field), so this closes that gap
 * the pragmatic way instead of adding it retroactively to a store another WO already
 * shipped: first call generates and persists a stable random string, every call after
 * (same install) returns the same one — the actual requirement (DESIGN §2 principle 3:
 * "deterministic … a user who reinstalls must not lose the cue they trained on" refers
 * to *this* seed surviving app restarts, which `AsyncStorage` does; surviving a real
 * reinstall would need a server-side identity, which does not exist yet either — see
 * `ledger/wo-notes/L1.7ui.md`).
 */
export async function getAnchorSeed(): Promise<string> {
  if (cachedAnchorSeed !== null) return cachedAnchorSeed;
  const stored = await AsyncStorage.getItem(ANCHOR_SEED_STORAGE_KEY);
  if (stored !== null) {
    cachedAnchorSeed = stored;
    return stored;
  }
  const fresh = randomSeed();
  cachedAnchorSeed = fresh;
  await AsyncStorage.setItem(ANCHOR_SEED_STORAGE_KEY, fresh).catch(() => undefined);
  return fresh;
}

/**
 * Render (or reuse) the WAV for this signature + pan, and return a `file://` URI ready
 * for `AudioPlayer.playOneShot`/`createAudioPlayer`. Cached on disk by
 * `<hash>-<c|l|r>.wav`, so replaying the ear test or reopening the plan card is instant
 * after the first render.
 */
export async function ensureAnchorWavUri(signature: AnchorSignature, pan: AnchorPan = 0): Promise<string> {
  const file = new File(anchorDirectory(), `${signature.hash}-${panSuffix(pan)}.wav`);
  if (file.exists) return file.uri;

  const pcm = renderSignaturePcm(signature, SAMPLE_RATE);
  const bytes = encodeWavPcm16(pcm, pan, SAMPLE_RATE);
  file.create();
  file.write(bytes);
  return file.uri;
}

/** Clears every cached anchor render — used when a user resets their watermark (settings, L3.6/debt). */
export function clearAnchorCache(): void {
  const dir = anchorDirectory();
  if (dir.exists) dir.delete();
}

/**
 * Settings › "Reset watermark" (WO L3.6, mockup `09-settings.png`'s "Reset watermark" row —
 * DESIGN §2 principle 3: "cannot be changed except by 'reset watermark' ... warns that
 * retraining is needed"). A brand new per-install seed makes `buildAnchorSignature`
 * produce a completely different melody — the cached renders of the *old* one are
 * deleted too, so nothing stale can ever play again by accident (`ensureAnchorWavUri`
 * caches by the signature's own hash, so an old file left on disk would simply never be
 * looked up again either way, but deleting it is one less file for "export"/diagnostics
 * to ever have to explain).
 */
export async function resetAnchorSeed(): Promise<string> {
  const fresh = randomSeed();
  cachedAnchorSeed = fresh;
  await AsyncStorage.setItem(ANCHOR_SEED_STORAGE_KEY, fresh).catch(() => undefined);
  clearAnchorCache();
  return fresh;
}

/**
 * `signature.ts` — the **personal watermark** (DESIGN-APP §2 principle 3, decision 24 ก.ย.).
 *
 * One user has exactly **one signature sound per language**, generated once during
 * onboarding from their own seed. There is no male/female/"my voice" picker: the
 * anchor is a watermark, not a preference. The same sound is used for daytime
 * reality checks, the pre-sleep training, the night whisper and the morning recall,
 * which is the whole point — the brain only learns a cue it hears in one form.
 *
 * Two hard requirements come out of that:
 *
 * 1. **Deterministic.** The same seed must rebuild the exact same sound, on the
 *    phone today and on the VPS in a year (a user who reinstalls must not lose the
 *    cue they trained on). So: no `Math.random()`, no wall clock, no floating point
 *    that depends on the platform — the seed string is folded into 32 bits with
 *    FNV-1a and drives `mulberry32` (`rng.ts`), and every stored number is rounded
 *    before it is hashed.
 * 2. **Unique.** Two users must not share a watermark. The shape rules below keep
 *    the melody pleasant while still leaving ~10^7 distinct (notes × envelope ×
 *    timbre) combinations, and oracle G2 proves 1,000 seeds give 1,000 hashes.
 *
 * Language changes **nothing** about the melody (oracle G4): `th` and `en` share the
 * notes so the user recognises the same tune, and differ only in the `hash` and the
 * TTS phrase key — i.e. they are two different files on disk, one per language,
 * because the whispered sentence after the melody is language specific. The TTS
 * itself is rendered server-side later (L1.5 `POST /ai/tts`); only the text lives here.
 */

import { mulberry32, clamp, round, type Rng } from './rng';

// ---------------------------------------------------------------------------
// Volume rails of the anchor (DESIGN §2 principle 3.1 · §5.3)
// ---------------------------------------------------------------------------

/**
 * Hard rails for the anchor volume. Identical to `VOLUME_MIN`/`VOLUME_MAX` in
 * `types.ts` on purpose: the number the user picks on the ear-test screen is only
 * the **starting** volume of the night — after that the engine owns it (§2 rule 3.1).
 * Hard-coded here as well as in the UI so a corrupt profile can never play loud
 * (§0.5 S6).
 */
export const ANCHOR_VOLUME_MIN = 0.08;
export const ANCHOR_VOLUME_MAX = 0.35;

/** Clamp any user/stored value into the rails. `NaN`/garbage degrades to the quietest value. */
export function clampAnchorVolume(volume: number): number {
  if (typeof volume !== 'number' || !Number.isFinite(volume)) return ANCHOR_VOLUME_MIN;
  return clamp(volume, ANCHOR_VOLUME_MIN, ANCHOR_VOLUME_MAX);
}

// ---------------------------------------------------------------------------
// The whispered sentence (text only — TTS is server-side, L1.5)
// ---------------------------------------------------------------------------

/** Languages the app ships (DESIGN §2 principle 7 — both are first class). */
export type AnchorLang = 'th' | 'en';

export const ANCHOR_PHRASE_TH = 'คุณกำลังฝันอยู่…';
export const ANCHOR_PHRASE_EN = 'You are dreaming…';

/** The sentence whispered right after the melody, per language. */
export function anchorPhraseFor(lang: AnchorLang): string {
  return lang === 'th' ? ANCHOR_PHRASE_TH : ANCHOR_PHRASE_EN;
}

/**
 * Cache key of the rendered TTS clip: one clip per (phrase, language) pair.
 * The server caches on this key (L1.6 oracle "แคช TTS ต่อ (ประโยค·เสียง·ภาษา)").
 */
export function anchorPhraseKey(lang: AnchorLang): string {
  return `anchor.phrase.${lang}`;
}

// ---------------------------------------------------------------------------
// Shape of a signature
// ---------------------------------------------------------------------------

/** ADSR of one note, in milliseconds (`sustain` is a level, 0..1). */
export interface SignatureEnvelope {
  attackMs: number;
  decayMs: number;
  sustain: number;
  releaseMs: number;
}

/** What the note is made of: relative gains of harmonic partials + a little detune. */
export interface SignatureTimbre {
  /** 2–3 gains, first one is always the fundamental (1.0). */
  partialGains: number[];
  /** Detune of the upper partials, in cents — what makes it sound like an instrument, not a beep. */
  detuneCents: number;
}

/** A user's watermark, fully described. Rebuildable from `seed` alone. */
export interface AnchorSignature {
  /** The seed as it was given, normalised to a string (what actually gets hashed). */
  seed: string;
  lang: AnchorLang;
  /** 3–4 MIDI notes, all inside 48–84. */
  notes: number[];
  /** Length of each note in ms — `notes.length` entries, sums to `durationMs - tailMs`. */
  noteMs: number[];
  /** Silence-plus-release after the last note, so the clip ends on a fade, not a cut. */
  tailMs: number;
  envelope: SignatureEnvelope;
  timbre: SignatureTimbre;
  /** Total length of the rendered clip, 1200–1800 ms (DESIGN: "ลายเสียงสั้น 1.5 วิ"). */
  durationMs: number;
  /** TTS cache key of the sentence that follows the melody. */
  phraseKey: string;
  /** Stable 64-bit hex of (notes, noteMs, envelope, timbre, lang) — the file name / identity. */
  hash: string;
}

// ---------------------------------------------------------------------------
// Musical material
// ---------------------------------------------------------------------------

/**
 * Major pentatonic over two octaves. A pentatonic scale has no minor second and no
 * tritone, so **any** subset of it sounds consonant — which is exactly what a
 * random melody generator needs: it cannot draw an ugly interval by accident.
 */
const PENTATONIC_DEGREES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;

/** Root range: 55..63 keeps every note inside MIDI 48–84 (root + 21 ≤ 84). */
const ROOT_MIN_MIDI = 55;
const ROOT_MAX_MIDI = 63;

/** No jump larger than a perfect fifth — bigger leaps sound like an alarm, not a lullaby. */
const MAX_LEAP_SEMITONES = 7;

const DURATION_MIN_MS = 1200;
const DURATION_MAX_MS = 1800;

/** 10 ms of fade at both edges kills the click a hard buffer start would make. */
const EDGE_FADE_MS = 10;

/** Peak of the rendered clip. Headroom on purpose: the player scales by the night volume on top. */
const RENDER_PEAK = 0.7;

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** FNV-1a, 32 bit. Tiny, allocation-free, identical on every JS engine (`Math.imul`). */
function fnv1a32(input: string, offsetBasis = 0x811c9dc5): number {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * 64-bit-ish digest: FNV-1a forwards, then FNV-1a over the reversed string with a
 * different offset basis. Two independent 32-bit halves, so 1,000 signatures have a
 * collision chance of ~3e-14 (oracle G2 asks for zero).
 */
function stableHash(payload: string): string {
  const forward = fnv1a32(payload);
  let reversed = '';
  for (let i = payload.length - 1; i >= 0; i -= 1) reversed += payload[i];
  return hex8(forward) + hex8(fnv1a32(reversed, 0x9e3779b9));
}

// ---------------------------------------------------------------------------
// makeSignature
// ---------------------------------------------------------------------------

function pickNotes(rng: Rng): number[] {
  const root = rng.int(ROOT_MIN_MIDI, ROOT_MAX_MIDI);
  const count = rng.int(3, 4);
  const degrees = PENTATONIC_DEGREES;

  // Start in the lower half of the scale so the melody has somewhere to go up to.
  const indices: number[] = [rng.int(0, 4)];

  for (let step = 1; step < count; step += 1) {
    const current = indices[indices.length - 1] as number;
    const currentDegree = degrees[current] as number;
    const firstDegree = degrees[indices[0] as number] as number;
    const isLast = step === count - 1;

    const candidates: number[] = [];
    for (let j = 0; j < degrees.length; j += 1) {
      if (j === current) continue; // no repeated note in a row — that reads as a stutter
      const degree = degrees[j] as number;
      if (Math.abs(degree - currentDegree) > MAX_LEAP_SEMITONES) continue;
      // The last note must not be the first note again: an unresolved melody is
      // easier to recognise than a loop that returns home.
      if (isLast && degree === firstDegree) continue;
      candidates.push(j);
    }

    indices.push(candidates.length > 0 ? rng.pick(candidates) : current);
  }

  return indices.map((index) => root + (degrees[index] as number));
}

function pickEnvelope(rng: Rng): SignatureEnvelope {
  return {
    attackMs: Math.round(rng.range(12, 60)),
    decayMs: Math.round(rng.range(90, 300)),
    sustain: round(rng.range(0.25, 0.6), 3),
    releaseMs: Math.round(rng.range(260, 560)),
  };
}

function pickTimbre(rng: Rng): SignatureTimbre {
  const partialCount = rng.int(2, 3);
  const gains: number[] = [1];
  gains.push(round(rng.range(0.22, 0.58), 4));
  if (partialCount === 3) gains.push(round(rng.range(0.06, 0.24), 4));
  return { partialGains: gains, detuneCents: round(rng.range(2, 9), 2) };
}

/** Split `availableMs` over `count` notes with a little rubato, exact integers. */
function splitNoteLengths(rng: Rng, count: number, availableMs: number): number[] {
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const w = rng.range(0.8, 1.25);
    weights.push(w);
    total += w;
  }

  const lengths: number[] = [];
  let used = 0;
  for (let i = 0; i < count - 1; i += 1) {
    const ms = Math.max(120, Math.round((availableMs * (weights[i] as number)) / total));
    lengths.push(ms);
    used += ms;
  }
  lengths.push(Math.max(120, availableMs - used));
  return lengths;
}

/**
 * Build the watermark for a user.
 *
 * @param seed  anything stable and per-user (the app passes the onboarding seed
 *              string; a number is accepted and stringified).
 * @param lang  only affects `hash` and `phraseKey` — never the melody (oracle G4).
 */
export function makeSignature(seed: number | string, lang: AnchorLang): AnchorSignature {
  const seedText = String(seed);
  const rng = mulberry32(fnv1a32(seedText));

  const notes = pickNotes(rng);
  const envelope = pickEnvelope(rng);
  const timbre = pickTimbre(rng);

  const durationMs = Math.round(rng.range(DURATION_MIN_MS, DURATION_MAX_MS + 1));
  const clampedDuration = clamp(durationMs, DURATION_MIN_MS, DURATION_MAX_MS);
  // The tail holds the release of the last note: the clip must end in silence.
  const tailMs = Math.min(Math.round(envelope.releaseMs + 120), clampedDuration - 360);
  const noteMs = splitNoteLengths(rng, notes.length, clampedDuration - tailMs);
  const sumNotes = noteMs.reduce((a, b) => a + b, 0);

  const payload = JSON.stringify({ notes, noteMs, envelope, timbre, lang });

  return {
    seed: seedText,
    lang,
    notes,
    noteMs,
    tailMs: clampedDuration - sumNotes,
    envelope,
    timbre,
    durationMs: clampedDuration,
    phraseKey: anchorPhraseKey(lang),
    hash: stableHash(payload),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** MIDI note number → Hz (A4 = MIDI 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** ADSR value at `tMs` into a note that lasts `noteLenMs`, 0..1. */
function envelopeAt(envelope: SignatureEnvelope, tMs: number, noteLenMs: number): number {
  const { attackMs, decayMs, sustain, releaseMs } = envelope;
  if (tMs < 0) return 0;
  if (tMs < attackMs) return tMs / attackMs;
  if (tMs < attackMs + decayMs) {
    const k = (tMs - attackMs) / decayMs;
    return 1 - (1 - sustain) * k;
  }
  if (tMs < noteLenMs) return sustain;
  const releaseT = tMs - noteLenMs;
  if (releaseT >= releaseMs) return 0;
  return sustain * (1 - releaseT / releaseMs);
}

/**
 * Render the melody to mono PCM.
 *
 * Additive synthesis: every note is 2–3 detuned harmonic partials shaped by the
 * ADSR, notes overlap through their release so the phrase breathes instead of
 * stepping. The buffer is then faded 10 ms at each edge (no click) and peak
 * normalised to {@link RENDER_PEAK} — loudness is the player's job, and the
 * anchor must sit at a known level relative to the ambience bed (DESIGN §5.3).
 *
 * Pure maths, no `AudioContext`: this runs in vitest on the VPS and on the phone,
 * which is how the watermark can be proven identical in both places.
 */
export function renderSignaturePcm(signature: AnchorSignature, sampleRate = 48000): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`renderSignaturePcm: sampleRate must be > 0, got ${String(sampleRate)}`);
  }

  const length = Math.max(1, Math.round((signature.durationMs / 1000) * sampleRate));
  const pcm = new Float32Array(length);
  const { envelope, timbre, notes, noteMs } = signature;
  const gainSum = timbre.partialGains.reduce((a, b) => a + Math.abs(b), 0) || 1;

  let noteStartMs = 0;
  for (let n = 0; n < notes.length; n += 1) {
    const midi = notes[n] as number;
    const lenMs = noteMs[n] as number;
    const baseHz = midiToHz(midi);
    const startSample = Math.round((noteStartMs / 1000) * sampleRate);
    const voiceSamples = Math.round(((lenMs + envelope.releaseMs) / 1000) * sampleRate);

    for (let i = 0; i < voiceSamples; i += 1) {
      const target = startSample + i;
      if (target >= length) break;
      const tMs = (i / sampleRate) * 1000;
      const env = envelopeAt(envelope, tMs, lenMs);
      if (env <= 0) continue;

      let sample = 0;
      for (let p = 0; p < timbre.partialGains.length; p += 1) {
        const gain = timbre.partialGains[p] as number;
        // Upper partials drift slightly sharp — a perfect harmonic stack sounds synthetic.
        const detune = 1 + (timbre.detuneCents * p) / 1200;
        const hz = baseHz * (p + 1) * detune;
        sample += gain * Math.sin(2 * Math.PI * hz * (i / sampleRate));
      }
      pcm[target] = (pcm[target] as number) + (env * sample) / gainSum;
    }

    noteStartMs += lenMs;
  }

  // Edge fades first, then normalise: that way sample 0 and sample n-1 are exactly
  // zero and the peak is exactly RENDER_PEAK (oracle G5).
  const fade = Math.max(1, Math.round((EDGE_FADE_MS / 1000) * sampleRate));
  for (let i = 0; i < fade && i < length; i += 1) {
    const factor = i / fade;
    pcm[i] = (pcm[i] as number) * factor;
    const tail = length - 1 - i;
    if (tail > i) pcm[tail] = (pcm[tail] as number) * factor;
  }

  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const v = Math.abs(pcm[i] as number);
    if (Number.isNaN(v)) {
      pcm[i] = 0;
      continue;
    }
    if (v > peak) peak = v;
  }
  if (peak > 0) {
    const scale = RENDER_PEAK / peak;
    for (let i = 0; i < length; i += 1) pcm[i] = (pcm[i] as number) * scale;
  }

  return pcm;
}

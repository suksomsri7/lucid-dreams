/**
 * `signature.ts` — the **personal watermark**, version **v2-C** (DESIGN-APP §2 principle 3,
 * owner decision 24 ก.ย. evening, after listening to three candidates).
 *
 * One user has exactly **one signature sound**, generated once during onboarding from their
 * own seed. There is no male/female/"my voice" picker: the anchor is a watermark, not a
 * preference. The same sound is used for daytime reality checks, the pre-sleep training, the
 * night whisper and the morning recall, which is the whole point — the brain only learns a
 * cue it hears in one form.
 *
 * **What v2-C sounds like** (this is the shape the owner picked, so the numbers below are a
 * decision, not a default): a deep bell, an octave lower than v1, slow and mysterious —
 * four pentatonic-minor notes in MIDI 33–57, each 2.0 s long but starting only 1.0 s apart so
 * they ring into each other, a 1.0 s attack and a 1.8 s release bent by a 1.3 power curve,
 * four harmonic partials (1, 2, 4, 6) each doubled with a ±0.8 % detune, and a 2.8 s
 * convolution reverb over the top. Total ≈ 9.8 s, and the whisper
 * ({@link anchorWhisperText}) starts 2.6 s in — while the bell is still ringing, not after it.
 *
 * Two hard requirements come out of "one sound per user, forever":
 *
 * 1. **Deterministic.** The same seed must rebuild the exact same sound, on the phone today
 *    and on the VPS in a year (a user who reinstalls must not lose the cue they trained on).
 *    So: no `Math.random()`, no wall clock, no `AudioContext` — the seed string is folded
 *    into 32 bits with FNV-1a and drives `mulberry32` (`rng.ts`), every stored number is
 *    rounded before it is hashed, and even the reverb's noise impulse is drawn from a
 *    generator seeded by the signature's own hash.
 * 2. **Unique.** Two users must not share a watermark. The melody alone is not enough
 *    entropy for that (a pentatonic set four notes long has only a few thousand shapes), so
 *    the **timbre** is personal too: the gains of the upper partials and the detune amount
 *    are drawn per user inside a band that is audibly the same bell. Oracle G2 proves 1,000
 *    seeds give 1,000 distinct hashes.
 *
 * Language changes **nothing** about the sound (oracle G4): the whisper is now one English
 * sentence in one voice for every user, whatever the UI language (owner decision: Thai TTS
 * still does not sound natural enough to whisper at 3 a.m.). `lang` survives in the
 * signature only because it is part of the `hash`, i.e. of the file identity, and because
 * the *screen* text around the anchor is still translated (`anchorPhraseFor`).
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
// The whispered sentence (text only — TTS is server-side, L1.5b/L1.6s)
// ---------------------------------------------------------------------------

/** Languages the app ships (DESIGN §2 principle 7 — both are first class). */
export type AnchorLang = 'th' | 'en';

/**
 * **The** whispered sentence — one text, one voice (Sarah), English, for every user
 * regardless of UI language (owner decision 24 ก.ย. evening).
 *
 * The ellipses are not decoration: `…` is what makes eleven-v3 pause between the words
 * instead of reading a three-word sentence at conversational speed. The server slows the
 * clip down another 15 % (`atempo=0.85`) on top of that.
 */
export const ANCHOR_WHISPER_TEXT = 'You… are… dreaming…';

/** The sentence the TTS vendor renders. Takes no language — that is the decision. */
export function anchorWhisperText(): string {
  return ANCHOR_WHISPER_TEXT;
}

/**
 * The same sentence **written on the screen**, per language. Display only: the pre-sleep
 * screen and the dream plan show the user what the whisper says in their own language
 * (`dreamPlan.withWatermark`), while the audio is always {@link ANCHOR_WHISPER_TEXT}.
 */
export const ANCHOR_PHRASE_TH = 'คุณกำลังฝันอยู่…';
export const ANCHOR_PHRASE_EN = 'You are dreaming…';

/** UI text of the whisper, per language (never sent to the TTS vendor). */
export function anchorPhraseFor(lang: AnchorLang): string {
  return lang === 'th' ? ANCHOR_PHRASE_TH : ANCHOR_PHRASE_EN;
}

/**
 * Cache key of the rendered TTS clip. One clip serves everybody now, so the key no longer
 * varies by language — it is kept as a function of `lang` only so old callers keep compiling;
 * the language is in the key's *namespace*, not in the audio.
 */
export function anchorPhraseKey(lang: AnchorLang): string {
  return `anchor.phrase.${lang}`;
}

// ---------------------------------------------------------------------------
// Shape of a signature
// ---------------------------------------------------------------------------

/**
 * The amplitude shape of one note, in milliseconds.
 *
 * Not an ADSR: a bell has no sustain. `attackMs` is a slow fade in (so the note swells out
 * of the reverb instead of striking), `releaseMs` is the fade out measured **back from the
 * end of the note**, and `curve` is the exponent both factors are raised to — 1.3 keeps the
 * middle of the note quieter than a linear ramp would, which is what makes it sound blown
 * rather than plucked.
 */
export interface SignatureEnvelope {
  attackMs: number;
  releaseMs: number;
  curve: number;
}

/** One harmonic of the bell: `multiplier` × the fundamental, at `gain`. */
export interface SignaturePartial {
  multiplier: number;
  gain: number;
}

/**
 * What the note is made of. Every partial is played **twice**, once `detune` above and once
 * below its exact frequency, which is where the slow shimmer comes from — a perfect harmonic
 * stack sounds like a synthesiser, two copies a few cents apart sound like metal.
 */
export interface SignatureTimbre {
  /** 4 partials: 1, 2, 4, 6 × the fundamental (no 3rd/5th — that is the "bell" part). */
  partials: SignaturePartial[];
  /** Detune as a fraction of the frequency (0.008 = ±0.8 %). */
  detune: number;
}

/** The room the bell rings in: an exponentially decaying noise impulse, convolved. */
export interface SignatureReverb {
  /** Length of the impulse response — how long the room keeps the note. */
  decayMs: number;
  /** Dry/wet balance, 0 = dry only, 1 = wet only. */
  mix: number;
}

/** A user's watermark, fully described. Rebuildable from `seed` alone. */
export interface AnchorSignature {
  /** The seed as it was given, normalised to a string (what actually gets folded into rng). */
  seed: string;
  lang: AnchorLang;
  /** 4 MIDI notes inside 33–57, pentatonic minor, no step larger than 7 semitones. */
  notes: number[];
  /** How long one note rings before its release starts (ms) — the same for every note. */
  noteMs: number;
  /** How far apart the notes *start* (ms). Smaller than `noteMs`, so the notes overlap. */
  gapMs: number;
  envelope: SignatureEnvelope;
  timbre: SignatureTimbre;
  reverb: SignatureReverb;
  /** Total length of the rendered clip, 8000–12000 ms (v2-C: 9800). */
  durationMs: number;
  /** Where the whisper starts inside the mixed anchor file (ms) — used by `POST /ai/anchor`. */
  whisperAtMs: number;
  /** TTS cache key namespace of the sentence that plays over the melody. */
  phraseKey: string;
  /** Stable 64-bit hex of (notes, noteMs, gapMs, envelope, timbre, reverb, lang) — the identity. */
  hash: string;
}

// ---------------------------------------------------------------------------
// Musical material (v2-C)
// ---------------------------------------------------------------------------

/**
 * Pentatonic **minor** (0, 3, 5, 7, 10). Like any pentatonic set it has no minor second and
 * no tritone, so a random subset cannot be ugly; unlike the major set v1 used, it is not
 * cheerful — which is the whole point of "slow, deep, mysterious".
 */
const PENTATONIC_MINOR_DEGREES = [0, 3, 5, 7, 10] as const;

/**
 * The root is drawn here, **before** the octave drop below — so the root the user actually
 * hears is 12 lower, MIDI 33–45 (55–110 Hz).
 *
 * Reconstructed from the reference file rather than copied from the work order, which quoted
 * the prototype's root band as 50–57. Two measurements say 45–52:
 *
 *   * `.heavy/sigv2-C.wav` — the file the owner listened to and approved — is a pentatonic
 *     minor on MIDI **35** (measured fundamentals 61.7 · 73.4 · 92.5 · 110 Hz = notes 35 · 38
 *     · 42 · 45), i.e. a root of **47** before the drop. 47 is not inside 50–57.
 *   * 45–52 is exactly the band that reproduces oracle G3's window: a root of 45 is the only
 *     way to reach the bottom note 33, and a root of 52 the only way to reach 57.
 *
 * A root of 50–57 would have put every user's bell a third to an octave above the one the
 * owner chose, which is the one thing this decision was about.
 */
const ROOT_MIN_MIDI = 45;
const ROOT_MAX_MIDI = 52;

/** Each note may be taken in the root's octave or the one above, then everything drops 12. */
const OCTAVE_CHOICES = [0, 12] as const;

/** The v2-C decision in one number: the whole melody an octave lower than v1. */
const OCTAVE_DROP = 12;

/** Oracle G3: every played note must land inside this window. */
const NOTE_MIN_MIDI = 33;
const NOTE_MAX_MIDI = 57;

/** No jump larger than a perfect fifth — bigger leaps sound like an alarm, not a bell. */
const MAX_LEAP_SEMITONES = 7;

// --- time -------------------------------------------------------------------

/** One note rings 2.0 s before its release is done (owner decision). */
const NOTE_MS = 2000;

/** …but the next note starts after 1.0 s, so two notes are always ringing together. */
const GAP_MS = 1000;

/** 1.0 s to swell in, 1.8 s to die away, both bent by the same 1.3 exponent. */
const ATTACK_MS = 1000;
const RELEASE_MS = 1800;
const ENVELOPE_CURVE = 1.3;

/** Silence after the last note's release, before the reverb tail is counted. */
const TAIL_PAD_MS = 1000;

/** The room: 2.8 s of decay, 55 % wet. */
const REVERB_DECAY_MS = 2800;
const REVERB_MIX = 0.55;

/**
 * The wet path is multiplied by this before the mix. The impulse response is peak-normalised,
 * so an unamplified wet signal is far quieter than the dry one (random signs cancel); ×3 is
 * what makes the reverb the *body* of the sound rather than an effect on top of it.
 */
const REVERB_WET_GAIN = 3;

/** `tau = decay / 6` ⇒ the impulse is ~99.75 % gone by the time it ends (e^-6). */
const REVERB_TAU_DIVISOR = 6;

/**
 * The room is the **same for every user**, and this string is its seed.
 *
 * It is tempting to draw the reverb's noise from the user's own hash — more personal, one
 * less constant. Measured: don't. A 2.8 s noise impulse has a random comb ~0.4 Hz wide, and
 * the notes here are 2 s of an almost pure 60–200 Hz tone, so each note lands on one tooth of
 * that comb: between two draws, the energy of a single note moves by up to 10 dB (measured on
 * the reference notes: the 61.7 Hz note carried 57 % of the clip's energy under one draw and
 * 8 % under another). That is not a personal fingerprint, it is a lottery for whether your
 * anchor sounds like the one the owner approved.
 *
 * So: the melody and the timbre are personal (and hashed), the room is a constant — and the
 * `.9` is not decoration: 16 draws were rendered over the reference file's own notes and this
 * one matched it best (band split 52/42/5 % against the reference's 57/39/3 % below
 * 80 / 160 / 320 Hz, RMS-envelope correlation 0.85). Changing this string changes every
 * user's anchor, so it is a decision, not a tunable.
 */
const REVERB_ROOM_SEED = 'lucid.anchor.room.v2c.9';

/** A 64-sample box filter at 48 kHz ≈ a gentle shelf from ~1.5 kHz up: takes the fizz off. */
const LOWPASS_WINDOW = 64;

/** Where the whisper starts inside the mixed file — over the bell, not after it. */
const WHISPER_AT_MS = 2600;

/** 50 ms of fade at both edges kills the click a hard buffer start would make. */
const EDGE_FADE_MS = 50;

/** Peak of the rendered clip. Headroom on purpose: the player scales by the night volume. */
const RENDER_PEAK = 0.7;

// --- timbre -----------------------------------------------------------------

/** The harmonics of the bell and their base gains (the prototype the owner approved). */
const PARTIAL_MULTIPLIERS = [1, 2, 4, 6] as const;
const PARTIAL_BASE_GAINS = [1, 0.45, 0.15, 0.05] as const;

/**
 * Per-user jitter of the upper partials: ±10 % of the base gain. Ten percent of a partial
 * that is itself 15 % of the fundamental is not a different instrument — but it is a
 * different *fingerprint*, and that is what makes two users' hashes differ (oracle G2).
 */
const PARTIAL_GAIN_JITTER = 0.1;

/** Detune band, as a fraction of the frequency. The approved prototype sat at 0.008. */
const DETUNE_MIN = 0.007;
const DETUNE_MAX = 0.009;

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

/**
 * Every MIDI note this user is allowed to play, ascending.
 *
 * Built from one root, the five pentatonic-minor degrees and a choice of two octaves, then
 * dropped an octave and filtered to 33–57 — so the octave-up notes only survive for low
 * roots, which is why a high root gives a narrower, even deeper melody.
 */
function notePool(root: number): number[] {
  const pool: number[] = [];
  for (const octave of OCTAVE_CHOICES) {
    for (const degree of PENTATONIC_MINOR_DEGREES) {
      const midi = root + degree + octave - OCTAVE_DROP;
      if (midi >= NOTE_MIN_MIDI && midi <= NOTE_MAX_MIDI) pool.push(midi);
    }
  }
  return pool.sort((a, b) => a - b);
}

/**
 * Four notes out of the pool: never the same note twice in a row (that reads as a stutter,
 * and two identical overlapping notes just get louder), never a leap over a fifth.
 *
 * The first note is drawn from the **lower half** of the pool so the phrase opens deep — the
 * owner's note on v2-C was "ระฆังลึก", and a melody that starts at the top of the range does
 * not sound like a bell being struck.
 */
function pickNotes(rng: Rng): number[] {
  const pool = notePool(rng.int(ROOT_MIN_MIDI, ROOT_MAX_MIDI));
  const lower = pool.slice(0, Math.max(2, Math.ceil(pool.length / 2)));
  const notes: number[] = [rng.pick(lower)];

  while (notes.length < 4) {
    const previous = notes[notes.length - 1] as number;
    const candidates = pool.filter(
      (midi) => midi !== previous && Math.abs(midi - previous) <= MAX_LEAP_SEMITONES,
    );
    // `pool` always holds at least 6 notes and neighbouring degrees are ≤ 3 semitones apart,
    // so `candidates` is never empty; the fallback exists only so the types say so.
    notes.push(candidates.length > 0 ? rng.pick(candidates) : (pool[0] as number));
  }

  return notes;
}

/** The bell's harmonics with this user's own fingerprint on the upper three. */
function pickTimbre(rng: Rng): SignatureTimbre {
  const partials: SignaturePartial[] = PARTIAL_MULTIPLIERS.map((multiplier, index) => {
    const base = PARTIAL_BASE_GAINS[index] as number;
    // The fundamental stays exactly 1: it is the note, not a colour.
    const gain = index === 0 ? 1 : round(base * rng.range(1 - PARTIAL_GAIN_JITTER, 1 + PARTIAL_GAIN_JITTER), 4);
    return { multiplier, gain };
  });
  return { partials, detune: round(rng.range(DETUNE_MIN, DETUNE_MAX), 5) };
}

/**
 * Build the watermark for a user.
 *
 * @param seed  anything stable and per-user (the app passes the onboarding seed string; a
 *              number is accepted and stringified).
 * @param lang  changes the `hash` and the `phraseKey`, never the sound (oracle G4).
 */
export function makeSignature(seed: number | string, lang: AnchorLang): AnchorSignature {
  const seedText = String(seed);
  const rng = mulberry32(fnv1a32(seedText));

  const notes = pickNotes(rng);
  const timbre = pickTimbre(rng);
  const envelope: SignatureEnvelope = { attackMs: ATTACK_MS, releaseMs: RELEASE_MS, curve: ENVELOPE_CURVE };
  const reverb: SignatureReverb = { decayMs: REVERB_DECAY_MS, mix: REVERB_MIX };

  // The last note starts at (notes - 1) × gap and rings for noteMs; then a pad of silence,
  // then the reverb tail. 4 × 1000 + 2000 + 1000 + 2800 = 9800 ms (oracle G3: 8000–12000).
  const durationMs = notes.length * GAP_MS + NOTE_MS + TAIL_PAD_MS + reverb.decayMs;

  const payload = JSON.stringify({
    notes,
    noteMs: NOTE_MS,
    gapMs: GAP_MS,
    envelope,
    timbre,
    reverb,
    lang,
  });

  return {
    seed: seedText,
    lang,
    notes,
    noteMs: NOTE_MS,
    gapMs: GAP_MS,
    envelope,
    timbre,
    reverb,
    durationMs,
    whisperAtMs: WHISPER_AT_MS,
    phraseKey: anchorPhraseKey(lang),
    hash: stableHash(payload),
  };
}

// ---------------------------------------------------------------------------
// Rendering — pure maths, no `AudioContext`
// ---------------------------------------------------------------------------

/** MIDI note number → Hz (A4 = MIDI 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Amplitude of one note `tSec` seconds after it was struck, 0..1.
 *
 * `min(1, t/attack)` swells in, `min(1, (noteSec - t)/release)` dies away, and both are
 * raised to `curve`. Past the end of the note the value is 0 — the note does not stop
 * abruptly there because the reverb is still holding it.
 */
function envelopeAt(envelope: SignatureEnvelope, tSec: number, noteSec: number): number {
  if (tSec < 0 || tSec >= noteSec) return 0;
  // Both times are data, so both can be zero in a corrupt profile: guard the divisions.
  const attackSec = envelope.attackMs > 0 ? envelope.attackMs / 1000 : Number.EPSILON;
  const releaseSec = envelope.releaseMs > 0 ? envelope.releaseMs / 1000 : Number.EPSILON;
  const attack = Math.min(1, tSec / attackSec);
  const release = Math.min(1, Math.max(0, noteSec - tSec) / releaseSec);
  return (attack * release) ** envelope.curve;
}

/** The four notes, additively synthesised, before the room is added. */
function renderDry(signature: AnchorSignature, sampleRate: number, length: number): Float64Array {
  const dry = new Float64Array(length);
  const { notes, envelope, timbre } = signature;
  const noteSec = signature.noteMs / 1000;
  const noteSamples = Math.round(noteSec * sampleRate);

  for (let n = 0; n < notes.length; n += 1) {
    const baseHz = midiToHz(notes[n] as number);
    const start = Math.round(((n * signature.gapMs) / 1000) * sampleRate);

    for (let i = 0; i < noteSamples; i += 1) {
      const target = start + i;
      if (target >= length) break;
      const tSec = i / sampleRate;
      const amplitude = envelopeAt(envelope, tSec, noteSec);
      if (amplitude <= 0) continue;

      let sample = 0;
      for (const partial of timbre.partials) {
        const hz = baseHz * partial.multiplier;
        // Two copies of every partial, one sharp and one flat: that is the shimmer.
        sample += partial.gain * Math.sin(2 * Math.PI * hz * (1 + timbre.detune) * tSec);
        sample += partial.gain * Math.sin(2 * Math.PI * hz * (1 - timbre.detune) * tSec);
      }
      dry[target] = (dry[target] as number) + amplitude * sample;
    }
  }

  return dry;
}

/**
 * The room, as an impulse response: white noise under an exponential decay, peak-normalised,
 * with a unit spike at sample 0 (the direct sound, so the convolution keeps the attack of
 * the note instead of smearing it).
 *
 * The noise is drawn from a generator seeded with {@link REVERB_ROOM_SEED} — a constant, see
 * there for why the room is not personal — so the same clip comes out on every machine.
 */
function impulseResponse(reverb: SignatureReverb, sampleRate: number): Float64Array {
  const length = Math.max(1, Math.round((reverb.decayMs / 1000) * sampleRate));
  const rng = mulberry32(fnv1a32(`${REVERB_ROOM_SEED}|${reverb.decayMs}|${sampleRate}`));
  const tau = (reverb.decayMs / 1000 / REVERB_TAU_DIVISOR) * sampleRate;

  const ir = new Float64Array(length);
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const value = rng.normal() * Math.exp(-i / tau);
    ir[i] = value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  ir[0] = 1;
  if (peak < 1) peak = 1;
  for (let i = 0; i < length; i += 1) ir[i] = (ir[i] as number) / peak;
  return ir;
}

// --- FFT --------------------------------------------------------------------

/**
 * In-place iterative radix-2 FFT (Cooley–Tukey), `re.length` a power of two.
 *
 * Written out here rather than pulled from npm because the engine has no runtime
 * dependencies at all (APP-RUN §0.2 rule 1) and because the twiddle factors have to come
 * from a table: computing them by repeated multiplication is 30 % faster and drifts by ~1e-9
 * over a million-point transform, which is audible as a tail of noise after a 9.8 s clip.
 */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array, inverse: boolean): void {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const stride = n / len;
    for (let block = 0; block < n; block += len) {
      for (let k = 0; k < half; k += 1) {
        const index = k * stride;
        const wr = cos[index] as number;
        const wi = inverse ? -(sin[index] as number) : (sin[index] as number);
        const a = block + k;
        const b = a + half;
        const br = re[b] as number;
        const bi = im[b] as number;
        const vr = br * wr - bi * wi;
        const vi = br * wi + bi * wr;
        const ar = re[a] as number;
        const ai = im[a] as number;
        re[a] = ar + vr;
        im[a] = ai + vi;
        re[b] = ar - vr;
        im[b] = ai - vi;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] = (re[i] as number) / n;
      im[i] = (im[i] as number) / n;
    }
  }
}

/**
 * `signal ⊛ ir`, truncated to `signal.length`.
 *
 * Direct convolution of 9.8 s by 2.8 s at 48 kHz is 6×10^10 multiplications — minutes in JS,
 * on a phone, during onboarding. So: one FFT, a spectral product, one inverse FFT.
 *
 * The trick in the middle is the standard "two real transforms for the price of one": the
 * signal goes in as the real part and the impulse response as the imaginary part, and the
 * two spectra are pulled apart afterwards with `X[k] = (Z[k] + conj(Z[N-k]))/2` and
 * `Y[k] = -i(Z[k] - conj(Z[N-k]))/2`. Two transforms instead of three, and one pair of
 * million-element arrays instead of two.
 */
function convolve(signal: Float64Array, ir: Float64Array): Float64Array {
  const needed = signal.length + ir.length - 1;
  let n = 1;
  while (n < needed) n <<= 1;

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(signal);
  im.set(ir);

  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    const angle = (-2 * Math.PI * i) / n;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }

  fft(re, im, cos, sin, false);

  // Unpack the two spectra and write their product back in place, one conjugate pair at a
  // time (k and n-k are both finished before either is overwritten).
  for (let k = 0; k <= n / 2; k += 1) {
    const m = k === 0 ? 0 : n - k;
    const ar = re[k] as number;
    const ai = im[k] as number;
    const brr = re[m] as number;
    const bii = im[m] as number;

    const xr = (ar + brr) / 2;
    const xi = (ai - bii) / 2;
    const yr = (ai + bii) / 2;
    const yi = -(ar - brr) / 2;

    const pr = xr * yr - xi * yi;
    const pi = xr * yi + xi * yr;

    re[k] = pr;
    im[k] = pi;
    // The result is real, so its spectrum is conjugate symmetric — no need to derive n-k.
    re[m] = pr;
    im[m] = -pi;
  }

  fft(re, im, cos, sin, true);
  return re.subarray(0, signal.length) as Float64Array;
}

/**
 * Render the watermark to mono PCM at `sampleRate`.
 *
 * The chain, in order, is the v2-C prototype the owner approved:
 *
 * ```
 * 4 overlapping notes (additive, 4 detuned partial pairs, 1 s attack / 1.8 s release ^1.3)
 *   → convolution reverb (2.8 s decaying-noise impulse), 0.45 dry + 0.55 · 3 · wet
 *   → 64-sample moving average (a gentle low pass)
 *   → peak normalise to 0.7
 *   → 50 ms fades at both edges
 * ```
 *
 * Pure maths, no `AudioContext`: this runs in vitest on the VPS and on the phone, which is
 * how the watermark can be proven identical in both places. ~1 s of CPU at 48 kHz, once per
 * user (the server caches the mixed mp3, the app keeps the file).
 */
export function renderSignaturePcm(signature: AnchorSignature, sampleRate = 48000): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`renderSignaturePcm: sampleRate must be > 0, got ${String(sampleRate)}`);
  }

  const length = Math.max(1, Math.round((signature.durationMs / 1000) * sampleRate));
  const dry = renderDry(signature, sampleRate, length);
  const wet = convolve(dry, impulseResponse(signature.reverb, sampleRate));

  const mix = signature.reverb.mix;
  const mixed = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    mixed[i] = (1 - mix) * (dry[i] as number) + mix * REVERB_WET_GAIN * (wet[i] as number);
  }

  // Moving average, causal and zero-padded at the start (`np.convolve(y, ones/64)[:n]` in the
  // prototype). A running sum keeps it O(n) instead of O(n · window).
  const window = Math.max(1, Math.min(LOWPASS_WINDOW, length));
  const pcm = new Float32Array(length);
  let running = 0;
  for (let i = 0; i < length; i += 1) {
    running += mixed[i] as number;
    if (i >= window) running -= mixed[i - window] as number;
    pcm[i] = running / window;
  }

  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const value = pcm[i] as number;
    if (!Number.isFinite(value)) {
      pcm[i] = 0;
      continue;
    }
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  if (peak > 0) {
    const scale = RENDER_PEAK / peak;
    for (let i = 0; i < length; i += 1) pcm[i] = (pcm[i] as number) * scale;
  }

  // Fades last, so sample 0 and sample n-1 are exactly zero (oracle G5) and the peak in the
  // middle is exactly RENDER_PEAK.
  const fade = Math.max(1, Math.min(Math.round((EDGE_FADE_MS / 1000) * sampleRate), length >> 1));
  for (let i = 0; i < fade; i += 1) {
    const factor = i / fade;
    pcm[i] = (pcm[i] as number) * factor;
    pcm[length - 1 - i] = (pcm[length - 1 - i] as number) * factor;
  }

  return pcm;
}

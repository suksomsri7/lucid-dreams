/**
 * `providers/tts.ts` — the whispered half of the anchor.
 *
 * The anchor is *melody + one whispered sentence* (DESIGN §2 principle 3). The melody is
 * synthesised on the phone from the user's seed (`packages/engine/src/signature.ts`); the
 * sentence needs a real text-to-speech voice, and **OpenRouter does not serve TTS** — it
 * is a chat-completions router only.
 *
 * So this file deliberately ships an *interface and a hole*:
 *
 *   * `TtsProvider` — the contract a vendor adapter has to satisfy (one function,
 *     `text/lang/voice → audio bytes`). Nothing else in the server knows who renders it.
 *   * **no default vendor.** `resolveTtsProvider()` returns `null` unless a vendor is
 *     configured, and `POST /ai/tts` then answers `501 NOT_CONFIGURED`. A wrong vendor
 *     chosen today would be baked into every user's watermark file name tomorrow, so the
 *     choice waits for the owner (candidates are listed in `ledger/wo-notes/L1.5.md`).
 *   * `mockTtsProvider` — a deterministic silent WAV, so QC can prove the cache, the
 *     content type and the 32 KB rails without spending a cent.
 *
 * The sentence is at most 120 characters and is the **same for everybody** in a given
 * language, which is why the server caches on `sha256(text|lang|voice)` and not per user:
 * one render, then every device downloads the same bytes (§6 "แคชต่อธีม").
 */

export type TtsLang = 'th' | 'en';

/** One voice, ever: the whisper. There is no male/female/"my voice" picker (§2 principle 3). */
export type TtsVoice = 'whisper';

export interface TtsRequest {
  text: string;
  lang: TtsLang;
  /** The *style*: always the whisper. Not a vendor voice id — see `voiceName`. */
  voice: TtsVoice;
  /**
   * Vendor voice id (fal/ElevenLabs calls them `Sarah`, `Laura`, `Charlotte`…).
   * Absent ⇒ the adapter's own default. It is **not** a user-facing preference: the
   * owner pins one name per install, the watermark stays one voice for everybody
   * (§2 principle 3). `/ai/anchor` only forwards it so the owner can A/B two voices
   * before pinning one.
   */
  voiceName?: string;
}

/**
 * What an adapter hands back. A bare `Buffer` is still accepted — the oracle's fake
 * provider returns one and so does {@link mockTtsProvider} — but a real adapter knows
 * the container it downloaded and says so.
 */
export interface TtsAudio {
  buffer: Buffer;
  contentType: 'audio/wav' | 'audio/mpeg';
}

export type TtsProvider = (req: TtsRequest) => Promise<Buffer | TtsAudio>;

/** Longest sentence we will ever render — the anchor phrase plus room for a future variant. */
export const TTS_MAX_TEXT = 200; // 200 = DreamPlanSchema seedLines max (26 ก.ย.: เดิม 120 ทำให้ประโยค AI ยาวไม่ถูกพูด)

/**
 * Sniff the container instead of trusting the vendor's `content-type`.
 *
 * The app only has to know "is this an MP3 or a WAV" to hand it to the right decoder, and
 * both are recognisable from their first bytes: `RIFF....WAVE` for WAV, `ID3` or a frame
 * sync (`0xFF 0xEx`) for MPEG audio. Anything else is refused by the caller rather than
 * streamed to a sleeping user's headphones.
 */
export function sniffAudioContentType(audio: Buffer): 'audio/wav' | 'audio/mpeg' | null {
  if (audio.length < 4) return null;
  if (audio.toString('latin1', 0, 4) === 'RIFF' && audio.toString('latin1', 8, 12) === 'WAVE') return 'audio/wav';
  if (audio.toString('latin1', 0, 3) === 'ID3') return 'audio/mpeg';
  const b0 = audio[0] ?? 0;
  const b1 = audio[1] ?? 0;
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return 'audio/mpeg';
  // A vendor that answers with a WAV whose header we did not recognise is still a WAV as
  // far as the player is concerned; guessing `audio/wav` here would hide a JSON error page.
  return null;
}

/**
 * Normalise whatever the adapter returned into `{buffer, contentType}` — or `null`.
 *
 * The sniff wins over the adapter's own claim on purpose: a vendor that answers `200
 * application/json {"error":…}` while saying `audio/mpeg` must not reach a sleeping
 * user's headphones, and an adapter bug must not be able to mislabel a file that the
 * phone then fails to decode at 3 a.m.
 */
export function normalizeTtsAudio(result: Buffer | TtsAudio): TtsAudio | null {
  const buffer = Buffer.isBuffer(result) ? result : result?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) return null;
  const sniffed = sniffAudioContentType(buffer);
  if (!sniffed) return null;
  return { buffer, contentType: sniffed };
}

/** A silent mono 16-bit WAV of `ms` milliseconds — same bytes every time (QC fixture). */
export function wavSilence(ms: number, sampleRate = 24000): Buffer {
  const frames = Math.max(1, Math.round((ms / 1000) * sampleRate));
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'latin1');
  buffer.write('fmt ', 12, 'latin1');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'latin1');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

/** QC/dev provider: 900 ms of silence, deterministic, no network, no vendor account. */
export const mockTtsProvider: TtsProvider = async (req) => {
  const ms = 600 + req.text.length * 20;
  return wavSilence(Math.min(ms, 4000));
};

/**
 * Pick the provider from the environment.
 *
 * Two branches that need nothing but the environment: `TTS_PROVIDER=mock` for QC and the
 * default `null` (the endpoints answer 501). **`TTS_PROVIDER=fal` is wired in `main.ts`**,
 * not here: it needs `FAL_KEY` plus the process logger, and importing `tts-fal.ts` from
 * this file would make the two modules import each other.
 */
export function resolveTtsProvider(env: Record<string, string | undefined>): TtsProvider | null {
  switch (env.TTS_PROVIDER) {
    case 'mock':
      return mockTtsProvider;
    default:
      return null;
  }
}

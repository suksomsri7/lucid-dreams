/**
 * `providers/tts-fal.ts` — the whisper, rendered by ElevenLabs `eleven-v3` **through fal.ai**
 * (owner decision, 24 ก.ย.: the account, the billing and the key already exist for fal, so
 * this is one key instead of two and no new vendor contract — L1.5 debt D1 is closed here).
 *
 * The wire is one call, and it is deliberately boring:
 *
 *   POST https://fal.run/fal-ai/elevenlabs/tts/eleven-v3
 *   Authorization: Key <FAL_KEY>
 *   { "text": "[whispers] คุณกำลังฝันอยู่…", "voice": "Sarah", "stability": 0.6,
 *     "language_code": "th" }
 *   → 200 { "audio": { "url": "https://…/output.mp3", "content_type": "audio/mpeg" } }
 *
 * Three things are worth knowing before changing anything here:
 *
 * 1. **The whisper is an audio tag, not a parameter.** `eleven-v3` takes direction inline:
 *    the text is prefixed with `[whispers]` and the model performs it. There is no
 *    `style: 'whispering'` field to set, which is exactly why the L1.5 note's candidate
 *    (ง) Azure SSML is not needed — see {@link WHISPER_TAG}.
 * 2. **The answer is a URL, not bytes.** fal stores the render on its CDN and returns a
 *    link, so the adapter is two round trips: render, then download. Both live inside one
 *    deadline (`timeoutMs`), because a caller that waited 30 s for the JSON has already
 *    used the patience it had for the audio.
 * 3. **$0.10 per 1,000 characters.** The anchor sentence is ~22 characters, so one render
 *    costs about two-tenths of a cent — and it is cached forever (`tts_cache`, one row per
 *    sentence·language·voice). The price only matters if someone renders in a loop, which
 *    is why every caller goes through the cache in `server.ts` and never straight here.
 *
 * Nothing in this file logs the key or the sentence. The key never leaves the header it is
 * written into; the text is reported as `textLen` only (APP-RUN §0.5 S1/S5).
 */

import { silentLogger, type Logger } from '../logger';
import { sniffAudioContentType, type TtsAudio, type TtsProvider, type TtsRequest } from './tts';

/** The fal endpoint for ElevenLabs eleven-v3 (owner decision, 24 ก.ย.). */
export const FAL_TTS_ENDPOINT = 'https://fal.run/fal-ai/elevenlabs/tts/eleven-v3';

/**
 * The audio tag that makes eleven-v3 whisper. Prefixed to the sentence, not spoken.
 * Keep the trailing space out of the constant so the join is visible at the call site.
 */
export const WHISPER_TAG = '[whispers]';

/** Owner's sample render used this voice and this stability (24 ก.ย.). Both are overridable. */
export const FAL_DEFAULT_VOICE = 'Sarah';
export const FAL_DEFAULT_STABILITY = 0.6;

/**
 * A 120-character sentence renders to ~40 KB of mp3. Anything past 5 MB is not our
 * sentence — it is a wrong URL or a vendor incident, and we refuse it instead of holding
 * it in memory and writing it into the cache.
 */
export const FAL_MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/**
 * Why the render failed, in a form the caller can branch on without parsing a message.
 *
 * `FAL_HTTP_<status>` keeps the vendor's own verdict (401 = key, 422 = body, 429 = rate,
 * 5xx = their incident) without inventing a taxonomy on top of it.
 */
export type TtsErrorCode =
  | `FAL_HTTP_${number}`
  | 'FAL_NO_URL'
  | 'FAL_TIMEOUT'
  | 'FAL_BAD_AUDIO'
  | 'FAL_NETWORK';

export class TtsError extends Error {
  readonly code: TtsErrorCode;
  /** HTTP status when there was one, `0` for timeouts / transport failures. */
  readonly status: number;

  constructor(code: TtsErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'TtsError';
    this.code = code;
    this.status = status;
  }
}

export interface FalTtsOptions {
  /** `FAL_KEY`. Sent as `Authorization: Key …`, never logged, never stored. */
  apiKey: string;
  /** Injected by the tests; production uses the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Budget for **both** round trips together (render + download). */
  timeoutMs?: number;
  /** Used when the request does not name one (`TTS_VOICE` in production). */
  defaultVoice?: string;
  /** ElevenLabs "stability": lower = more expressive, higher = more even. */
  stability?: number;
  /** Only for a staging mirror of the endpoint; defaults to {@link FAL_TTS_ENDPOINT}. */
  endpoint?: string;
  logger?: Logger;
}

/** The bits of fal's answer we read. Everything else (`timestamps`, …) is ignored. */
interface FalTtsResponse {
  audio?: { url?: unknown; content_type?: unknown } | null;
  url?: unknown;
}

/**
 * `audio.url` is what the documented shape says; a bare top-level `url` is what some fal
 * models answer with. Accept both, trust neither: it has to be an `https:` string.
 */
export function audioUrlOf(payload: unknown): string | null {
  const response = payload as FalTtsResponse | null;
  const candidates = [response?.audio?.url, response?.url];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  }
  return null;
}

/** `[whispers] <sentence>` for the whisper style; the text untouched for anything else. */
export function whisperText(request: Pick<TtsRequest, 'text' | 'voice'>): string {
  return request.voice === 'whisper' ? `${WHISPER_TAG} ${request.text}` : request.text;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Build the adapter.
 *
 * The returned function is a plain {@link TtsProvider}: the server does not know that fal
 * exists, and swapping vendors later is one line in `main.ts`.
 */
export function createFalTtsProvider(options: FalTtsOptions): TtsProvider {
  const endpoint = options.endpoint ?? FAL_TTS_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const defaultVoice = options.defaultVoice?.trim() || FAL_DEFAULT_VOICE;
  const stability = options.stability ?? FAL_DEFAULT_STABILITY;
  const doFetch = options.fetchImpl ?? fetch;
  // Silent by default: an adapter constructed inside a test must not print, and `main.ts`
  // hands over the real process logger.
  const logger = options.logger ?? silentLogger;

  /** One deadline for the whole call, shared by the two round trips. */
  async function request(url: string, init: RequestInit, deadline: number): Promise<Response> {
    const controller = new AbortController();
    const remaining = Math.max(1, deadline - Date.now());
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      return await doFetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) {
        throw new TtsError('FAL_TIMEOUT', `fal: timed out after ${timeoutMs} ms`);
      }
      // A DNS failure, a reset connection, a TLS error — never the vendor's opinion.
      const name = error instanceof Error ? error.name : 'Error';
      throw new TtsError('FAL_NETWORK', `fal: ${name}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return async (req: TtsRequest): Promise<TtsAudio> => {
    const started = Date.now();
    const deadline = started + timeoutMs;
    const voice = req.voiceName?.trim() || defaultVoice;
    const body = JSON.stringify({
      text: whisperText(req),
      voice,
      stability,
      // ElevenLabs takes an ISO-639-1 code and our two languages already are one.
      language_code: req.lang,
    });

    const rendered = await request(
      endpoint,
      {
        method: 'POST',
        headers: {
          // fal's scheme is `Key`, not `Bearer` — a `Bearer` here answers 401.
          authorization: `Key ${options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
      },
      deadline,
    );

    if (!rendered.ok) {
      // The body may echo the sentence back in an error message, so it is never read.
      logger.warn('tts.fal.http', { status: rendered.status, lang: req.lang, voice });
      throw new TtsError(`FAL_HTTP_${rendered.status}`, `fal: HTTP ${rendered.status}`, rendered.status);
    }

    let payload: unknown;
    try {
      payload = await rendered.json();
    } catch {
      throw new TtsError('FAL_NO_URL', 'fal: response was not JSON');
    }

    const audioUrl = audioUrlOf(payload);
    if (!audioUrl) {
      logger.error('tts.fal.no_url', { lang: req.lang, voice });
      throw new TtsError('FAL_NO_URL', 'fal: response had no audio url');
    }

    const downloaded = await request(audioUrl, { method: 'GET' }, deadline);
    if (!downloaded.ok) {
      throw new TtsError(`FAL_HTTP_${downloaded.status}`, `fal: download HTTP ${downloaded.status}`, downloaded.status);
    }

    const buffer = Buffer.from(await downloaded.arrayBuffer());
    if (buffer.byteLength > FAL_MAX_AUDIO_BYTES) {
      throw new TtsError('FAL_BAD_AUDIO', `fal: ${buffer.byteLength} bytes is not a sentence`);
    }

    // The container decides, not the `content-type` header: an HTML error page served with
    // `audio/mpeg` would otherwise be cached forever as the user's whisper.
    const contentType = sniffAudioContentType(buffer);
    if (!contentType) {
      logger.error('tts.fal.bad_audio', { lang: req.lang, voice, bytes: buffer.byteLength });
      throw new TtsError('FAL_BAD_AUDIO', 'fal: downloaded bytes are not audio');
    }

    logger.info('tts.fal.ok', {
      lang: req.lang,
      voice,
      // The sentence itself never appears — only how long it was (§0.5 S5).
      textLen: req.text.length,
      bytes: buffer.byteLength,
      contentType,
      ms: Date.now() - started,
    });

    return { buffer, contentType };
  };
}

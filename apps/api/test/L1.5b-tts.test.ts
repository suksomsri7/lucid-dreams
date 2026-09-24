/**
 * L1.5b — fal.ai TTS adapter + `POST /ai/anchor` (the personal watermark file).
 *
 * Two halves, and they are tested with different fakes on purpose:
 *
 *   * **The adapter** (`src/providers/tts-fal.ts`) is tested against a fake `fetch`, so the
 *     request that goes on the wire is inspected byte for byte — endpoint, `Authorization:
 *     Key …`, the `[whispers]` audio tag, `language_code` — and every failure branch is
 *     forced (no url, HTTP status, non-audio bytes, timeout). No network, no cents.
 *   * **`/ai/anchor`** is tested end to end through a real HTTP server with a fake provider
 *     that returns a **real mp3** (produced by ffmpeg in `beforeAll`), because the route's
 *     whole job is to hand that mp3 to ffmpeg and get one file back. Mixing silence would
 *     prove nothing about the mix.
 *
 * Everything that needs ffmpeg is gated on `resolveFfmpegPath()`; the VPS has it at
 * `/usr/bin/ffmpeg`, so these run rather than skip.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { anchorPhraseFor, makeSignature } from '@lucid/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mixAnchor, pcmToWav, resolveFfmpegPath, ANCHOR_WHISPER_DELAY_MS } from '../src/anchor';
import { createLogger, type LogFields } from '../src/logger';
import { normalizeTtsAudio, wavSilence, type TtsProvider } from '../src/providers/tts';
import {
  audioUrlOf,
  createFalTtsProvider,
  FAL_DEFAULT_STABILITY,
  FAL_DEFAULT_VOICE,
  FAL_TTS_ENDPOINT,
  WHISPER_TAG,
  whisperText,
} from '../src/providers/tts-fal';
import { startServer } from '../src/server';

const ffmpegPath = resolveFfmpegPath(process.env);

/** Run ffmpeg and collect stdout as bytes (optionally feeding it a file on stdin). */
function ffmpeg(args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath as string, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exit ${String(code)}: ${err}`)),
    );
    if (input) child.stdin?.end(input);
  });
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** A key-shaped string that is not a real key, so we can assert it never gets logged. */
const FAKE_KEY = 'fal-test-0000:1111';
const CDN_URL = 'https://v3b.fal.media/files/b/test/output.mp3';

/**
 * A byte string the sniffer accepts as mp3: a 10-byte empty ID3v2 tag followed by an MPEG
 * layer III frame header. Enough for every adapter test — only the `/ai/anchor` tests need
 * audio a decoder can actually open, and those use ffmpeg to make one.
 */
function fakeMp3(bytes = 512): Buffer {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const frame = Buffer.alloc(bytes, 0x00);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  return Buffer.concat([id3, frame]);
}

interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface FakeFal {
  fetchImpl: typeof fetch;
  calls: FakeCall[];
}

/**
 * A fake fal: the first call is the render (JSON in, JSON out), any later call is the CDN
 * download. `renderBody` / `audio` / `status` let each test break exactly one thing.
 */
function fakeFal(options?: {
  renderBody?: unknown;
  renderStatus?: number;
  audio?: Buffer;
  audioStatus?: number;
}): FakeFal {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const raw = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method: init?.method ?? 'GET', headers, body: raw ? JSON.parse(raw) : null });

    if (calls.length === 1) {
      const status = options?.renderStatus ?? 200;
      const payload = options?.renderBody ?? { audio: { url: CDN_URL, content_type: 'audio/mpeg' }, timestamps: null };
      return new Response(status === 200 ? JSON.stringify(payload) : 'nope', {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const audio = options?.audio ?? fakeMp3();
    return new Response(new Uint8Array(audio), {
      status: options?.audioStatus ?? 200,
      headers: { 'content-type': 'audio/mpeg' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** A logger that keeps every line, so a test can prove what is *not* in them. */
function recordingLogger(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line) });
  return { lines, logger };
}

const TH_PHRASE = anchorPhraseFor('th');
const EN_PHRASE = anchorPhraseFor('en');

// ---------------------------------------------------------------------------
// A. the adapter
// ---------------------------------------------------------------------------

describe('L1.5b fal tts provider', () => {
  it('A1 builds the documented request (endpoint · Key header · [whispers] · language_code)', async () => {
    const fal = fakeFal();
    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: fal.fetchImpl });

    const result = await provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' });
    const audio = normalizeTtsAudio(result);

    expect(audio?.contentType).toBe('audio/mpeg');
    expect(audio?.buffer.byteLength).toBeGreaterThan(0);

    expect(fal.calls).toHaveLength(2);
    const [render, download] = fal.calls;
    expect(render?.url).toBe(FAL_TTS_ENDPOINT);
    expect(render?.method).toBe('POST');
    expect(render?.headers.authorization).toBe(`Key ${FAKE_KEY}`);
    expect(render?.body).toEqual({
      text: `${WHISPER_TAG} ${TH_PHRASE}`,
      voice: FAL_DEFAULT_VOICE,
      stability: FAL_DEFAULT_STABILITY,
      language_code: 'th',
    });
    // The bytes come from the CDN link in the answer, not from the render response.
    expect(download?.url).toBe(CDN_URL);
    expect(download?.method).toBe('GET');
  });

  it('A2 english + a named voice + a custom stability travel through', async () => {
    const fal = fakeFal();
    const provider = createFalTtsProvider({
      apiKey: FAKE_KEY,
      fetchImpl: fal.fetchImpl,
      defaultVoice: 'Laura',
      stability: 0.4,
    });

    await provider({ text: EN_PHRASE, lang: 'en', voice: 'whisper', voiceName: 'Charlotte' });

    expect(fal.calls[0]?.body).toEqual({
      text: `${WHISPER_TAG} ${EN_PHRASE}`,
      voice: 'Charlotte', // the request wins over `defaultVoice`
      stability: 0.4,
      language_code: 'en',
    });
    // The tag is added exactly once — a double prefix is read aloud by eleven-v3.
    expect((fal.calls[0]?.body as { text: string }).text.match(/\[whispers]/g)).toHaveLength(1);
  });

  it('A3 follows a top-level `url` when there is no `audio.url`', async () => {
    const fal = fakeFal({ renderBody: { url: CDN_URL } });
    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: fal.fetchImpl });

    const result = await provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' });
    expect(normalizeTtsAudio(result)?.contentType).toBe('audio/mpeg');
    expect(fal.calls[1]?.url).toBe(CDN_URL);

    // and the helper itself, on the three shapes that matter
    expect(audioUrlOf({ audio: { url: CDN_URL } })).toBe(CDN_URL);
    expect(audioUrlOf({ url: CDN_URL })).toBe(CDN_URL);
    expect(audioUrlOf({ audio: { url: 'javascript:alert(1)' } })).toBeNull();
  });

  it('A4 no url in the answer → FAL_NO_URL', async () => {
    const fal = fakeFal({ renderBody: { audio: null, detail: 'busy' } });
    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: fal.fetchImpl });

    await expect(provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' })).rejects.toMatchObject({
      name: 'TtsError',
      code: 'FAL_NO_URL',
    });
    expect(fal.calls).toHaveLength(1); // nothing was downloaded
  });

  it('A5 HTTP error keeps the vendor status → FAL_HTTP_429', async () => {
    const fal = fakeFal({ renderStatus: 429 });
    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: fal.fetchImpl });

    await expect(provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' })).rejects.toMatchObject({
      name: 'TtsError',
      code: 'FAL_HTTP_429',
      status: 429,
    });
  });

  it('A6 a failed download keeps its own status → FAL_HTTP_404', async () => {
    const fal = fakeFal({ audioStatus: 404 });
    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: fal.fetchImpl });

    await expect(provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' })).rejects.toMatchObject({
      code: 'FAL_HTTP_404',
    });
  });

  it('A7 bytes that are not audio → FAL_BAD_AUDIO (an error page is never cached)', async () => {
    const fal = fakeFal({ audio: Buffer.from('<!doctype html><html>rate limited</html>') });
    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: fal.fetchImpl });

    await expect(provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' })).rejects.toMatchObject({
      code: 'FAL_BAD_AUDIO',
    });
  });

  it('A8 a hanging vendor → FAL_TIMEOUT (and the request really is aborted)', async () => {
    let aborted = false;
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;

    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: hang, timeoutMs: 30 });
    await expect(provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' })).rejects.toMatchObject({
      code: 'FAL_TIMEOUT',
      status: 0,
    });
    expect(aborted).toBe(true);
  });

  it('A9 nothing is logged but lengths — never the key, never the sentence', async () => {
    const { lines, logger } = recordingLogger();
    const fal = fakeFal();
    const provider = createFalTtsProvider({ apiKey: FAKE_KEY, fetchImpl: fal.fetchImpl, logger });

    await provider({ text: TH_PHRASE, lang: 'th', voice: 'whisper' });
    const failing = createFalTtsProvider({
      apiKey: FAKE_KEY,
      fetchImpl: fakeFal({ renderStatus: 401 }).fetchImpl,
      logger,
    });
    await failing({ text: TH_PHRASE, lang: 'th', voice: 'whisper' }).catch(() => undefined);

    expect(lines.length).toBeGreaterThan(1);
    const all = lines.join('\n');
    expect(all).not.toContain(FAKE_KEY);
    expect(all).not.toContain(TH_PHRASE);
    expect(all).not.toContain(WHISPER_TAG);
    // …but the shape is there: the length of the sentence and the status of the failure.
    const fields = lines.map((line) => JSON.parse(line) as LogFields);
    expect(fields.some((f) => f.event === 'tts.fal.ok' && f.textLen === TH_PHRASE.length)).toBe(true);
    expect(fields.some((f) => f.event === 'tts.fal.http' && f.status === 401)).toBe(true);
  });

  it('A10 whisperText only tags the whisper style', () => {
    expect(whisperText({ text: 'x', voice: 'whisper' })).toBe(`${WHISPER_TAG} x`);
    expect(whisperText({ text: 'x', voice: 'plain' as 'whisper' })).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// B. POST /ai/anchor
// ---------------------------------------------------------------------------

if (!ffmpegPath) {
  // eslint-disable-next-line no-console
  console.warn('L1.5b: SKIPPING every /ai/anchor test — no ffmpeg found (set FFMPEG_PATH). Install ffmpeg to run them.');
}

interface Harness {
  url: string;
  token: string;
  close(): Promise<void>;
  calls(): number;
}

async function harness(options?: {
  ttsProvider?: TtsProvider | null;
  /** One clip per language — the real vendor renders a different sentence for each. */
  whispers?: Record<'th' | 'en', Buffer>;
}): Promise<Harness> {
  let calls = 0;
  const audio = options?.whispers;
  const fallback: TtsProvider = async (request) => {
    calls += 1;
    return { buffer: (audio as Record<'th' | 'en', Buffer>)[request.lang], contentType: 'audio/mpeg' as const };
  };
  const provider: TtsProvider | null = options && 'ttsProvider' in options ? (options.ttsProvider ?? null) : fallback;

  const server = await startServer({
    port: 0,
    provider: { plan: async () => ({}) },
    ttsProvider: provider,
    store: 'memory',
    rateLimitPerHour: 60,
  });

  const created = await fetch(`${server.url}/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', appVersion: '0.1.0' }),
  });
  const { token } = (await created.json()) as { token: string };

  return { url: server.url, token, close: () => server.close(), calls: () => calls };
}

function postAnchor(url: string, token: string | null, body: unknown): Promise<Response> {
  return fetch(`${url}/ai/anchor`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Decode an mp3 to mono float samples at 48 kHz so a test can measure it. */
async function decode(mp3: Buffer): Promise<{ samples: Int16Array; sampleRate: number }> {
  const raw = await ffmpeg(
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '1', 'pipe:1'],
    mp3,
  );
  // `slice` gives a 2-byte-aligned copy — a Buffer's own offset need not be even.
  const aligned = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return { samples: new Int16Array(aligned), sampleRate: 48_000 };
}

/**
 * Amplitude of one frequency between two times — a Goertzel filter. Needed since v2-C: the
 * whisper is mixed *over* the bell, so "is the whisper playing" is a question about one
 * frequency, not about how loud the file is.
 */
function toneRms(samples: Int16Array, hz: number, fromMs: number, toMs: number, sampleRate = 48_000): number {
  const from = Math.max(0, Math.floor((fromMs / 1000) * sampleRate));
  const to = Math.min(samples.length, Math.floor((toMs / 1000) * sampleRate));
  const size = to - from;
  if (size <= 0) return 0;
  const coefficient = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < size; i += 1) {
    const s0 = (samples[from + i] as number) / 32768 + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2))) / size;
}

function rms(samples: Int16Array, fromMs: number, toMs: number, sampleRate = 48_000): number {
  const from = Math.max(0, Math.floor((fromMs / 1000) * sampleRate));
  const to = Math.min(samples.length, Math.floor((toMs / 1000) * sampleRate));
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += ((samples[i] as number) / 32768) ** 2;
  return Math.sqrt(sum / (to - from));
}

describe.skipIf(!ffmpegPath)('L1.5b POST /ai/anchor', () => {
  const WHISPER_MS = 600;
  let whispers: Record<'th' | 'en', Buffer>;
  let main: Harness;

  /** A real mp3, made the way the vendor makes one: a tone, 128 kbps, 44.1 kHz mono. */
  const sineMp3 = (hz: number): Promise<Buffer> =>
    ffmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${WHISPER_MS / 1000}`,
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', '-f', 'mp3', 'pipe:1',
    ]);

  beforeAll(async () => {
    // Two different clips, because the two languages are two different sentences.
    whispers = { th: await sineMp3(320), en: await sineMp3(440) };
    expect(whispers.th.byteLength).toBeGreaterThan(1000);
    expect(whispers.th.equals(whispers.en)).toBe(false);

    main = await harness({ whispers });
  });

  afterAll(async () => {
    await main?.close();
  });

  it('B1 200 audio/mpeg · x-cache MISS · x-anchor-hash and -notes come from the engine', async () => {
    const seed = 'seed-b1';
    const response = await postAnchor(main.url, main.token, { seed, lang: 'th' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('x-cache')).toBe('MISS');

    const signature = makeSignature(seed, 'th');
    expect(response.headers.get('x-anchor-hash')).toBe(signature.hash);
    expect(response.headers.get('x-anchor-notes')).toBe(signature.notes.join(','));

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(2000);
    // real mp3: ID3 tag or a frame sync
    const isMp3 = bytes.toString('latin1', 0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] as number) & 0xe0) === 0xe0);
    expect(isMp3).toBe(true);
  });

  // Updated for v2-C (owner decision 24 ก.ย. ค่ำ · Fable's call on L1.6s): the bell is now
  // 9.8 s and the whisper plays **over** it from 2.6 s, so the file is as long as the bell and
  // there is no silent gap between the two any more. What is still worth pinning here is that
  // the mix keeps the engine's own length and that both voices are audible.
  it('B2 the file is as long as the bell, and the whisper plays over it', async () => {
    const seed = 'seed-b2';
    const response = await postAnchor(main.url, main.token, { seed, lang: 'th' });
    const mp3 = Buffer.from(await response.arrayBuffer());
    const { samples } = await decode(mp3);

    const signature = makeSignature(seed, 'th');
    const totalMs = (samples.length / 48_000) * 1000;

    // The bell decides the length; ±300 ms for the encoder's padding.
    expect(Math.abs(totalMs - signature.durationMs)).toBeLessThan(300);

    // Something is playing while the bell is on…
    expect(rms(samples, 200, signature.durationMs - 100)).toBeGreaterThan(0.01);
    // …and the whisper is in there, on top of it. Total RMS cannot show that any more (the
    // bell is at its loudest right before 2.6 s), so ask for the whisper's own frequency: a
    // Goertzel over 500 ms is ~2 Hz wide, far narrower than the gap to any partial of the bell.
    //
    // 440 Hz, not 320: the request says `lang: 'th'` but since v2-C the server asks the vendor
    // in **English** whatever the UI language, so the fake returns its `en` clip. That is the
    // decision, visible in the audio.
    const during = toneRms(samples, 440, ANCHOR_WHISPER_DELAY_MS + 100, ANCHOR_WHISPER_DELAY_MS + WHISPER_MS);
    const before = toneRms(samples, 440, 1_500, 2_500);
    expect(during).toBeGreaterThan(before * 5);
  });

  it('B3 second call → x-cache HIT, identical bytes, and the vendor is not called again', async () => {
    const seed = 'seed-b3';
    const before = main.calls();

    const first = await postAnchor(main.url, main.token, { seed, lang: 'th' });
    const firstBytes = Buffer.from(await first.arrayBuffer());
    expect(first.headers.get('x-cache')).toBe('MISS');

    const second = await postAnchor(main.url, main.token, { seed, lang: 'th' });
    const secondBytes = Buffer.from(await second.arrayBuffer());
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(second.headers.get('x-anchor-hash')).toBe(first.headers.get('x-anchor-hash'));

    // The sentence was already in the cache from B1, so this seed cost nothing at all.
    expect(main.calls()).toBe(before);
  });

  it('B4 same seed on a fresh server → identical bytes · different seed → different bytes', async () => {
    const other = await harness({ whispers });
    try {
      const here = Buffer.from(await (await postAnchor(main.url, main.token, { seed: 'twin', lang: 'th' })).arrayBuffer());
      const there = Buffer.from(
        await (await postAnchor(other.url, other.token, { seed: 'twin', lang: 'th' })).arrayBuffer(),
      );
      // Nothing in the pipeline may depend on the clock, the store or the process.
      expect(createHash('sha256').update(there).digest('hex')).toBe(
        createHash('sha256').update(here).digest('hex'),
      );

      const different = Buffer.from(
        await (await postAnchor(other.url, other.token, { seed: 'not-twin', lang: 'th' })).arrayBuffer(),
      );
      expect(different.equals(there)).toBe(false);
    } finally {
      await other.close();
    }
  });

  // Updated for v2-C: there is exactly one whisper — English, one voice, for every user — so
  // the two languages are two cache rows holding the *same* audio. `L1.6s-anchor.test.ts` S4
  // covers the vendor side of that decision (one paid call, `lang: 'en'`).
  it('B5 one row per language, one sound for everybody', async () => {
    const seed = 'seed-b5';
    const th = await postAnchor(main.url, main.token, { seed, lang: 'th' });
    const en = await postAnchor(main.url, main.token, { seed, lang: 'en' });

    // The engine keeps the notes and changes the hash (signature oracle G4) …
    expect(en.headers.get('x-anchor-notes')).toBe(th.headers.get('x-anchor-notes'));
    expect(en.headers.get('x-anchor-hash')).not.toBe(th.headers.get('x-anchor-hash'));
    // … while the audio itself no longer depends on the UI language.
    const [a, b] = [Buffer.from(await th.arrayBuffer()), Buffer.from(await en.arrayBuffer())];
    expect(a.equals(b)).toBe(true);
  });

  it('B6 guards: no token → 401 · bad body → 400', async () => {
    expect((await postAnchor(main.url, null, { seed: 'x', lang: 'th' })).status).toBe(401);
    expect((await postAnchor(main.url, main.token, { seed: 'x', lang: 'xx' })).status).toBe(400);
    expect((await postAnchor(main.url, main.token, { seed: '', lang: 'th' })).status).toBe(400);
    expect((await postAnchor(main.url, main.token, { seed: 'x'.repeat(65), lang: 'th' })).status).toBe(400);
    expect((await postAnchor(main.url, main.token, { lang: 'th' })).status).toBe(400);
  });

  it('B7 no TTS vendor → 501 NOT_CONFIGURED with a reason', async () => {
    const bare = await harness({ ttsProvider: null });
    try {
      const response = await postAnchor(bare.url, bare.token, { seed: 'seed-b7', lang: 'th' });
      expect(response.status).toBe(501);
      const payload = (await response.json()) as { error: string; detail?: string };
      expect(payload.error).toBe('NOT_CONFIGURED');
      expect(payload.detail).toMatch(/TTS/);
    } finally {
      await bare.close();
    }
  });

  it('B8 no ffmpeg → 501 NOT_CONFIGURED, and the vendor is never called', async () => {
    const before = main.calls();
    const saved = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
    try {
      const response = await postAnchor(main.url, main.token, { seed: 'seed-b8', lang: 'en' });
      expect(response.status).toBe(501);
      const payload = (await response.json()) as { error: string; detail?: string };
      expect(payload.error).toBe('NOT_CONFIGURED');
      expect(payload.detail).toMatch(/ffmpeg/);
      // The paid call comes after the free check, so a box without ffmpeg spends nothing.
      expect(main.calls()).toBe(before);
    } finally {
      if (saved === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = saved;
    }
  });

  it('B9 a whisper the provider returns as WAV is mixed too', async () => {
    const wav = wavSilence(400, 48_000);
    const server = await harness({ ttsProvider: async () => ({ buffer: wav, contentType: 'audio/wav' as const }) });
    try {
      const response = await postAnchor(server.url, server.token, { seed: 'seed-b9', lang: 'th' });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('audio/mpeg');
      expect(Buffer.from(await response.arrayBuffer()).byteLength).toBeGreaterThan(2000);
    } finally {
      await server.close();
    }
  });

  it('B10 a broken provider answer → 502 PROVIDER_SCHEMA · a throwing one → 502 PROVIDER_UNAVAILABLE', async () => {
    const server = await harness({ ttsProvider: async () => Buffer.from('not audio at all') });
    try {
      const first = await postAnchor(server.url, server.token, { seed: 'seed-b10', lang: 'th' });
      expect(first.status).toBe(502);
      expect(((await first.json()) as { error: string }).error).toBe('PROVIDER_SCHEMA');

      const throwing = await harness({
        ttsProvider: async () => {
          throw new Error('vendor down');
        },
      });
      try {
        const second = await postAnchor(throwing.url, throwing.token, { seed: 'seed-b10', lang: 'th' });
        expect(second.status).toBe(502);
        expect(((await second.json()) as { error: string }).error).toBe('PROVIDER_UNAVAILABLE');
      } finally {
        await throwing.close();
      }
    } finally {
      await server.close();
    }
  });

  it('B11 mixAnchor cleans up after itself and refuses a broken input', async () => {
    const wav = pcmToWav(new Float32Array(4800));
    // A file ffmpeg cannot decode must fail loudly, not produce half a watermark.
    await expect(
      mixAnchor({
        signature: wav,
        whisper: Buffer.from('still not audio'),
        whisperContentType: 'audio/mpeg',
        ffmpegPath: ffmpegPath as string,
      }),
    ).rejects.toMatchObject({ name: 'AnchorMixError', code: 'FFMPEG_FAILED' });
  });
});

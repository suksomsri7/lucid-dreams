/**
 * L1.6s — `POST /ai/anchor` after the v2-C decision (24 ก.ย. ค่ำ, after the owner listened).
 *
 * What changed, and therefore what this file pins down:
 *
 *   * the melody is the 9.8 s deep bell from `@lucid/engine` v2, not the old 1.5 s phrase, so
 *     the mixed file is ~10 s and the route must not truncate it;
 *   * the whisper is **one** English sentence in one voice for every user (`anchorWhisperText`),
 *     slowed to `atempo=0.85`, laid **over** the bell starting at `signature.whisperAtMs`;
 *   * so two users on two UI languages get two cache rows with the *same audio*, and the
 *     vendor is paid once for the whole product.
 *
 * Method: a fake TTS provider that returns a **real mp3** of a 1 kHz tone. 1 kHz is far above
 * anything the bell contains (its highest partial is 6 × 220 Hz), so a Goertzel filter at
 * 1 kHz over the decoded mix isolates the whisper and can measure *where it starts* and *how
 * long it lasts* — which is how the delay and the time stretch are verified rather than
 * assumed. Everything needing ffmpeg is skipped (loudly) if ffmpeg is missing.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { anchorWhisperText, makeSignature } from '@lucid/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ANCHOR_WHISPER_ATEMPO,
  ANCHOR_WHISPER_DELAY_MS,
  resolveFfmpegPath,
} from '../src/anchor';
import type { TtsProvider } from '../src/providers/tts';
import { startServer } from '../src/server';

const ffmpegPath = resolveFfmpegPath(process.env);

/** ffprobe lives next to ffmpeg on every box we run on; absent ⇒ we estimate instead. */
function resolveFfprobePath(): string | null {
  const configured = process.env.FFPROBE_PATH?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  for (const candidate of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function run(binary: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${binary} exit ${String(code)}: ${err}`)),
    );
    if (input) child.stdin?.end(input);
  });
}

/** mp3 → mono 16-bit samples at 48 kHz, so the test can measure the sound, not the bytes. */
async function decode(mp3: Buffer): Promise<Int16Array> {
  const raw = await run(
    ffmpegPath as string,
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '1', 'pipe:1'],
    mp3,
  );
  // `slice` on the underlying buffer gives a 2-byte-aligned copy — a Buffer's own byteOffset
  // need not be even, and `new Int16Array` would throw on an odd one.
  return new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

/**
 * Length of the clip in ms: ffprobe when the box has it, otherwise the decoded sample count.
 * Both are measurements of the same file; the fallback exists so this oracle still runs on a
 * box with a stripped-down ffmpeg build.
 */
async function durationMs(mp3: Buffer): Promise<number> {
  const ffprobePath = resolveFfprobePath();
  if (ffprobePath) {
    const out = await run(ffprobePath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      'pipe:0',
    ], mp3);
    const seconds = Number.parseFloat(out.toString('utf8').trim());
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return ((await decode(mp3)).length / 48_000) * 1000;
}

/**
 * Amplitude of `hz` in every `windowMs` slice — a Goertzel filter, which is the cheapest way
 * to ask "is the whisper playing right now" without an FFT library in a test file.
 */
function tone(samples: Int16Array, hz: number, windowMs = 100, sampleRate = 48_000): number[] {
  const size = Math.floor((windowMs / 1000) * sampleRate);
  const coefficient = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  const out: number[] = [];
  for (let start = 0; start + size <= samples.length; start += size) {
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < size; i += 1) {
      const s0 = (samples[start + i] as number) / 32768 + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    out.push((2 * Math.sqrt(s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / size);
  }
  return out;
}

/** First and last window (in ms) where `hz` is clearly present. */
function toneSpan(samples: Int16Array, hz: number, windowMs = 100): { fromMs: number; toMs: number } {
  const levels = tone(samples, hz, windowMs);
  const peak = Math.max(...levels);
  const threshold = peak * 0.15;
  let from = -1;
  let to = -1;
  for (let i = 0; i < levels.length; i += 1) {
    if ((levels[i] as number) < threshold) continue;
    if (from < 0) from = i;
    to = i;
  }
  return { fromMs: from * windowMs, toMs: (to + 1) * windowMs };
}

if (!ffmpegPath) {
  // eslint-disable-next-line no-console
  console.warn('L1.6s: SKIPPING every /ai/anchor test — no ffmpeg found (set FFMPEG_PATH).');
}

interface Harness {
  url: string;
  token: string;
  close(): Promise<void>;
  calls(): { lang: string; text: string }[];
}

/** The whisper the fake vendor returns: 2.5 s of 1 kHz, encoded exactly like fal's answer. */
const WHISPER_MS = 2500;
const WHISPER_HZ = 1000;

async function harness(whisper: Buffer): Promise<Harness> {
  const calls: { lang: string; text: string }[] = [];
  const provider: TtsProvider = async (request) => {
    calls.push({ lang: request.lang, text: request.text });
    return { buffer: whisper, contentType: 'audio/mpeg' as const };
  };

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

function postAnchor(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(`${url}/ai/anchor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

describe.skipIf(!ffmpegPath)('L1.6s POST /ai/anchor (v2-C · one whisper over the bell)', () => {
  let whisperMp3: Buffer;
  let main: Harness;

  beforeAll(async () => {
    whisperMp3 = await run(ffmpegPath as string, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${WHISPER_HZ}:duration=${WHISPER_MS / 1000}`,
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', '-f', 'mp3', 'pipe:1',
    ]);
    expect(whisperMp3.byteLength).toBeGreaterThan(1000);
    main = await harness(whisperMp3);
  }, 60_000);

  afterAll(async () => {
    await main?.close();
  });

  it('S1 the file is 8–14 s long, mp3, and carries the engine hash', async () => {
    const seed = 'seed-s1';
    const response = await postAnchor(main.url, main.token, { seed, lang: 'th' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('x-cache')).toBe('MISS');

    const signature = makeSignature(seed, 'th');
    expect(response.headers.get('x-anchor-hash')).toBe(signature.hash);
    expect(response.headers.get('x-anchor-notes')).toBe(signature.notes.join(','));

    const mp3 = Buffer.from(await response.arrayBuffer());
    const isMp3 = mp3.toString('latin1', 0, 3) === 'ID3' || (mp3[0] === 0xff && ((mp3[1] as number) & 0xe0) === 0xe0);
    expect(isMp3).toBe(true);

    // 8–14 s: the bell alone is 9.8 s, and nothing in the mix may cut it short or double it.
    const ms = await durationMs(mp3);
    expect(ms).toBeGreaterThan(8_000);
    expect(ms).toBeLessThan(14_000);
    // …and it really is the engine's own length, within one mp3 frame's padding.
    expect(Math.abs(ms - signature.durationMs)).toBeLessThan(300);
  }, 60_000);

  it('S2 the whisper starts at whisperAtMs at ANCHOR_WHISPER_ATEMPO speed — over the bell, not after it', async () => {
    const seed = 'seed-s2';
    const response = await postAnchor(main.url, main.token, { seed, lang: 'th' });
    const samples = await decode(Buffer.from(await response.arrayBuffer()));
    const signature = makeSignature(seed, 'th');

    expect(signature.whisperAtMs).toBe(2600);
    expect(ANCHOR_WHISPER_DELAY_MS).toBe(signature.whisperAtMs);

    const span = toneSpan(samples, WHISPER_HZ);
    // Where it starts: the engine's number, ± one measurement window and the encoder's padding.
    expect(Math.abs(span.fromMs - signature.whisperAtMs)).toBeLessThan(250);
    // How long it lasts: 2.5 s of source at 0.85 speed = ~2.94 s.
    const stretched = WHISPER_MS / ANCHOR_WHISPER_ATEMPO;
    expect(Math.abs(span.toMs - span.fromMs - stretched)).toBeLessThan(300);
    // And the bell is still ringing after the whisper is done — that is the v2-C shape.
    expect(span.toMs).toBeLessThan(signature.durationMs - 1_000);
  }, 60_000);

  it('S3 same seed on a fresh server → identical bytes · different seed → different bytes', async () => {
    const other = await harness(whisperMp3);
    try {
      const here = Buffer.from(await (await postAnchor(main.url, main.token, { seed: 'twin-s3', lang: 'th' })).arrayBuffer());
      const there = Buffer.from(
        await (await postAnchor(other.url, other.token, { seed: 'twin-s3', lang: 'th' })).arrayBuffer(),
      );
      expect(sha256(there)).toBe(sha256(here));

      const different = Buffer.from(
        await (await postAnchor(other.url, other.token, { seed: 'not-twin-s3', lang: 'th' })).arrayBuffer(),
      );
      expect(sha256(different)).not.toBe(sha256(there));
    } finally {
      await other.close();
    }
  }, 60_000);

  it('S4 one whisper for everybody: th and en get the same audio (different rows, one vendor call)', async () => {
    const server = await harness(whisperMp3);
    try {
      const th = await postAnchor(server.url, server.token, { seed: 'seed-s4', lang: 'th' });
      const en = await postAnchor(server.url, server.token, { seed: 'seed-s4', lang: 'en' });

      const [a, b] = [Buffer.from(await th.arrayBuffer()), Buffer.from(await en.arrayBuffer())];
      // Same sound — the sentence and the voice no longer depend on the UI language …
      expect(sha256(b)).toBe(sha256(a));
      // … while the identity of the row still does (engine oracle G4).
      expect(en.headers.get('x-anchor-hash')).not.toBe(th.headers.get('x-anchor-hash'));
      expect(en.headers.get('x-anchor-notes')).toBe(th.headers.get('x-anchor-notes'));

      // The vendor was asked exactly once, for English, with the one sentence there is.
      expect(server.calls()).toHaveLength(1);
      expect(server.calls()[0]).toEqual({ lang: 'en', text: anchorWhisperText() });
      expect(anchorWhisperText()).toBe('You are dreaming.');
    } finally {
      await server.close();
    }
  }, 60_000);

  it('S5 second call for the same seed is a cache HIT with the same bytes', async () => {
    const seed = 'seed-s5';
    const first = await postAnchor(main.url, main.token, { seed, lang: 'en' });
    const firstBytes = Buffer.from(await first.arrayBuffer());
    expect(first.headers.get('x-cache')).toBe('MISS');

    const second = await postAnchor(main.url, main.token, { seed, lang: 'en' });
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(sha256(Buffer.from(await second.arrayBuffer()))).toBe(sha256(firstBytes));
  }, 60_000);
});

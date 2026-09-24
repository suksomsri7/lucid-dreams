/**
 * `anchor.ts` — the personal watermark as **one file**: melody, then the whisper.
 *
 * DESIGN-APP §2 principle 3 (owner decision 24 ก.ย.) says a user has exactly one anchor
 * sound per language: a 1.5 s signature melody generated from their own seed, followed by
 * the whispered sentence. §6 ("สร้างลายน้ำเสียงสมอ") puts the job on the server: the phone
 * asks once during onboarding, gets a file, and plays that same file for daytime reality
 * checks, the pre-sleep training, the night whisper and the morning recall.
 *
 * Why one file instead of two the app plays back to back:
 *
 *   * The gap between the melody and the whisper **is part of the cue**. Two `expo-av`
 *     players scheduled 1.7 s apart drift by tens of milliseconds depending on what else
 *     the phone is doing; a night cue that sounds slightly different every time is a
 *     different cue as far as the brain is concerned.
 *   * One file is one decode and one volume ramp at 3 a.m. — the engine owns the volume
 *     (§2 rule 3.1) and it can only own one thing.
 *   * The mix is deterministic, so the file is cacheable and diffable: same seed, same
 *     language, same voice, same bytes (oracle of this work order).
 *
 * The mixing is done by **ffmpeg** (`/usr/bin/ffmpeg` on the VPS) and nothing else. Doing
 * it in TypeScript would mean decoding an mp3 by hand — fal returns mp3, not PCM — and
 * writing an mp3 encoder; ffmpeg is already installed, already the tool the video work on
 * this machine uses, and it is a `spawn` with an argument array, never a shell string.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 48 kHz throughout: the engine renders at 48 kHz and a resample would be a lossy step. */
export const ANCHOR_SAMPLE_RATE = 48_000;

/** Where the whisper starts, measured from the start of the file (work order L1.5b). */
export const ANCHOR_WHISPER_DELAY_MS = 1700;

/**
 * The melody sits 0.8 of the way up. `renderSignaturePcm` already normalises its peak to
 * 0.7, so the melody peaks at 0.56 and the whisper keeps the headroom it needs to stay
 * intelligible at the very low night volumes the engine uses (§5.3).
 */
export const ANCHOR_SIGNATURE_GAIN = 0.8;

/** 128 kbps mono — indistinguishable from the source for a 3 s clip, ~50 KB on the wire. */
export const ANCHOR_MP3_BITRATE = '128k';

/** ffmpeg on a 3 s clip takes ~60 ms; 20 s means something is wrong, not slow. */
export const ANCHOR_MIX_TIMEOUT_MS = 20_000;

export type AnchorMixErrorCode = 'FFMPEG_FAILED' | 'FFMPEG_TIMEOUT' | 'FFMPEG_EMPTY';

export class AnchorMixError extends Error {
  readonly code: AnchorMixErrorCode;
  /** ffmpeg's exit code, or `null` when it was killed. */
  readonly exitCode: number | null;

  constructor(code: AnchorMixErrorCode, message: string, exitCode: number | null = null) {
    super(message);
    this.name = 'AnchorMixError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

/**
 * Find ffmpeg without a shell and without `which`.
 *
 * `FFMPEG_PATH` wins so a box with a static build somewhere else needs no code change; the
 * two standard locations are then tried in order. `null` ⇒ the caller answers
 * `501 NOT_CONFIGURED`, which is the honest status: the feature is not configured on this
 * machine, the request was fine.
 */
export function resolveFfmpegPath(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.FFMPEG_PATH?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  for (const candidate of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Float PCM (what the engine renders) → a mono 16-bit WAV file ffmpeg can read.
 *
 * Rounding, not truncation, and a clamp at both ends: a sample at exactly ±1.0 must not
 * wrap around into the opposite sign, which is the classic way a synthesised tone acquires
 * a click it did not have.
 */
export function pcmToWav(pcm: Float32Array, sampleRate = ANCHOR_SAMPLE_RATE): Buffer {
  const dataBytes = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'latin1');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'latin1');
  buffer.write('fmt ', 12, 'latin1');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'latin1');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < pcm.length; i += 1) {
    const sample = pcm[i] as number;
    const clamped = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    const value = Math.round(clamped * 32767);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, value)), 44 + i * 2);
  }
  return buffer;
}

export interface MixAnchorOptions {
  /** The melody, as a WAV (see {@link pcmToWav}). */
  signature: Buffer;
  /** The whispered sentence as the TTS vendor delivered it. */
  whisper: Buffer;
  /** Container of `whisper`, so ffmpeg gets a file extension it recognises. */
  whisperContentType: 'audio/mpeg' | 'audio/wav';
  ffmpegPath: string;
  delayMs?: number;
  signatureGain?: number;
  timeoutMs?: number;
}

/**
 * The filter graph, built as a string because that is ffmpeg's own syntax — the *arguments*
 * are still an array, so nothing here is ever interpreted by a shell.
 *
 * ```
 * [0:a] aformat → volume=gain              → [a]   melody, quieter
 * [1:a] aformat → adelay=1700:all=1        → [b]   whisper, pushed back 1.7 s
 * [a][b] amix=inputs=2:normalize=0                 sum, no automatic gain change
 * ```
 *
 * `normalize=0` is the whole point of using `amix` explicitly: the default divides every
 * input by the number of inputs, which would silently halve the melody we just set to 0.8.
 * `duration=longest` keeps the whisper's tail; `dropout_transition=0` stops amix from
 * ramping the melody up when the whisper ends.
 */
export function buildMixFilter(gain: number, delayMs: number): string {
  const format = `aformat=sample_fmts=fltp:sample_rates=${ANCHOR_SAMPLE_RATE}:channel_layouts=mono`;
  return [
    `[0:a]${format},volume=${gain}[a]`,
    `[1:a]${format},adelay=${Math.round(delayMs)}:all=1[b]`,
    `[a][b]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mix]`,
  ].join(';');
}

/**
 * Run ffmpeg over two temporary files and return the mp3.
 *
 * Temp files (not pipes) because ffmpeg needs to seek both inputs, and `os.tmpdir()`
 * because the systemd unit gets a private `/tmp`. The directory is removed in `finally`
 * whatever happens — a watermark renderer that leaks 50 KB per call would fill the disk of
 * this VPS in a week (see the disk incident in the owner's notes).
 */
export async function mixAnchor(options: MixAnchorOptions): Promise<Buffer> {
  const delayMs = options.delayMs ?? ANCHOR_WHISPER_DELAY_MS;
  const gain = options.signatureGain ?? ANCHOR_SIGNATURE_GAIN;
  const timeoutMs = options.timeoutMs ?? ANCHOR_MIX_TIMEOUT_MS;
  const whisperExtension = options.whisperContentType === 'audio/wav' ? 'wav' : 'mp3';

  const directory = await mkdtemp(path.join(os.tmpdir(), 'lucid-anchor-'));
  const signaturePath = path.join(directory, 'signature.wav');
  const whisperPath = path.join(directory, `whisper.${whisperExtension}`);
  const outputPath = path.join(directory, 'anchor.mp3');

  try {
    await writeFile(signaturePath, options.signature);
    await writeFile(whisperPath, options.whisper);

    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      signaturePath,
      '-i',
      whisperPath,
      '-filter_complex',
      buildMixFilter(gain, delayMs),
      '-map',
      '[mix]',
      '-c:a',
      'libmp3lame',
      '-b:a',
      ANCHOR_MP3_BITRATE,
      '-ar',
      String(ANCHOR_SAMPLE_RATE),
      '-ac',
      '1',
      // No `TSSE`/date tags in the file: the bytes have to be identical for the same seed,
      // and an encoder that stamps the time would make every render a different file.
      '-write_xing',
      '1',
      '-map_metadata',
      '-1',
      outputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stderr?.on('data', (chunk: Buffer) => {
        // Bounded: ffmpeg can be chatty, and this string ends up in a log line.
        if (stderr.length < 400) stderr += chunk.toString('utf8');
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new AnchorMixError('FFMPEG_FAILED', `ffmpeg: ${error.name}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new AnchorMixError('FFMPEG_TIMEOUT', `ffmpeg: killed after ${timeoutMs} ms`, code));
          return;
        }
        if (code !== 0) {
          reject(new AnchorMixError('FFMPEG_FAILED', `ffmpeg: exit ${String(code)} ${stderr.trim()}`, code));
          return;
        }
        resolve();
      });
    });

    const mp3 = await readFile(outputPath);
    if (mp3.byteLength === 0) throw new AnchorMixError('FFMPEG_EMPTY', 'ffmpeg: wrote an empty file');
    return mp3;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

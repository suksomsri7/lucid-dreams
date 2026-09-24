/**
 * `server.ts` — the whole AI server: five routes, four guards, no session state.
 *
 * Routes (DESIGN §8.2 · APP-RUN §2 L1.5):
 *   `GET    /health`   — liveness for nginx/systemd. No auth, no body, no secrets.
 *   `POST   /device`   — hand out a device token at onboarding (§0.5 S2).
 *   `POST   /ai/plan`  — conversation ➜ `DreamPlan`, validated against the engine schema.
 *   `POST   /ai/tts`   — render (and cache) the whispered anchor sentence.
 *   `POST   /ai/anchor`— the whole personal watermark file: melody + whisper, mixed (§2 ข้อ 3).
 *   `DELETE /device`   — revoke the token; the server side of "ลบทั้งหมด" (§0.5 S4).
 *
 * Guards, in the order they run for `/ai/*` — the order is the design, not an accident:
 *
 *   1. **32 KB body cap** — `content-length` first (free), then a counting read of the
 *      stream, because `content-length` is a claim by the client and a chunked request
 *      does not have to make it. A 40 KB dream never reaches the JSON parser (S2).
 *   2. **Bearer device token** — looked up by `sha256(token)`; unknown/absent ⇒ 401. There
 *      are no users, no passwords and no cookies on this server: one token per install,
 *      kept in the Keychain on the phone (S1/S2).
 *   3. **zod** — every body, every field, with lengths. Invalid ⇒ 400 before any work.
 *   4. **Rate limit** — a real sliding hour per device (`rateLimitPerHour`, 60 by default
 *      per §0.5 S2) ⇒ 429. It sits *after* zod on purpose: the counter exists to cap the
 *      expensive thing (a model call), and a malformed body never gets that far. A flood
 *      of malformed requests is absorbed by nginx `limit_req` (see `README.md`), which is
 *      the right layer for something that never touches our database.
 *
 * Then, and only then, the provider is called — and its answer is treated as hostile:
 * it must parse as a `DreamPlan` (unknown keys stripped) or the request fails with
 * `502 PROVIDER_SCHEMA`. The client never sees model output that has not been through
 * the schema (§0.5 S3).
 */

import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import {
  DreamPlanSchema,
  anchorPhraseFor,
  makeSignature,
  parseDreamPlan,
  renderSignaturePcm,
  systemClock,
  type Clock,
  type DreamPlan,
  type PlanProvider,
} from '@lucid/engine';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { ANCHOR_SAMPLE_RATE, AnchorMixError, mixAnchor, pcmToWav, resolveFfmpegPath } from './anchor';
import { createLogger, silentLogger, type Logger } from './logger';
import { createMemoryStore, type CachedAudio, type DeviceRecord, type Store } from './store';
import {
  TTS_MAX_TEXT,
  normalizeTtsAudio,
  sniffAudioContentType,
  type TtsAudio,
  type TtsProvider,
  type TtsRequest,
} from './providers/tts';

// ---------------------------------------------------------------------------
// Constants (all of them rails, none of them tuneables)
// ---------------------------------------------------------------------------

/** APP-RUN §0.5 S2. A dream description does not need 32 KB; an attack does. */
export const MAX_BODY_BYTES = 32 * 1024;

/** §0.5 S2: `/ai/*` 60 per hour per device. */
export const DEFAULT_RATE_LIMIT_PER_HOUR = 60;

/** Unauthenticated route, so it is capped per IP instead of per device. */
export const DEFAULT_DEVICE_LIMIT_PER_HOUR = 20;

const HOUR_MS = 60 * 60 * 1000;

/** 32 bytes = 256 bits of entropy (§0.5 S2), base64url ⇒ 43 characters. */
export const TOKEN_BYTES = 32;

/** One conversation is short by design (3 steps, ≤ 1 question). 20 turns is generous. */
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const DeviceBodySchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  appVersion: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+([-+.][0-9A-Za-z.]+)?$/, 'appVersion must look like 1.2.3'),
});

const PlanBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().min(1).max(MAX_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
  lang: z.enum(['th', 'en']),
  prior: DreamPlanSchema.nullish(),
});

const TtsBodySchema = z.object({
  text: z.string().min(1).max(TTS_MAX_TEXT),
  lang: z.enum(['th', 'en']),
  voice: z.literal('whisper'),
});

/**
 * `/ai/anchor`. The seed is whatever the app generated at onboarding (a uuid today) and is
 * capped at 64 characters: it is hashed into 32 bits by the engine, so a longer string buys
 * nothing and a 30 KB "seed" would only be a way to make us render 30 KB of melody.
 *
 * `voice` is the **vendor** voice name, and it is optional because there is no user-facing
 * voice picker (§2 principle 3) — it exists so the owner can compare two ElevenLabs voices
 * before pinning one in `TTS_VOICE`.
 */
const AnchorBodySchema = z.object({
  seed: z.string().min(1).max(64),
  lang: z.enum(['th', 'en']),
  voice: z.string().min(1).max(64).optional(),
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface StartServerOptions {
  /** `0` ⇒ the OS picks a free port (what the oracle uses). */
  port?: number;
  hostname?: string;
  provider: PlanProvider;
  /** Absent ⇒ `POST /ai/tts` answers `501 NOT_CONFIGURED` (no vendor picked yet). */
  ttsProvider?: TtsProvider | null;
  store?: 'memory' | 'sqlite';
  /** Only for `store: 'sqlite'`; defaults to `API_DB_PATH` or `./data/lucid-api.sqlite`. */
  dbPath?: string;
  clock?: Clock;
  rateLimitPerHour?: number;
  deviceLimitPerHour?: number;
  /** `true` ⇒ trust `x-forwarded-for` (we are behind our own nginx). */
  trustProxy?: boolean;
  logger?: Logger;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

interface AppDeps {
  provider: PlanProvider;
  ttsProvider: TtsProvider | null;
  store: Store;
  clock: Clock;
  rateLimitPerHour: number;
  deviceLimitPerHour: number;
  trustProxy: boolean;
  logger: Logger;
}

type AppEnv = { Variables: { device: DeviceRecord; tokenHash: string } };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 32 random bytes, base64url. `randomBytes` is the CSPRNG — never the engine's seeded rng. */
function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return first;
  }
  return getConnInfo(c).remote.address ?? 'unknown';
}

type BodyResult = { ok: true; raw: string } | { ok: false; status: 413 };

/**
 * Read the body with a hard ceiling.
 *
 * We do not use `c.req.json()` because by the time it has parsed, the bytes are already in
 * memory. Here the stream is read chunk by chunk and abandoned the moment it crosses
 * {@link MAX_BODY_BYTES} — the `content-length` check in the middleware is only a fast path
 * for honest clients.
 */
async function readBodyLimited(c: Context): Promise<BodyResult> {
  const stream = c.req.raw.body;
  if (!stream) return { ok: true, raw: '' };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { ok: true, raw: Buffer.concat(chunks).toString('utf8') };
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { store, clock, logger } = deps;

  /** Fast path for the size cap: believe a `content-length` that is already too big. */
  app.use('*', async (c, next) => {
    const declared = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      logger.warn('body.too_large', { path: c.req.path, declared });
      return c.json({ error: 'BODY_TOO_LARGE', limit: MAX_BODY_BYTES }, 413);
    }
    await next();
    return undefined;
  });

  /** Bearer device token. Anything else — no header, wrong scheme, revoked token — is 401. */
  const requireDevice = async (c: Context<AppEnv>, next: () => Promise<void>): Promise<Response | undefined> => {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match?.[1]) {
      logger.warn('auth.missing', { path: c.req.path });
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    const tokenHash = sha256(match[1]);
    const device = store.findDeviceByTokenHash(tokenHash);
    if (!device) {
      logger.warn('auth.unknown_token', { path: c.req.path });
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    c.set('device', device);
    c.set('tokenHash', tokenHash);
    await next();
    return undefined;
  };

  /** Sliding hour. Returns `false` when the caller is over the limit (nothing is recorded). */
  function allow(key: string, limit: number): boolean {
    const now = clock.now();
    const used = store.countHitsSince(key, now - HOUR_MS);
    if (used >= limit) return false;
    store.recordHit(key, now);
    return true;
  }

  /** Read + JSON + zod in one place so every route fails the same way. */
  async function body<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
    const read = await readBodyLimited(c);
    if (!read.ok) {
      logger.warn('body.too_large_stream', { path: c.req.path });
      return { ok: false, res: c.json({ error: 'BODY_TOO_LARGE', limit: MAX_BODY_BYTES }, 413) };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(read.raw);
    } catch {
      return { ok: false, res: c.json({ error: 'INVALID_JSON' }, 400) };
    }

    const result = schema.safeParse(parsedJson);
    if (!result.success) {
      // Field paths only — never the values, which are the user's own words (§0.5 S5).
      const fields = result.error.issues.map((issue) => issue.path.join('.')).slice(0, 8);
      logger.warn('body.invalid', { path: c.req.path, fields: fields.join(',') });
      return { ok: false, res: c.json({ error: 'INVALID_BODY', fields }, 400) };
    }

    return { ok: true, data: result.data };
  }

  // -------------------------------------------------------------------------

  app.get('/health', (c) => c.json({ ok: true, at: clock.nowIso(), store: store.kind }));

  app.post('/device', async (c) => {
    const parsed = await body(c, DeviceBodySchema);
    if (!parsed.ok) return parsed.res;

    const ip = clientIp(c, deps.trustProxy);
    if (!allow(`ip:${ip}`, deps.deviceLimitPerHour)) {
      logger.warn('device.rate_limited', {});
      return c.json({ error: 'RATE_LIMIT' }, 429);
    }

    const token = newToken();
    const deviceId = randomUUID();
    store.createDevice({
      deviceId,
      tokenHash: sha256(token),
      platform: parsed.data.platform,
      appVersion: parsed.data.appVersion,
      createdAt: clock.nowIso(),
    });

    logger.info('device.created', { deviceId, platform: parsed.data.platform, appVersion: parsed.data.appVersion });
    // The only time the token exists outside the phone's Keychain is this response body.
    return c.json({ deviceId, token }, 201);
  });

  app.delete('/device', requireDevice, (c) => {
    const tokenHash = c.get('tokenHash');
    const device = c.get('device');
    store.deleteDeviceByTokenHash(tokenHash);
    logger.info('device.deleted', { deviceId: device.deviceId });
    return c.body(null, 204);
  });

  app.post('/ai/plan', requireDevice, async (c) => {
    const device = c.get('device');
    const parsed = await body(c, PlanBodySchema);
    if (!parsed.ok) return parsed.res;

    if (!allow(`dev:${device.deviceId}:ai`, deps.rateLimitPerHour)) {
      logger.warn('plan.rate_limited', { deviceId: device.deviceId });
      return c.json({ error: 'RATE_LIMIT', limitPerHour: deps.rateLimitPerHour }, 429);
    }

    const started = clock.now();
    let raw: unknown;
    try {
      raw = await deps.provider.plan({
        messages: parsed.data.messages,
        lang: parsed.data.lang,
        prior: parsed.data.prior ?? null,
      });
    } catch (error) {
      logger.error('plan.provider_failed', {
        deviceId: device.deviceId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return c.json({ error: 'PROVIDER_UNAVAILABLE' }, 502);
    }

    const plan = parseDreamPlan(raw);
    if (!plan) {
      logger.error('plan.provider_schema', { deviceId: device.deviceId, ms: clock.now() - started });
      return c.json({ error: 'PROVIDER_SCHEMA' }, 502);
    }

    // Defence in depth: the advisor on the phone pins the watermark too, but a plan that
    // leaves this server must already be correct — clients get patched later than servers.
    const safe: DreamPlan = { ...plan, anchorPhrase: anchorPhraseFor(parsed.data.lang) };

    logger.info('plan.ok', {
      deviceId: device.deviceId,
      lang: parsed.data.lang,
      turns: parsed.data.messages.length,
      clarify: safe.clarify !== null && safe.clarify !== undefined,
      ambience: safe.ambienceKey,
      ms: clock.now() - started,
    });
    return c.json(safe, 200);
  });

  /**
   * Cache key of one whispered clip: `sha256(sentence|language|voice)`.
   *
   * The sentence is the same for every user in a language (§2 principle 3), so the cache is
   * global on purpose and holds no personal data (DESIGN §6). `voice` is `whisper` — the
   * style — unless the caller named a vendor voice, in which case that voice gets its own
   * row instead of overwriting everybody's clip.
   */
  function whisperKey(text: string, lang: 'th' | 'en', voice: string): string {
    return sha256(`${text}|${lang}|${voice}`);
  }

  type WhisperFailure = 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_SCHEMA';
  type WhisperResult = { ok: true; audio: CachedAudio; cached: boolean } | { ok: false; error: WhisperFailure };

  /**
   * The whisper, from the cache or from the vendor — the one place that spends money.
   *
   * The cache is checked **before** the "is a vendor configured" test on purpose: a box
   * whose key has been removed can still serve the clips it already has.
   */
  async function whisper(key: string, request: TtsRequest, deviceId: string): Promise<WhisperResult> {
    const cached = store.ttsGet(key);
    if (cached) return { ok: true, audio: cached, cached: true };

    const render = deps.ttsProvider;
    if (!render) {
      logger.warn('tts.not_configured', { deviceId });
      return { ok: false, error: 'NOT_CONFIGURED' };
    }

    let raw: Buffer | TtsAudio;
    try {
      raw = await render(request);
    } catch (error) {
      logger.error('tts.provider_failed', {
        deviceId,
        // `TtsError.code` when the adapter threw one; the class name otherwise. Never the
        // message of an unknown error — a vendor can put the sentence in it.
        reason: (error as { code?: string })?.code ?? (error instanceof Error ? error.name : 'unknown'),
      });
      return { ok: false, error: 'PROVIDER_UNAVAILABLE' };
    }

    const normalized = normalizeTtsAudio(raw);
    if (!normalized) {
      logger.error('tts.bad_audio', { deviceId, bytes: Buffer.isBuffer(raw) ? raw.byteLength : -1 });
      return { ok: false, error: 'PROVIDER_SCHEMA' };
    }

    const audio: CachedAudio = { audio: normalized.buffer, contentType: normalized.contentType };
    store.ttsPut(key, audio);
    return { ok: true, audio, cached: false };
  }

  const whisperStatus: Record<WhisperFailure, 501 | 502> = {
    NOT_CONFIGURED: 501,
    PROVIDER_UNAVAILABLE: 502,
    PROVIDER_SCHEMA: 502,
  };

  app.post('/ai/tts', requireDevice, async (c) => {
    const device = c.get('device');
    const parsed = await body(c, TtsBodySchema);
    if (!parsed.ok) return parsed.res;

    if (!allow(`dev:${device.deviceId}:ai`, deps.rateLimitPerHour)) {
      logger.warn('tts.rate_limited', { deviceId: device.deviceId });
      return c.json({ error: 'RATE_LIMIT', limitPerHour: deps.rateLimitPerHour }, 429);
    }

    const { text, lang, voice } = parsed.data;
    const result = await whisper(whisperKey(text, lang, voice), { text, lang, voice }, device.deviceId);
    if (!result.ok) return c.json({ error: result.error }, whisperStatus[result.error]);

    const { audio, contentType } = result.audio;
    logger.info(result.cached ? 'tts.hit' : 'tts.miss', {
      deviceId: device.deviceId,
      lang,
      bytes: audio.byteLength,
    });
    return new Response(new Uint8Array(audio), {
      status: 200,
      headers: {
        'content-type': contentType,
        'x-cache': result.cached ? 'HIT' : 'MISS',
        'cache-control': 'private, max-age=86400',
      },
    });
  });

  /**
   * `POST /ai/anchor` — build the user's watermark file once, then serve it from the cache
   * forever (DESIGN §2 principle 3 · §6 "สร้างลายน้ำเสียงสมอ").
   *
   * Order of work, and every step of it is deliberate:
   *
   *   1. **ffmpeg first.** If the mixer is missing, the request cannot succeed — and the
   *      whisper costs real money. Checking the free thing before the paid thing is the
   *      difference between a 501 and a 501 with a bill.
   *   2. **The melody is free and deterministic** (`makeSignature` + `renderSignaturePcm`
   *      out of `@lucid/engine`), so it is never cached: rebuilding it is cheaper than a
   *      cache lookup, and it is the same bytes on the phone and here.
   *   3. **The whisper comes from the shared cache**, which means the second user in a
   *      language never pays for it and the anchor cache miss path costs nothing but CPU.
   *   4. **The mix is cached under the hash of everything that went into it** — including
   *      the hash of the whisper bytes, so re-rendering the sentence with a different voice
   *      produces a different file instead of quietly serving yesterday's.
   */
  app.post('/ai/anchor', requireDevice, async (c) => {
    const device = c.get('device');
    const parsed = await body(c, AnchorBodySchema);
    if (!parsed.ok) return parsed.res;

    if (!allow(`dev:${device.deviceId}:ai`, deps.rateLimitPerHour)) {
      logger.warn('anchor.rate_limited', { deviceId: device.deviceId });
      return c.json({ error: 'RATE_LIMIT', limitPerHour: deps.rateLimitPerHour }, 429);
    }

    const ffmpegPath = resolveFfmpegPath(process.env);
    if (!ffmpegPath) {
      logger.error('anchor.no_ffmpeg', { deviceId: device.deviceId });
      return c.json(
        { error: 'NOT_CONFIGURED', detail: 'ffmpeg is not installed on this server (set FFMPEG_PATH)' },
        501,
      );
    }

    const started = clock.now();
    const { seed, lang } = parsed.data;
    // No vendor voice named ⇒ the key says `whisper`, which is the same key `/ai/tts` uses:
    // one render serves both endpoints. A named voice gets its own row.
    const voiceKey = parsed.data.voice?.trim() || 'whisper';

    const signature = makeSignature(seed, lang);
    const phrase = anchorPhraseFor(lang);

    const spoken = await whisper(
      whisperKey(phrase, lang, voiceKey),
      { text: phrase, lang, voice: 'whisper', voiceName: parsed.data.voice },
      device.deviceId,
    );
    if (!spoken.ok) {
      const detail =
        spoken.error === 'NOT_CONFIGURED' ? 'no TTS provider configured (set TTS_PROVIDER and FAL_KEY)' : undefined;
      return c.json({ error: spoken.error, detail }, whisperStatus[spoken.error]);
    }

    const key = sha256(
      `anchor|${seed}|${lang}|${voiceKey}|${signature.hash}|${sha256(spoken.audio.audio)}`,
    );

    const headers = (cache: 'HIT' | 'MISS'): Record<string, string> => ({
      'content-type': 'audio/mpeg',
      'x-cache': cache,
      'x-anchor-hash': signature.hash,
      'x-anchor-notes': signature.notes.join(','),
      'cache-control': 'private, max-age=86400',
    });

    const cached = store.ttsGet(key);
    if (cached) {
      logger.info('anchor.hit', { deviceId: device.deviceId, lang, bytes: cached.audio.byteLength });
      return new Response(new Uint8Array(cached.audio), { status: 200, headers: headers('HIT') });
    }

    let mp3: Buffer;
    try {
      mp3 = await mixAnchor({
        signature: pcmToWav(renderSignaturePcm(signature, ANCHOR_SAMPLE_RATE), ANCHOR_SAMPLE_RATE),
        whisper: spoken.audio.audio,
        whisperContentType: spoken.audio.contentType === 'audio/wav' ? 'audio/wav' : 'audio/mpeg',
        ffmpegPath,
      });
    } catch (error) {
      // Our own tool failed, not the client and not the vendor — so this is a 500, and the
      // reason is a code (`FFMPEG_FAILED` / `FFMPEG_TIMEOUT`), never ffmpeg's stderr.
      logger.error('anchor.mix_failed', {
        deviceId: device.deviceId,
        reason: error instanceof AnchorMixError ? error.code : error instanceof Error ? error.name : 'unknown',
      });
      return c.json({ error: 'MIX_FAILED' }, 500);
    }

    if (sniffAudioContentType(mp3) !== 'audio/mpeg') {
      logger.error('anchor.bad_output', { deviceId: device.deviceId, bytes: mp3.byteLength });
      return c.json({ error: 'MIX_FAILED' }, 500);
    }

    store.ttsPut(key, { audio: mp3, contentType: 'audio/mpeg' });
    logger.info('anchor.miss', {
      deviceId: device.deviceId,
      lang,
      hash: signature.hash,
      notes: signature.notes.length,
      whisperCached: spoken.cached,
      bytes: mp3.byteLength,
      ms: clock.now() - started,
    });
    return new Response(new Uint8Array(mp3), { status: 200, headers: headers('MISS') });
  });

  app.notFound((c) => c.json({ error: 'NOT_FOUND' }, 404));

  app.onError((error, c) => {
    // Never leak a stack or a message to the client, and never log the body.
    logger.error('unhandled', { path: c.req.path, reason: error.name });
    return c.json({ error: 'INTERNAL' }, 500);
  });

  return app;
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const kind = options.store ?? 'memory';
  let store: Store;
  if (kind === 'sqlite') {
    // Imported lazily so the native module is never loaded by the oracle or a dev run.
    const { createSqliteStore } = await import('./store-sqlite');
    store = createSqliteStore(options.dbPath ?? process.env.API_DB_PATH ?? './data/lucid-api.sqlite');
  } else {
    store = createMemoryStore();
  }

  const app = createApp({
    provider: options.provider,
    ttsProvider: options.ttsProvider ?? null,
    store,
    clock: options.clock ?? systemClock,
    rateLimitPerHour: options.rateLimitPerHour ?? DEFAULT_RATE_LIMIT_PER_HOUR,
    deviceLimitPerHour: options.deviceLimitPerHour ?? DEFAULT_DEVICE_LIMIT_PER_HOUR,
    trustProxy: options.trustProxy ?? false,
    // Quiet under vitest: 11 oracle cases would otherwise bury the failures in JSON lines.
    logger: options.logger ?? (process.env.NODE_ENV === 'test' ? silentLogger : createLogger()),
  });

  const hostname = options.hostname ?? '127.0.0.1';
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const instance = serve({ fetch: app.fetch, port: options.port ?? 0, hostname }, () => resolve(instance));
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);

  return {
    url: `http://${hostname}:${port}`,
    port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      store.close();
    },
  };
}

/**
 * `main.ts` — the production entry point (systemd unit `lucid-api`, see `systemd/`).
 *
 * Everything it does is read the environment, wire the real provider and start the server.
 * Two deliberate refusals to boot, because both would be silent failures in production:
 *
 *   * **no `OPENROUTER_API_KEY`** ⇒ exit 1. The alternative — quietly falling back to the
 *     mock — would serve six canned dreams to real users and nobody would notice for days.
 *     `AI_ALLOW_MOCK=1` is the explicit opt-in for a staging box.
 *   * **`API_DB_PATH` inside the repo** is allowed but warned about: a database that lives
 *     in the working tree gets wiped by a `git clean` one day.
 *
 * The key itself only ever exists in `apps/api/.env` (mode 600, `EnvironmentFile=` in the
 * unit) — never in the repo, never in a log line (APP-RUN §0.3 item 3 · §0.5 S1).
 */

import { createMockPlanProvider } from './providers/mock';
import { createOpenRouterProvider } from './providers/openrouter';
import { createOpenRouterScoreProvider } from './providers/openrouter-score';
import { mockScoreProvider, type ScoreProvider } from './providers/score';
import { resolveTtsProvider, type TtsProvider } from './providers/tts';
import { createFalTtsProvider } from './providers/tts-fal';
import { resolveFfmpegPath } from './anchor';
import { createLogger } from './logger';
import { startServer, DEFAULT_RATE_LIMIT_PER_HOUR } from './server';
import type { PlanProvider } from '@lucid/engine';

const logger = createLogger();

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** One place for "which model, reached how" — `/ai/plan` and `/ai/score` share it. */
function openRouterSettings(apiKey: string): {
  apiKey: string;
  model: string;
  fallbackModel: string;
  referer: string;
  title: string;
  timeoutMs: number;
} {
  return {
    apiKey,
    model: process.env.AI_MODEL?.trim() || 'anthropic/claude-opus-5',
    fallbackModel: process.env.AI_MODEL_FALLBACK?.trim() || 'anthropic/claude-sonnet-5',
    referer: process.env.AI_REFERER?.trim() || 'https://lucid.suksomsri.cloud',
    title: process.env.AI_TITLE?.trim() || 'Lucid Dreams',
    timeoutMs: intFromEnv('AI_TIMEOUT_MS', 20_000),
  };
}

function resolvePlanProvider(): PlanProvider {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    if (process.env.AI_ALLOW_MOCK === '1') {
      logger.warn('provider.mock', { reason: 'no OPENROUTER_API_KEY, AI_ALLOW_MOCK=1' });
      return createMockPlanProvider();
    }
    logger.error('provider.missing_key', {
      hint: 'set OPENROUTER_API_KEY in apps/api/.env (or AI_ALLOW_MOCK=1 for a staging box)',
    });
    process.exit(1);
  }

  const settings = openRouterSettings(apiKey);
  logger.info('provider.openrouter', { model: settings.model, fallbackModel: settings.fallbackModel });
  return createOpenRouterProvider(settings);
}

/**
 * The morning provider (`/ai/score` · `/ai/weekly`, L3.2).
 *
 * Same key and same model as the plan: one `AI_MODEL` for the whole product, because two
 * model settings is two things to get wrong on the night the owner changes one of them.
 * The only tuneable of its own is the answer budget, which is smaller than a plan's.
 * Reached only after {@link resolvePlanProvider}, so a missing key here means
 * `AI_ALLOW_MOCK=1` was set on purpose.
 */
function resolveScoreProvider(): ScoreProvider {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    logger.warn('score.mock', { reason: 'no OPENROUTER_API_KEY, AI_ALLOW_MOCK=1' });
    return mockScoreProvider;
  }

  return createOpenRouterScoreProvider({
    ...openRouterSettings(apiKey),
    maxTokens: intFromEnv('AI_SCORE_MAX_TOKENS', 700),
  });
}

/**
 * The TTS vendor (owner decision 24 ก.ย.: **fal.ai → ElevenLabs eleven-v3**).
 *
 * Unlike the plan provider, a missing key here is **not** a reason to refuse to boot: the
 * whisper is one file per language that is cached forever, so a server with no `FAL_KEY`
 * still serves every clip it has already rendered and answers `501 NOT_CONFIGURED` for the
 * ones it has not. Refusing to start would take `/ai/plan` down with it for no reason.
 */
function resolveTts(): TtsProvider | null {
  if (process.env.TTS_PROVIDER?.trim() !== 'fal') return resolveTtsProvider(process.env);

  const apiKey = process.env.FAL_KEY?.trim();
  if (!apiKey) {
    logger.error('tts.missing_key', { hint: 'TTS_PROVIDER=fal needs FAL_KEY in apps/api/.env' });
    return null;
  }

  const voice = process.env.TTS_VOICE?.trim() || undefined;
  // The key is never logged — only that there is one, and how long it was.
  logger.info('tts.fal', { voice: voice ?? 'default', keyLen: apiKey.length });
  return createFalTtsProvider({
    apiKey,
    defaultVoice: voice,
    timeoutMs: intFromEnv('TTS_TIMEOUT_MS', 30_000),
    logger,
  });
}

async function main(): Promise<void> {
  const port = intFromEnv('PORT', 8787);
  const dbPath = process.env.API_DB_PATH?.trim() || './data/lucid-api.sqlite';
  const ttsProvider = resolveTts();

  const server = await startServer({
    port,
    hostname: process.env.HOST?.trim() || '127.0.0.1',
    provider: resolvePlanProvider(),
    scoreProvider: resolveScoreProvider(),
    ttsProvider,
    store: 'sqlite',
    dbPath,
    rateLimitPerHour: intFromEnv('API_RATE_LIMIT_PER_HOUR', DEFAULT_RATE_LIMIT_PER_HOUR),
    deviceLimitPerHour: intFromEnv('API_DEVICE_LIMIT_PER_HOUR', 20),
    // We are always behind our own nginx in production, so `x-forwarded-for` is ours.
    trustProxy: process.env.API_TRUST_PROXY !== '0',
    logger,
  });

  logger.info('listening', {
    url: server.url,
    dbPath,
    tts: ttsProvider === null ? 'none' : 'configured',
    // `/ai/anchor` needs the mixer; say so at boot instead of at 3 a.m. in a 501.
    ffmpeg: resolveFfmpegPath(process.env) ?? 'missing',
  });

  const shutdown = (signal: string): void => {
    logger.info('shutdown', { signal });
    void server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

await main();

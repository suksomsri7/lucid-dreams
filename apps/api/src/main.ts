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
import { resolveTtsProvider } from './providers/tts';
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

  const model = process.env.AI_MODEL?.trim() || 'anthropic/claude-opus-5';
  const fallbackModel = process.env.AI_MODEL_FALLBACK?.trim() || 'anthropic/claude-sonnet-5';
  logger.info('provider.openrouter', { model, fallbackModel });

  return createOpenRouterProvider({
    apiKey,
    model,
    fallbackModel,
    referer: process.env.AI_REFERER?.trim() || 'https://lucid.suksomsri.cloud',
    title: process.env.AI_TITLE?.trim() || 'Lucid Dreams',
    timeoutMs: intFromEnv('AI_TIMEOUT_MS', 20_000),
  });
}

async function main(): Promise<void> {
  const port = intFromEnv('PORT', 8787);
  const dbPath = process.env.API_DB_PATH?.trim() || './data/lucid-api.sqlite';
  const ttsProvider = resolveTtsProvider(process.env);

  const server = await startServer({
    port,
    hostname: process.env.HOST?.trim() || '127.0.0.1',
    provider: resolvePlanProvider(),
    ttsProvider,
    store: 'sqlite',
    dbPath,
    rateLimitPerHour: intFromEnv('API_RATE_LIMIT_PER_HOUR', DEFAULT_RATE_LIMIT_PER_HOUR),
    deviceLimitPerHour: intFromEnv('API_DEVICE_LIMIT_PER_HOUR', 20),
    // We are always behind our own nginx in production, so `x-forwarded-for` is ours.
    trustProxy: process.env.API_TRUST_PROXY !== '0',
    logger,
  });

  logger.info('listening', { url: server.url, dbPath, tts: ttsProvider === null ? 'none' : 'configured' });

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

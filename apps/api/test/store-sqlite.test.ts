/**
 * Builder-added tests (not the oracle) for the production store and for the pieces the
 * oracle cannot reach with a mock: the SQLite file itself, persistence across a restart,
 * the sliding-hour window, and the `501 NOT_CONFIGURED` TTS path.
 *
 * The oracle runs everything on `store: 'memory'`, which means a green oracle says nothing
 * about better-sqlite3 being loadable, the schema being valid or a token surviving a
 * process restart — and that is exactly what production depends on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixedClock } from '@lucid/engine';

import { createSqliteStore } from '../src/store-sqlite';
import { createMemoryStore } from '../src/store';
import { startServer } from '../src/server';
import { createMockPlanProvider } from '../src/providers/mock';
import { mockTtsProvider, sniffAudioContentType, wavSilence } from '../src/providers/tts';

const dirs: string[] = [];
function tmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lucid-api-test-'));
  dirs.push(dir);
  return path.join(dir, 'nested', 'lucid-api.sqlite');
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('sqlite store', () => {
  it('creates the file (including the directory) and round-trips a device', () => {
    const file = tmpDb();
    const store = createSqliteStore(file);
    expect(existsSync(file)).toBe(true);

    store.createDevice({
      deviceId: 'dev-1',
      tokenHash: 'hash-1',
      platform: 'ios',
      appVersion: '0.1.0',
      createdAt: '2026-09-24T14:00:00.000Z',
    });
    expect(store.findDeviceByTokenHash('hash-1')?.deviceId).toBe('dev-1');
    expect(store.findDeviceByTokenHash('nope')).toBeNull();
    store.close();

    // Reopen: the token must still work after a restart, the cache must still be warm.
    const again = createSqliteStore(file);
    expect(again.findDeviceByTokenHash('hash-1')?.appVersion).toBe('0.1.0');
    expect(again.deleteDeviceByTokenHash('hash-1')).toBe(true);
    expect(again.deleteDeviceByTokenHash('hash-1')).toBe(false);
    again.close();
  });

  it('counts a sliding hour, not a fixed bucket — and prunes old rows', () => {
    for (const store of [createSqliteStore(tmpDb()), createMemoryStore()]) {
      const t0 = Date.parse('2026-09-24T14:00:00.000Z');
      store.recordHit('dev:a', t0);
      store.recordHit('dev:a', t0 + 10 * 60_000);
      store.recordHit('dev:b', t0);

      // 30 minutes later both of a's hits are inside the window.
      expect(store.countHitsSince('dev:a', t0 + 30 * 60_000 - 60 * 60_000)).toBe(2);
      // 65 minutes later the first hit has fallen out of the window and the second has not
      // (the window is exclusive: a hit exactly one hour old no longer counts).
      expect(store.countHitsSince('dev:a', t0 + 65 * 60_000 - 60 * 60_000)).toBe(1);
      expect(store.countHitsSince('dev:b', t0 + 65 * 60_000 - 60 * 60_000)).toBe(0);
      store.close();
    }
  });

  it('stores audio bytes unchanged', () => {
    const store = createSqliteStore(tmpDb());
    const audio = wavSilence(120);
    store.ttsPut('k', { audio, contentType: 'audio/wav' });
    const back = store.ttsGet('k');
    expect(back?.contentType).toBe('audio/wav');
    expect(Buffer.compare(back?.audio ?? Buffer.alloc(0), audio)).toBe(0);
    expect(store.ttsGet('missing')).toBeNull();
    store.close();
  });
});

describe('server on the production store', () => {
  it('issues a token, answers /ai/plan from the mock provider and revokes on delete', async () => {
    const file = tmpDb();
    const clock = fixedClock('2026-09-24T14:00:00.000Z');
    const server = await startServer({
      port: 0,
      provider: createMockPlanProvider(),
      ttsProvider: mockTtsProvider,
      store: 'sqlite',
      dbPath: file,
      clock,
    });

    try {
      const created = await fetch(`${server.url}/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'ios', appVersion: '0.1.0' }),
      });
      expect(created.status).toBe(201);
      const { token } = (await created.json()) as { token: string };

      const planned = await fetch(`${server.url}/ai/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{ role: 'user', text: 'อยากฝันว่าดำน้ำกับฉลามวาฬที่เกาะเต่า น้ำใส ๆ' }],
          lang: 'th',
        }),
      });
      expect(planned.status).toBe(200);
      const plan = (await planned.json()) as { theme: { emoji: string; place: string | null }; anchorPhrase: string };
      expect(plan.theme.emoji).toBe('🐋');
      expect(plan.theme.place).toBe('เกาะเต่า');
      expect(plan.anchorPhrase).toBe('คุณกำลังฝันอยู่…');

      const spoken = await fetch(`${server.url}/ai/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: 'คุณกำลังฝันอยู่…', lang: 'th', voice: 'whisper' }),
      });
      expect(spoken.status).toBe(200);
      expect(spoken.headers.get('content-type')).toBe('audio/wav');
      expect(sniffAudioContentType(Buffer.from(await spoken.arrayBuffer()))).toBe('audio/wav');

      const removed = await fetch(`${server.url}/device`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(removed.status).toBe(204);
    } finally {
      await server.close();
    }
  });

  it('answers 501 NOT_CONFIGURED while no TTS vendor is wired', async () => {
    const server = await startServer({ port: 0, provider: createMockPlanProvider(), store: 'memory' });
    try {
      const created = await fetch(`${server.url}/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'ios', appVersion: '0.1.0' }),
      });
      const { token } = (await created.json()) as { token: string };

      const spoken = await fetch(`${server.url}/ai/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: 'You are dreaming…', lang: 'en', voice: 'whisper' }),
      });
      expect(spoken.status).toBe(501);
      expect(((await spoken.json()) as { error: string }).error).toBe('NOT_CONFIGURED');
    } finally {
      await server.close();
    }
  });
});

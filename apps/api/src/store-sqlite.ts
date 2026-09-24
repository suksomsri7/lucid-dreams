/**
 * `store-sqlite.ts` — the production store (better-sqlite3).
 *
 * In its own module and loaded with a dynamic `import()` from `server.ts` so that the
 * oracle (and any dev machine without a compiled native module) never touches
 * better-sqlite3 at all. One file on disk, WAL on, three tables — the whole server state
 * fits in a few kilobytes per thousand devices.
 *
 * Why SQLite and not Postgres (decision recorded in APP-RUN §2 L1.5): the three tables
 * here are per-device counters and a blob cache, there is exactly one writer process,
 * and the app is the source of truth for everything that matters (DESIGN §2 principle 6
 * — data lives on the phone). A Postgres would add a daemon, a backup story and a
 * migration tool for state we could rebuild by deleting the file.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type { CachedAudio, DeviceRecord, Store } from './store';

interface DeviceRow {
  device_id: string;
  platform: string;
  app_version: string;
  created_at: string;
}

export function createSqliteStore(dbPath: string): Store {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 4000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      token_sha256 TEXT PRIMARY KEY,
      device_id    TEXT NOT NULL UNIQUE,
      platform     TEXT NOT NULL,
      app_version  TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate (
      key   TEXT NOT NULL,
      at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rate_key_at ON rate (key, at_ms);
    CREATE TABLE IF NOT EXISTS tts_cache (
      cache_key    TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      audio        BLOB NOT NULL,
      created_at   TEXT NOT NULL
    );
  `);

  const insertDevice = db.prepare(
    'INSERT INTO devices (token_sha256, device_id, platform, app_version, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const selectDevice = db.prepare<[string], DeviceRow>(
    'SELECT device_id, platform, app_version, created_at FROM devices WHERE token_sha256 = ?',
  );
  const deleteDevice = db.prepare('DELETE FROM devices WHERE token_sha256 = ?');
  const countHits = db.prepare<[string, number], { n: number }>(
    'SELECT COUNT(*) AS n FROM rate WHERE key = ? AND at_ms > ?',
  );
  const insertHit = db.prepare('INSERT INTO rate (key, at_ms) VALUES (?, ?)');
  const pruneHits = db.prepare('DELETE FROM rate WHERE at_ms <= ?');
  const selectTts = db.prepare<[string], { content_type: string; audio: Buffer }>(
    'SELECT content_type, audio FROM tts_cache WHERE cache_key = ?',
  );
  const insertTts = db.prepare(
    'INSERT OR REPLACE INTO tts_cache (cache_key, content_type, audio, created_at) VALUES (?, ?, ?, ?)',
  );

  return {
    kind: 'sqlite',

    createDevice(record) {
      insertDevice.run(record.tokenHash, record.deviceId, record.platform, record.appVersion, record.createdAt);
    },

    findDeviceByTokenHash(tokenHash): DeviceRecord | null {
      const row = selectDevice.get(tokenHash);
      if (!row) return null;
      return {
        deviceId: row.device_id,
        platform: row.platform,
        appVersion: row.app_version,
        createdAt: row.created_at,
      };
    },

    deleteDeviceByTokenHash(tokenHash) {
      return deleteDevice.run(tokenHash).changes > 0;
    },

    countHitsSince(key, sinceMs) {
      // Prune the whole table, not just this key: rows older than the window are dead
      // weight for every device and this is the only statement that runs often enough
      // to be a good place to do it.
      pruneHits.run(sinceMs);
      return countHits.get(key, sinceMs)?.n ?? 0;
    },

    recordHit(key, atMs) {
      insertHit.run(key, atMs);
    },

    ttsGet(key): CachedAudio | null {
      const row = selectTts.get(key);
      if (!row) return null;
      return { audio: Buffer.from(row.audio), contentType: row.content_type };
    },

    ttsPut(key, value) {
      insertTts.run(key, value.contentType, value.audio, new Date().toISOString());
    },

    close() {
      db.close();
    },
  };
}

/**
 * `store.ts` — the three tiny bits of state the AI server keeps.
 *
 * 1. **devices** — one row per install: `deviceId` + the **SHA-256 of** its token.
 *    The token itself is never stored (APP-RUN §0.5 S1/S2): a dump of this file
 *    cannot be replayed against the API. Deleting the row is a full logout and the
 *    server side of "ลบทั้งหมด" (§0.5 S4).
 * 2. **rate** — one row per `/ai/*` hit, so the limit is a real sliding hour instead
 *    of a fixed bucket an attacker can straddle at :59.
 * 3. **tts_cache** — the rendered anchor clip per (sentence · language · voice).
 *    The whispered sentence is the same every night for every user, so this cache is
 *    the difference between one TTS call per user and one per night (DESIGN §6).
 *
 * Two implementations behind one interface: `memory` (the oracle, and a dev run with
 * no native module) and `sqlite` (production). No Postgres in this phase — decision
 * recorded in APP-RUN §2 L1.5.
 */

export interface DeviceRecord {
  deviceId: string;
  platform: string;
  appVersion: string;
  createdAt: string;
}

export interface CachedAudio {
  audio: Buffer;
  contentType: string;
}

export interface Store {
  readonly kind: 'memory' | 'sqlite';
  createDevice(record: DeviceRecord & { tokenHash: string }): void;
  findDeviceByTokenHash(tokenHash: string): DeviceRecord | null;
  deleteDeviceByTokenHash(tokenHash: string): boolean;
  /** How many hits this key made since `sinceMs` (exclusive). */
  countHitsSince(key: string, sinceMs: number): number;
  recordHit(key: string, atMs: number): void;
  ttsGet(key: string): CachedAudio | null;
  ttsPut(key: string, value: CachedAudio): void;
  close(): void;
}

export function createMemoryStore(): Store {
  const devices = new Map<string, DeviceRecord>();
  const hits = new Map<string, number[]>();
  const tts = new Map<string, CachedAudio>();

  return {
    kind: 'memory',

    createDevice(record) {
      const { tokenHash, ...device } = record;
      devices.set(tokenHash, device);
    },

    findDeviceByTokenHash(tokenHash) {
      return devices.get(tokenHash) ?? null;
    },

    deleteDeviceByTokenHash(tokenHash) {
      return devices.delete(tokenHash);
    },

    countHitsSince(key, sinceMs) {
      const stamps = hits.get(key);
      if (!stamps) return 0;
      // Prune while counting: an in-memory store that only ever grows is a leak.
      const kept = stamps.filter((at) => at > sinceMs);
      hits.set(key, kept);
      return kept.length;
    },

    recordHit(key, atMs) {
      const stamps = hits.get(key) ?? [];
      stamps.push(atMs);
      hits.set(key, stamps);
    },

    ttsGet(key) {
      return tts.get(key) ?? null;
    },

    ttsPut(key, value) {
      tts.set(key, value);
    },

    close() {
      devices.clear();
      hits.clear();
      tts.clear();
    },
  };
}

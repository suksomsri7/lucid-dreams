/**
 * Web-only QC fixture switch (Fable parity review round, WO L1.3): lets the "found"
 * happy-path state from mockup `01-onboarding.png` actually be screenshotted, since
 * Phase 1 has no real device pairing yet (Watch link is L2.2, BLE is L2.3) — without
 * this, every render honestly shows the empty state instead (see
 * `ledger/wo-notes/L1.3.md` parity table).
 *
 * Guarded so it can never reach a real device: `__DEV__` covers native dev builds,
 * `Platform.OS === 'web'` covers the QC export (which is a release bundle as far as
 * `__DEV__` is concerned, since `expo export` always builds for production) — a
 * **native release build is neither**, so every function below is a no-op there and the
 * whole module does nothing at runtime.
 *
 * Usage (URL query string, read once per page load):
 * - `?fixture=devices` — populate `DeviceRegistry` with a connected Apple Watch Series 9
 *   (84% battery) and Sleep A20 (92% battery), matching mockup 01(b) exactly.
 * - `?fixture=accepted` — pre-tick the welcome screen's consent checkbox (mockup 01(a)).
 */

import { Platform } from 'react-native';

import { deviceRegistry, HEADPHONES_DEVICE_ID, WATCH_DEVICE_ID } from '../devices/registry';

const FIXTURES_ENABLED = __DEV__ || Platform.OS === 'web';

function readFixtureParam(): string | null {
  if (!FIXTURES_ENABLED) return null;
  // `window`/`location` only exist on web; a native dev build has nothing to read a
  // query string from, so it simply never has a fixture requested.
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) return null;
  return new URLSearchParams(window.location.search).get('fixture');
}

/**
 * Call once from the devices screen's mount effect, right after
 * `refreshDevicesFromPlatform()` — this overwrites the same registry entry ids
 * (`WATCH_DEVICE_ID`/`HEADPHONES_DEVICE_ID`), so the fixture cleanly replaces whatever
 * the real (empty, on web) platform read reported, rather than adding a second, hidden
 * entry alongside it.
 */
export function applyDeviceFoundFixture(): void {
  if (readFixtureParam() !== 'devices') return;
  const now = new Date().toISOString();
  deviceRegistry.add({
    id: WATCH_DEVICE_ID,
    category: 'HEART',
    name: 'Apple Watch Series 9',
    connected: true,
    battery: 0.84,
    lastDataAt: now,
  });
  deviceRegistry.add({
    id: HEADPHONES_DEVICE_ID,
    category: 'AUDIO',
    name: 'Sleep A20',
    connected: true,
    battery: 0.92,
    lastDataAt: now,
  });
}

/** Read once for the welcome screen's initial checkbox state. */
export function isAcceptedFixtureRequested(): boolean {
  return readFixtureParam() === 'accepted';
}

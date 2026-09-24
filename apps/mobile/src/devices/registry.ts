/**
 * Wires `@lucid/engine`'s pure `DeviceRegistry` to the platform layer for the
 * onboarding devices screen (DESIGN §4-01(b) · §3.2 step 3 · APP-RUN §2 L1.3).
 *
 * No BLE yet (scheduled L2.3): today only two sources can honestly report anything —
 * the Apple Watch link (HEART) and the current audio output route (AUDIO). Both calls
 * below are pure reads (`getStatus()`), never `start()`/`configureSession()` —
 * onboarding only wants to know what is already there, it must not begin a night.
 */

import { DeviceRegistry, type DeviceEntry } from '@lucid/engine';

import { getPlatform } from '../platform';

export const deviceRegistry = new DeviceRegistry();

export const WATCH_DEVICE_ID = 'apple-watch';
export const MATTRESS_DEVICE_ID = 'phone-on-mattress';
export const HEADPHONES_DEVICE_ID = 'headphones-route';

/**
 * Re-reads every platform source and updates the registry. Cheap and side-effect-free
 * on the platform (only `getStatus()` calls) — safe to call from a screen's focus/mount
 * effect, including repeatedly (e.g. a manual "refresh" tap or a focus re-check).
 */
export function refreshDevicesFromPlatform(nowIso: string = new Date().toISOString()): void {
  const platform = getPlatform();

  const watch = platform.watchSensorSource.getStatus();
  const watchEntry: DeviceEntry = {
    id: WATCH_DEVICE_ID,
    category: 'HEART',
    name: 'Apple Watch',
    connected: watch.connected,
    battery: watch.battery,
    lastDataAt: watch.lastEpochT !== null ? new Date(watch.lastEpochT * 1000).toISOString() : null,
  };
  deviceRegistry.add(watchEntry);

  // Phone-on-mattress (DESIGN §3.2 step 3): a future HEART motion source, not wired until
  // L2.3 (expo-sensors accelerometer). Registered as a known-but-never-connected entry so
  // the data model already has the shape `summarizeDevices` will use later — the screen
  // itself only renders *connected* rows (mockup 01(b) shows nothing for a device that
  // was not actually found), so this stays invisible in the UI until L2.3 makes it real.
  deviceRegistry.add({
    id: MATTRESS_DEVICE_ID,
    category: 'HEART',
    name: 'iPhone (mattress)',
    connected: false,
    battery: null,
    lastDataAt: null,
  });

  const audio = platform.audioPlayer.getStatus();
  if (audio.route) {
    deviceRegistry.add({
      id: HEADPHONES_DEVICE_ID,
      category: 'AUDIO',
      name: audio.route,
      // The platform layer has no per-device headphone battery API yet (L2.3's BLE
      // link brings 0x180F) — `null` here is honest, not a placeholder zero.
      battery: null,
      connected: true,
      lastDataAt: nowIso,
    });
  } else {
    // No output route to report (web QC build, simulator with nothing plugged in, or a
    // real device with no headphones yet) — remove rather than leave a stale entry.
    deviceRegistry.remove(HEADPHONES_DEVICE_ID);
  }
}

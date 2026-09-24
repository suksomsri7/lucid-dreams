/**
 * Wires `@lucid/engine`'s pure `DeviceRegistry` to the platform layer for the devices
 * screens (DESIGN §4-01(b) · §3.2 step 3 · APP-RUN §2 L1.3, extended by L2.3).
 *
 * Every source the app can honestly report on, in the three categories the owner decided on
 * (24 Sep): 💓 the Apple Watch link, the BLE heart-rate strap/armband and the phone on the
 * mattress · 🎧 the current audio output route · 👁 nothing yet.
 *
 * Every call here is a **pure read** (`getStatus()`, `selected()`, a preference) — never
 * `start()`/`connect()`/`configureSession()`. The devices screen polls this every few seconds
 * and must not be able to start a night, open a radio, or provoke a permission sheet by being
 * looked at.
 */

import { DeviceRegistry, type DeviceEntry } from '@lucid/engine';

import { getLocale, translate } from '../i18n';
import { getPlatform } from '../platform';
import type { SensorStatus } from '../platform';
import { getSensorPrefs } from './prefs';

export const deviceRegistry = new DeviceRegistry();

export const WATCH_DEVICE_ID = 'apple-watch';
export const BLE_DEVICE_ID = 'ble-heart-rate';
export const MATTRESS_DEVICE_ID = 'phone-on-mattress';
export const HEADPHONES_DEVICE_ID = 'headphones-route';

/** Live heart rate per device id, for the devices screen's "connected · heart 62 · 84% battery" line. */
const liveBpm = new Map<string, number>();

/**
 * The single mapping from "what a sensor source says about itself" to "what the devices screen
 * shows". One copy on purpose (`src/sensors/hub.ts#syncRegistry` delegates here rather than
 * writing its own entries): the night screen and the devices screen must never be able to
 * disagree about the same strap.
 */
function entryFromStatus(id: string, name: string, status: SensorStatus): DeviceEntry {
  if (status.lastBpm !== null) liveBpm.set(id, status.lastBpm);
  else if (!status.connected) liveBpm.delete(id);
  return {
    id,
    category: 'HEART',
    name,
    connected: status.connected,
    battery: status.battery,
    lastDataAt: status.lastDataT !== null ? new Date(status.lastDataT * 1000).toISOString() : null,
  };
}

/** `null` when this device has never reported a heart rate (the phone on the mattress never will). */
export function liveHeartRate(deviceId: string): number | null {
  return liveBpm.get(deviceId) ?? null;
}

/**
 * Only for `src/dev/fixtures.ts` (`?fixture=ble`), which fabricates a connected strap on the web
 * QC build where no radio exists. Real heart rates only ever arrive through `entryFromStatus`
 * above, from a source that actually measured one.
 */
export function setLiveHeartRate(deviceId: string, bpm: number): void {
  liveBpm.set(deviceId, bpm);
}

/**
 * Re-reads every platform source and updates the registry. Cheap and side-effect-free on the
 * platform — safe to call from a screen's focus/mount effect, including repeatedly (a manual
 * refresh tap, the devices screen's 3 s tick, or `AppSensorHub`'s status fan-in during a night).
 */
export function refreshDevicesFromPlatform(nowIso: string = new Date().toISOString()): void {
  const platform = getPlatform();
  const prefs = getSensorPrefs();

  deviceRegistry.add(
    entryFromStatus(WATCH_DEVICE_ID, 'Apple Watch', platform.watchSensorSource.getStatus()),
  );

  // The strap/armband (WO L2.3). Only ever listed once the user has chosen one in
  // `app/plan/find-devices.tsx` — an unbonded radio has no device to describe, and a row for a
  // device the user never picked would suggest the app connects to things on its own (S8).
  const bonded = prefs.ble;
  if (bonded) {
    const status = platform.bleHeartRate.getStatus();
    deviceRegistry.add(
      entryFromStatus(BLE_DEVICE_ID, bonded.name ?? translate(getLocale(), 'devices.ble.unnamed'), status),
    );
  } else {
    deviceRegistry.remove(BLE_DEVICE_ID);
    liveBpm.delete(BLE_DEVICE_ID);
  }

  // Phone on the mattress (DESIGN §3.2 step 3 · §8.1 row 4) — a motion-only HEART source, listed
  // only while the user has the toggle on. Before L2.3 this was a permanently `connected: false`
  // placeholder; it is real now, and `connected` follows whether the accelerometer is actually
  // being read.
  if (prefs.phoneOnMattress) {
    deviceRegistry.add(
      entryFromStatus(
        MATTRESS_DEVICE_ID,
        translate(getLocale(), 'devices.mattress.name'),
        platform.phoneMotion.getStatus(),
      ),
    );
  } else {
    deviceRegistry.remove(MATTRESS_DEVICE_ID);
  }

  const audio = platform.audioPlayer.getStatus();
  if (audio.route) {
    deviceRegistry.add({
      id: HEADPHONES_DEVICE_ID,
      category: 'AUDIO',
      name: audio.route,
      // The platform layer has no per-device headphone battery API — `0x180F` (WO L2.3) is the
      // *heart-rate* device's battery service, and a Bluetooth audio device's level is not
      // readable through `react-native-ble-plx` at all (it is classic Bluetooth, not BLE).
      // `null` here is honest, not a placeholder zero.
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

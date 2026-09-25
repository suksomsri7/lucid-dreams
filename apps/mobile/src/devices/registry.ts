/**
 * Wires `@lucid/engine`'s pure `DeviceRegistry` to the platform layer for the devices
 * screens (DESIGN §4-01(b) · §3.2 step 3 · APP-RUN §2 L1.3, extended by L2.3).
 *
 * Every source the app can honestly report on, in the three categories the owner decided on
 * (24 Sep): 💓 the Apple Watch link, the BLE heart-rate strap/armband and the phone on the
 * mattress · 🎧 the current audio output route (WO L3.9: real at last — see `audioRoute.ts`) and,
 * when the user has chosen it, the iPhone's own speaker · 👁 nothing yet.
 *
 * Every call here is a **pure read** (`getStatus()`, `selected()`, a preference) — never
 * `start()`/`connect()`/`configureSession()`. The devices screen polls this every few seconds
 * and must not be able to start a night, open a radio, or provoke a permission sheet by being
 * looked at.
 */

import { AppState } from 'react-native';

import { DeviceRegistry, type DeviceEntry } from '@lucid/engine';

import { getLocale, translate } from '../i18n';
import { getPlatform, WATCH_APP_NOT_INSTALLED } from '../platform';
import type { SensorStatus, Unsubscribe } from '../platform';
import { getSensorPrefs } from './prefs';

export const deviceRegistry = new DeviceRegistry();

export const WATCH_DEVICE_ID = 'apple-watch';
export const BLE_DEVICE_ID = 'ble-heart-rate';
export const MATTRESS_DEVICE_ID = 'phone-on-mattress';
export const HEADPHONES_DEVICE_ID = 'headphones-route';
/** The iPhone's own speaker, listed only once the user has chosen it (WO L3.9 §B). */
export const SPEAKER_DEVICE_ID = 'speaker-route';

/**
 * `WCSession` exposes no watch model or name, so this is the name every screen shows for the
 * watch. One constant rather than the same literal in four files (it is a product name, not
 * translatable text — it must read "Apple Watch" in Thai too).
 */
export const WATCH_DEVICE_NAME = 'Apple Watch';


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

  // R1 hotfix (2026-09-25): ask WCSession for the real paired/installed flags (throttled inside);

  // without this the cached status stayed all-false until a night started.

  (platform.watchSensorSource as { probe?: () => void }).probe?.();

  deviceRegistry.add(
    entryFromStatus(WATCH_DEVICE_ID, WATCH_DEVICE_NAME, platform.watchSensorSource.getStatus()),
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

  // 🎧 The output route. `status.route` is the name of the *headphones* iOS is playing into, or
  // `null` (WO L3.9 §B — before that work order it was hard-coded `null`, which is why the card
  // said "no headphones found yet" on a phone with headphones on it).
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

  // The iPhone's own speaker as tonight's sound device (WO L3.9 §B). Two conditions, both
  // required: the user chose it on the "find another device" sheet (`prefs.audioSpeaker` — a
  // speaker is never counted just because it exists, or every phone on earth would pass the 🎧
  // gate with no headphones anywhere), and there are no headphones right now (`audio.route ===
  // null`) — when both are connected iOS plays into the headphones, so listing the speaker as
  // well would be a device that is not actually carrying the whisper.
  if (prefs.audioSpeaker && !audio.route) {
    deviceRegistry.add({
      id: SPEAKER_DEVICE_ID,
      category: 'AUDIO',
      name: translate(getLocale(), 'devices.speaker.name'),
      // The phone's own battery is checked separately by the pre-night gate (`PHONE_BATTERY`), so
      // reporting it here as well would block the night twice for one reason.
      battery: null,
      connected: true,
      lastDataAt: nowIso,
    });
  } else {
    deviceRegistry.remove(SPEAKER_DEVICE_ID);
  }
}

/**
 * "A watch is paired, but Dreaming is not on it yet" (WO L3.9 §D).
 *
 * Both booleans are derived from the one status field the platform door exposes: `connected` is
 * `paired && appInstalled` (`WatchSensorSource`), and the reserved error value
 * {@link WATCH_APP_NOT_INSTALLED} is the only way the other combination is reported. Kept here
 * rather than in the screens so the two devices screens cannot disagree about it.
 */
export function watchLinkHint(): { paired: boolean; appInstalled: boolean } {
  const status = getPlatform().watchSensorSource.getStatus();
  const appInstalled = status.connected;
  return { paired: appInstalled || status.error === WATCH_APP_NOT_INSTALLED, appInstalled };
}

/**
 * Keeps the registry in step with the two things that change while a devices screen is open but
 * that no timer can see quickly enough (WO L3.9):
 *
 *  1. **the audio route** — `ROUTE_CHANGED` is emitted by `IosAudioPlayer` the moment iOS says the
 *     headphones went in or came out, so the 🎧 card changes in well under a second instead of on
 *     the next 3 s tick (R1 asks for ≤ 2 s);
 *  2. **coming back from Settings** — the whole point of the "pair your headphones in Settings"
 *     row is that returning to the app shows the result without a tap, and the app may have been
 *     suspended while the pairing happened, so `AppState` 'active' re-reads everything.
 *
 * One function used by every devices screen (onboarding, pre-night, settings) rather than three
 * copies of the same two subscriptions. Safe to call from several screens at once.
 */
export function watchPlatformDevices(): Unsubscribe {
  const audioEvents = getPlatform().audioPlayer.onEvent((event) => {
    if (event.kind === 'ROUTE_CHANGED') refreshDevicesFromPlatform();
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') refreshDevicesFromPlatform();
  });
  return () => {
    audioEvents();
    appState.remove();
  };
}

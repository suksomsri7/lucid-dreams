/**
 * The two things the sensor rig has to remember between launches (WO L2.3):
 *
 *  1. **which** BLE heart-rate device the user chose — APP-RUN §0.5 S8 is "จับคู่เฉพาะ
 *     อุปกรณ์ที่ผู้ใช้เลือก", and a night that starts while the phone is asleep in a drawer
 *     must be able to reconnect to *that* strap without asking again;
 *  2. whether "มือถือบนที่นอน" is on.
 *
 * Its own tiny AsyncStorage key rather than a field in the settings store on purpose: the
 * settings store (`src/settings/store.ts`) is being written by another builder in a parallel
 * work order, and two work orders editing one store is how a merge loses a field. The key is
 * namespaced (`lucid.sensors.v1`) so it can be folded into settings later by reading it once.
 *
 * Same AsyncStorage-backed `useSyncExternalStore` shape as `src/store/night.ts` — read that
 * file first if this one is confusing. Everything here is synchronous after hydration, because
 * `BleHeartRateSource.start()` runs inside the night's start-up path and cannot await storage
 * before it knows whether it has a device at all.
 */

import { useSyncExternalStore } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'lucid.sensors.v1';

export interface BondedBleDevice {
  id: string;
  name: string | null;
}

export interface SensorPrefs {
  /** The BLE HR device the user tapped in `app/plan/find-devices.tsx`. */
  ble: BondedBleDevice | null;
  /** "มือถือบนที่นอน" — the phone's accelerometer as a motion-only HEART source. */
  phoneOnMattress: boolean;
}

const DEFAULT_PREFS: SensorPrefs = { ble: null, phoneOnMattress: false };

let prefs: SensorPrefs = DEFAULT_PREFS;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => undefined);
}

/**
 * Storage is untrusted input like any other (S8): a hand-edited or half-written JSON blob must
 * not be able to make the app connect to a device id it never scanned, so every field is
 * re-checked here rather than spread in.
 */
function parse(raw: string): SensorPrefs {
  const value = JSON.parse(raw) as Partial<SensorPrefs> | null;
  if (value === null || typeof value !== 'object') return DEFAULT_PREFS;
  const ble =
    value.ble != null && typeof value.ble === 'object' && typeof value.ble.id === 'string' && value.ble.id.length > 0
      ? { id: value.ble.id, name: typeof value.ble.name === 'string' ? value.ble.name : null }
      : null;
  return { ble, phoneOnMattress: value.phoneOnMattress === true };
}

async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) prefs = parse(raw);
  } catch {
    // Corrupt or missing storage — keep the defaults, never throw (this runs at module load).
  } finally {
    hydrated = true;
    emit();
  }
}

void hydrate();

export function getSensorPrefs(): SensorPrefs {
  return prefs;
}

export function sensorPrefsHydrated(): boolean {
  return hydrated;
}

export function rememberBleDevice(device: BondedBleDevice | null): void {
  prefs = { ...prefs, ble: device };
  persist();
  emit();
}

export function setPhoneOnMattress(enabled: boolean): void {
  prefs = { ...prefs, phoneOnMattress: enabled };
  persist();
  emit();
}

/** React binding — re-renders whenever either preference changes. */
export function useSensorPrefs(): SensorPrefs & { hydrated: boolean } {
  const snapshot = useSyncExternalStore(subscribe, getSensorPrefs, getSensorPrefs);
  const isHydrated = useSyncExternalStore(subscribe, sensorPrefsHydrated, sensorPrefsHydrated);
  return { ...snapshot, hydrated: isHydrated };
}

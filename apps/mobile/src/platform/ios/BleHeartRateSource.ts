/**
 * `SensorSource` over the **Bluetooth Heart Rate Profile** — DESIGN §8.1 rows 2–3, the chest
 * strap (Polar H10) and the optical armband (Polar Verity Sense, Garmin HRM). One standard
 * GATT profile, so this file is not brand code: anything that advertises service `0x180D` and
 * notifies characteristic `0x2A37` works, which is exactly why the owner can buy whichever
 * strap is on the shelf (APP-RUN §2 L2.3, "รองรับหลายยี่ห้อ").
 *
 * ## What this file is and is not
 *
 * It is the radio, and nothing else: scan, bond to the one device the user tapped, connect,
 * monitor, reconnect, read the battery, report status. Every decision about what the bytes
 * *mean* lives in `@lucid/engine`:
 *
 *   - `parseHeartRateMeasurement` decodes `0x2A37` and refuses anything impossible — the
 *     truncated payloads and the 300 bpm readings never get past it (APP-RUN §0.5 S8);
 *   - `createSensorHub` merges the beats into a 30 s `SensorEpoch`, including turning the RR
 *     intervals into HRV.
 *
 * Keeping the split there is what lets a night be replayed on the VPS from a byte fixture with
 * no radio in the room (APP-RUN §0.2 rule 1) — the only thing this file could contribute to a
 * replay is a `Uint8Array`.
 *
 * ## The two channels out
 *
 * `onSample` is the one `src/sensors/hub.ts` uses: one reading per notification, RR intervals
 * intact, so the app-wide hub can weight a strap that speaks every second against a watch that
 * speaks every 30 s *by evidence*, and can compute HRV from real beat-to-beat data.
 * `onEpoch` is the `SensorSource` contract every source must honour, and is folded here by a
 * private engine `SensorHub` of this source alone — it exists so a caller that only knows the
 * interface (diagnostics, a future single-source screen) still gets epochs. The app hub
 * subscribes to exactly one of the two, never both, so nothing is ever counted twice.
 *
 * ## S8, concretely (APP-RUN §0.5)
 *
 *  - **จับคู่เฉพาะอุปกรณ์ที่ผู้ใช้เลือก** — `connect()` is only ever called with the id in
 *    `src/devices/prefs.ts`, which is only ever written by a tap in `app/plan/find-devices.tsx`.
 *    A scan result is never auto-connected, not even when it is the only device in the room.
 *  - **ไม่เชื่อ payload ที่ไม่ผ่านสคีมา / HR 25–220** — `parseHeartRateMeasurement` returns
 *    `null` and the notification is dropped whole; the epoch path runs `normalizeEpochs` +
 *    `SensorEpochSchema` on top, like `WatchSensorSource` does.
 *  - **dedupe** — the hub accepts one reading per `(sourceId, second)`; see `nextSampleSecond()`
 *    for the one place that matters and what this does about it.
 */

import {
  BleManager,
  State,
  type BleError,
  type Characteristic,
  type Device,
  type Subscription,
} from 'react-native-ble-plx';

import {
  createSensorHub,
  epochIndexOf,
  normalizeEpochs,
  parseHeartRateMeasurement,
  SensorEpochSchema,
  type SensorEpoch,
  type SensorHub,
  type SensorSample,
} from '@lucid/engine';

import { getSensorPrefs, rememberBleDevice, type BondedBleDevice } from '../../devices/prefs';
import { runOnEpochGrid, type CancelGridTimer } from '../shared/epochGrid';
import type {
  BleAvailability,
  BleScanResult,
  BleSensorSource,
  SensorStatus,
  Unsubscribe,
} from '../types';

// ---------------------------------------------------------------------------
// GATT identifiers (Bluetooth SIG assigned numbers), in the 128-bit form ble-plx returns
// ---------------------------------------------------------------------------

export const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
export const HR_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';
export const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL_UUID = '00002a19-0000-1000-8000-00805f9b34fb';

/** How often the battery level is re-read while connected. A strap lasts ~400 h; 5 min is plenty and costs one GATT read. */
const BATTERY_POLL_MS = 5 * 60 * 1000;
/** A moment past the grid boundary, so a notification that arrived milliseconds before it is not left out of its own epoch. */
const EPOCH_CLOSE_LAG_MS = 1_500;
/** Connection attempt timeout — long enough for a strap that was just put on to answer, short enough to retry twice inside a minute. */
const CONNECT_TIMEOUT_MS = 12_000;

/**
 * Reconnect backoff in ms, then 60 s forever (DESIGN §2.1 sleep-first: a strap that slips
 * mid-night must come back on its own, because the user is asleep and cannot help). The first
 * two steps are short because the overwhelmingly common cause is a momentary out-of-range while
 * turning over, and the long tail is capped so a strap whose battery died does not keep the
 * radio busy all night.
 */
const RECONNECT_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
const RECONNECT_MAX_MS = 60_000;

// ---------------------------------------------------------------------------
// base64 → bytes
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * ble-plx hands characteristic values over as base64 strings. Decoded by hand rather than with
 * `Buffer`/`atob`: React Native has no `Buffer` global, and `atob` returns a *string* whose code
 * units would have to be walked anyway — this is the same loop without the intermediate string,
 * and without a dependency added for 20 lines (APP-RUN §0.5 S9 wants every new dependency
 * justified, and this one could not be).
 *
 * Returns `null` for anything that is not valid base64, so a garbled notification is dropped
 * exactly like a garbled payload is (S8) instead of being decoded into plausible-looking noise.
 */
export function base64ToBytes(value: string): Uint8Array | null {
  const clean = value.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let accumulator = 0;
  let written = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const index = BASE64_ALPHABET.indexOf(clean[i] as string);
    if (index < 0) return null;
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return out.subarray(0, written);
}

/** `0000180d-…` → `180d`, so a scan result can be matched against the short assigned numbers. */
function shortServiceId(uuid: string): string {
  const lower = uuid.toLowerCase();
  return lower.length === 36 && lower.startsWith('0000') ? lower.slice(4, 8) : lower;
}

// ---------------------------------------------------------------------------

export class BleHeartRateSource implements BleSensorSource {
  readonly id = 'ble-heart-rate';
  readonly kind = 'BLE_HR' as const;

  private manager: BleManager | null = null;
  private managerFailed = false;
  private device: Device | null = null;

  private started = false;
  private connected = false;
  private reachable = false;
  private battery: number | null = null;
  private lastBpm: number | null = null;
  private lastDataT: number | null = null;
  private lastEpochT: number | null = null;
  private error: string | null = null;

  private hrSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private stateSubscription: Subscription | null = null;
  private batteryTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private scanning = false;

  /** Folds this source's own samples into epochs for `onEpoch` — see the file header. */
  private epochHub: SensorHub | null = null;
  private cancelEpochTimer: CancelGridTimer | null = null;
  /** Monotonic second used as the sample timestamp; see `nextSampleSecond()`. */
  private lastSampleT = 0;

  private readonly sampleListeners = new Set<(sample: SensorSample) => void>();
  private readonly epochListeners = new Set<(epoch: SensorEpoch) => void>();
  private readonly statusListeners = new Set<(status: SensorStatus) => void>();
  private readonly commandListeners = new Set<(command: 'stop') => void>();

  // -------------------------------------------------------------------------
  // Manager
  // -------------------------------------------------------------------------

  /**
   * Built on first use, never at import time: constructing a `BleManager` touches the native
   * module and, on iOS, is what makes the system show the Bluetooth permission sheet. Doing that
   * because a module was imported — on a screen that has nothing to do with devices — would ask
   * the user for Bluetooth out of nowhere.
   */
  private ensureManager(): BleManager | null {
    if (this.manager !== null || this.managerFailed) return this.manager;
    try {
      this.manager = new BleManager({
        // iOS state restoration: with `bluetooth-central` in UIBackgroundModes, CoreBluetooth
        // can relaunch the app after it was evicted and hand the connection back under this key.
        // Declared so the connection survives that; the night itself is kept alive by the audio
        // background mode, so nothing here depends on a restore happening.
        restoreStateIdentifier: 'app.dreaming.ble',
        restoreStateFunction: () => undefined,
      });
    } catch {
      this.managerFailed = true;
      this.error = 'BLE_NATIVE_MODULE_MISSING';
      this.manager = null;
    }
    return this.manager;
  }

  // -------------------------------------------------------------------------
  // SensorSource
  // -------------------------------------------------------------------------

  async isAvailable(): Promise<boolean> {
    return (await this.availability()) === 'READY';
  }

  async availability(): Promise<BleAvailability> {
    const manager = this.ensureManager();
    if (!manager) return 'UNSUPPORTED';
    try {
      const state = await manager.state();
      if (state === State.PoweredOn) return 'READY';
      if (state === State.Unauthorized) return 'UNAUTHORIZED';
      if (state === State.Unsupported) return 'UNSUPPORTED';
      return 'OFF';
    } catch {
      return 'UNSUPPORTED';
    }
  }

  selected(): BondedBleDevice | null {
    return getSensorPrefs().ble;
  }

  /**
   * `start()` is "connect to the device the user already chose". With no chosen device it is a
   * no-op that says so in `getStatus().error` rather than throwing: a night with no strap is a
   * perfectly normal night (the watch, or the timer fallback, carries it), and throwing here
   * would have to be caught by every caller to mean the same thing.
   */
  async start(): Promise<void> {
    if (this.started) return; // idempotent by contract
    this.started = true;
    const bonded = this.selected();
    if (!bonded) {
      this.error = 'BLE_NO_DEVICE';
      this.emitStatus();
      return;
    }
    this.watchRadioState();
    await this.connect(bonded.id);
  }

  async stop(): Promise<void> {
    if (!this.started) return; // safe when never started
    this.started = false;
    this.clearReconnect();
    this.stateSubscription?.remove();
    this.stateSubscription = null;
    await this.teardownLink();
    this.stopEpochFold();
    void this.stopScanNow();
    this.emitStatus();
  }

  getStatus(): SensorStatus {
    return {
      id: this.id,
      kind: this.kind,
      connected: this.connected,
      reachable: this.started && this.reachable,
      lastEpochT: this.lastEpochT,
      lastDataT: this.lastDataT,
      lastBpm: this.lastBpm,
      battery: this.battery,
      error: this.error,
    };
  }

  onSample(listener: (sample: SensorSample) => void): Unsubscribe {
    this.sampleListeners.add(listener);
    return () => {
      this.sampleListeners.delete(listener);
    };
  }

  /** Subscribing starts the private epoch fold; the last unsubscribe stops it again. */
  onEpoch(listener: (epoch: SensorEpoch) => void): Unsubscribe {
    this.epochListeners.add(listener);
    this.startEpochFold();
    return () => {
      this.epochListeners.delete(listener);
      if (this.epochListeners.size === 0) this.stopEpochFold();
    };
  }

  onStatus(listener: (status: SensorStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * A heart-rate strap has no buttons — the profile has no way to send one. Kept as a no-op
   * subscription (not a throw) because the contract says every source has this, and the night
   * subscribes to it on every source it is given.
   */
  onCommand(listener: (command: 'stop') => void): Unsubscribe {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Scanning + bonding
  // -------------------------------------------------------------------------

  async scan(onResults: (results: BleScanResult[]) => void): Promise<Unsubscribe> {
    const manager = this.ensureManager();
    if (!manager) {
      this.error = 'BLE_NATIVE_MODULE_MISSING';
      this.emitStatus();
      return () => undefined;
    }

    const found = new Map<string, BleScanResult>();
    this.scanning = true;
    await manager.startDeviceScan(
      [HR_SERVICE_UUID, BATTERY_SERVICE_UUID],
      { allowDuplicates: false },
      (error: BleError | null, device: Device | null) => {
        if (error) {
          this.error = `BLE_SCAN:${error.errorCode}`;
          this.scanning = false;
          this.emitStatus();
          return;
        }
        if (!device) return;
        found.set(device.id, {
          id: device.id,
          name: device.localName ?? device.name,
          rssi: device.rssi,
          services: (device.serviceUUIDs ?? []).map(shortServiceId),
        });
        // Strongest signal first: on a bed with two devices in the room, the one being worn is
        // the near one, and a list that reorders itself under the finger is worse than a stable
        // sort by the only number that means anything here.
        onResults([...found.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)));
      },
    );

    return () => {
      void this.stopScanNow();
    };
  }

  private async stopScanNow(): Promise<void> {
    if (!this.scanning) return;
    this.scanning = false;
    try {
      await this.manager?.stopDeviceScan();
    } catch {
      // already stopped / manager gone — nothing to undo
    }
  }

  /** The only door to a bond (S8): called from the user's own tap, never from a scan callback. */
  async select(device: BondedBleDevice): Promise<void> {
    await this.stopScanNow();
    const previous = this.selected();
    if (previous && previous.id !== device.id) await this.teardownLink();
    rememberBleDevice(device);
    this.started = true;
    this.reconnectAttempt = 0;
    this.watchRadioState();
    await this.connect(device.id);
  }

  async forget(): Promise<void> {
    this.clearReconnect();
    await this.teardownLink();
    rememberBleDevice(null);
    this.battery = null;
    this.lastBpm = null;
    this.error = null;
    this.emitStatus();
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  private async connect(deviceId: string): Promise<void> {
    const manager = this.ensureManager();
    if (!manager) {
      this.emitStatus();
      return;
    }

    try {
      const device = await manager.connectToDevice(deviceId, { timeout: CONNECT_TIMEOUT_MS });
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;
      this.connected = true;
      this.error = null;
      this.reconnectAttempt = 0;

      this.disconnectSubscription?.remove();
      this.disconnectSubscription = manager.onDeviceDisconnected(deviceId, () => {
        this.reachable = false;
        this.connected = false;
        this.emitStatus();
        this.scheduleReconnect(deviceId);
      });

      this.hrSubscription?.remove();
      this.hrSubscription = device.monitorCharacteristicForService(
        HR_SERVICE_UUID,
        HR_MEASUREMENT_UUID,
        (error, characteristic) => this.ingest(error, characteristic, deviceId),
      );
      this.reachable = true;

      await this.readBattery();
      if (this.batteryTimer === null) {
        this.batteryTimer = setInterval(() => void this.readBattery(), BATTERY_POLL_MS);
      }
      this.emitStatus();
    } catch (cause) {
      this.connected = false;
      this.reachable = false;
      this.error = `BLE_CONNECT:${errorCodeOf(cause)}`;
      this.emitStatus();
      this.scheduleReconnect(deviceId);
    }
  }

  /**
   * Bluetooth turned off and on again (or permission granted late) does not produce a
   * disconnect event for a link that never existed, so the radio's own state is watched
   * separately: the moment it is powered on and we have a bonded device, try immediately
   * instead of waiting out the backoff.
   */
  private watchRadioState(): void {
    const manager = this.ensureManager();
    if (!manager || this.stateSubscription !== null) return;
    this.stateSubscription = manager.onStateChange((state) => {
      if (state !== State.PoweredOn) {
        this.reachable = false;
        this.emitStatus();
        return;
      }
      const bonded = this.selected();
      if (this.started && bonded && !this.connected) {
        this.clearReconnect();
        this.reconnectAttempt = 0;
        void this.connect(bonded.id);
      }
    }, true);
  }

  private scheduleReconnect(deviceId: string): void {
    if (!this.started) return;
    if (this.reconnectTimer !== null) return;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)] ??
      RECONNECT_MAX_MS;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.started) return;
      const bonded = this.selected();
      // The user may have forgotten the device while the timer was pending.
      if (!bonded || bonded.id !== deviceId) return;
      void this.connect(deviceId);
    }, Math.min(delay, RECONNECT_MAX_MS));
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
  }

  private async teardownLink(): Promise<void> {
    this.hrSubscription?.remove();
    this.hrSubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
    if (this.batteryTimer !== null) clearInterval(this.batteryTimer);
    this.batteryTimer = null;

    const device = this.device;
    this.device = null;
    this.connected = false;
    this.reachable = false;
    if (device) {
      try {
        await device.cancelConnection();
      } catch {
        // already gone — the link we were asked to drop is dropped either way
      }
    }
  }

  private async readBattery(): Promise<void> {
    const device = this.device;
    if (!device) return;
    try {
      const characteristic = await device.readCharacteristicForService(
        BATTERY_SERVICE_UUID,
        BATTERY_LEVEL_UUID,
      );
      const bytes = characteristic.value ? base64ToBytes(characteristic.value) : null;
      const percent = bytes && bytes.length > 0 ? (bytes[0] as number) : null;
      // 0x2A19 is one byte, 0..100. Anything else is a device lying about the profile; a
      // battery bar is not worth believing a wrong number for.
      if (percent !== null && percent >= 0 && percent <= 100) {
        this.battery = percent / 100;
        this.emitStatus();
      }
    } catch {
      // Battery service is optional in the HR profile — a strap without it is not an error,
      // and `battery: null` is the honest answer the devices screen already knows how to draw.
    }
  }

  // -------------------------------------------------------------------------
  // Notifications → samples → (optionally) epochs
  // -------------------------------------------------------------------------

  private ingest(
    error: BleError | null,
    characteristic: Characteristic | null,
    deviceId: string,
  ): void {
    if (error) {
      this.reachable = false;
      this.error = `BLE_MONITOR:${error.errorCode}`;
      this.emitStatus();
      this.scheduleReconnect(deviceId);
      return;
    }
    if (!characteristic?.value) return;

    const bytes = base64ToBytes(characteristic.value);
    if (!bytes) {
      this.error = 'BLE_PAYLOAD_NOT_BASE64';
      this.emitStatus();
      return;
    }

    const measurement = parseHeartRateMeasurement(bytes);
    if (!measurement) {
      // Dropped whole, never partially believed (S8). Recorded in `error` so the diagnostics
      // screen can show "the strap is talking, and we are refusing what it says", which is a
      // different fault from silence.
      this.error = 'BLE_PAYLOAD_REJECTED';
      this.emitStatus();
      return;
    }

    const t = this.nextSampleSecond();
    this.lastDataT = t;
    this.lastBpm = measurement.bpm;
    this.reachable = true;
    this.error = null;

    const sample: SensorSample = {
      t,
      bpm: measurement.bpm,
      rrMs: measurement.rrMs,
      battery: this.battery,
      source: this.kind,
    };
    this.epochHub?.push(this.id, sample);
    for (const listener of this.sampleListeners) listener(sample);
    this.emitStatus();
  }

  /**
   * The hub accepts one reading per `(sourceId, second)` — that dedupe is what stops a strap
   * that reconnects and replays its buffer from counting twice (APP-RUN §0.5 S8). A strap above
   * ~120 bpm, though, honestly notifies twice inside one second, and dropping the second one
   * would throw away a real beat *and* its RR interval, which is the HRV signal §5.2 leans on.
   *
   * So a reading that lands on a second already used is filed at the next free second. The shift
   * is under a second, three orders of magnitude below the 30 s epoch it is being placed in, and
   * it can only ever move a reading forward — never into an epoch that was already closed and
   * delivered.
   */
  private nextSampleSecond(): number {
    const now = Math.floor(Date.now() / 1000);
    const t = now > this.lastSampleT ? now : this.lastSampleT + 1;
    this.lastSampleT = t;
    return t;
  }

  private startEpochFold(): void {
    if (this.cancelEpochTimer !== null) return;
    this.epochHub ??= createSensorHub();
    this.cancelEpochTimer = runOnEpochGrid(() => this.closeEpoch(), EPOCH_CLOSE_LAG_MS);
  }

  private stopEpochFold(): void {
    this.cancelEpochTimer?.();
    this.cancelEpochTimer = null;
    this.epochHub = null;
  }

  private closeEpoch(): void {
    const hub = this.epochHub;
    if (!hub) return;
    const epoch = hub.closeEpoch(epochIndexOf(Date.now()));
    if (!epoch) return;

    // Same two gates `WatchSensorSource` runs, and for the same reason: an epoch is judged by
    // the code a replayed diagnostics file is judged by, so a live night and a replay can never
    // be treated differently.
    const [normalized] = normalizeEpochs([epoch]);
    if (!normalized) return;
    const parsed = SensorEpochSchema.safeParse(normalized);
    if (!parsed.success) {
      this.error = `EPOCH_REJECTED:${parsed.error.issues[0]?.path.join('.') ?? 'unknown'}`;
      this.emitStatus();
      return;
    }
    if (this.lastEpochT !== null && parsed.data.t <= this.lastEpochT) return;

    this.lastEpochT = parsed.data.t;
    for (const listener of this.epochListeners) listener(parsed.data);
    this.emitStatus();
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) listener(status);
  }
}

/** ble-plx errors carry a numeric `errorCode`; anything else is reported as `UNKNOWN`. */
function errorCodeOf(cause: unknown): string {
  if (cause !== null && typeof cause === 'object' && 'errorCode' in cause) {
    const code = (cause as { errorCode: unknown }).errorCode;
    if (typeof code === 'number' || typeof code === 'string') return String(code);
  }
  return 'UNKNOWN';
}

/**
 * The app's side of "several sources can run at once … the estimator fuses them" (DESIGN §8.1, decision of
 * 24 Sep) — WO L2.3 deliverable 3.
 *
 * `@lucid/engine`'s `createSensorHub` already knows *how* to merge several sensors into one
 * 30 s `SensorEpoch` (weighting heart rates by evidence, taking the max of motion, computing
 * HRV from whatever RR intervals arrived, refusing duplicates). What it cannot do — by design,
 * since it must stay free of any platform API — is own the wiring: which sources exist tonight,
 * when the 30 s bell rings, and what happens when nobody answers. That is this file, and it is
 * deliberately the *only* file that knows all three.
 *
 * ## One epoch every 30 s, no matter what
 *
 * The night controller advances on epochs, not on wall-clock time: `NightController.feed()` is
 * what moves `nowT`, detects onset, counts still minutes and — crucially — counts the epochs
 * with nothing readable in them, switching to timer mode after 20 of them
 * (`SENSOR_LOST_EPOCHS`, 10 minutes, APP-RUN §2 L2.7). So when no source delivers anything for
 * a window, this hub still emits an epoch, with every field `null` and `source: 'TIMER'`.
 *
 * That is the whole timer fallback: the controller already supports it, and before this file
 * existed the app simply stopped feeding it — a night with no watch would have sat frozen at
 * the epoch it was born on, never reaching onset, never falling back, never whispering.
 *
 * ## Samples where possible, epochs otherwise
 *
 * A source that can hand over individual readings (`SampleSensorSource`: the BLE strap's
 * per-beat notifications, the phone's per-epoch motion energy) is subscribed by `onSample`, so
 * the engine hub sees the evidence it needs to weight and to derive HRV. A source that only
 * produces finished epochs (the Apple Watch, which aggregates on the watch itself) is subscribed
 * by `onEpoch` and each epoch is pushed as a single sample. Never both for one source — that
 * would count it twice.
 *
 * The cost of the epoch path, written down because it is a real approximation: a watch epoch
 * enters the merge as *one* sample while a strap contributes ~30, so on a night wearing both,
 * the strap dominates `hrMean`. That is the engine's own stated rule ("weighting by sample count
 * is weighting by evidence") and the strap is the better instrument, so the bias points the
 * right way — but it is a bias, not a neutral average. See `ledger/wo-notes/L2.3.md`.
 */

import {
  createSensorHub,
  epochIndexOf,
  normalizeEpochs,
  EPOCH_SECONDS,
  type SensorEpoch,
  type SensorHub,
  type SensorSample,
} from '@lucid/engine';

import { getSensorPrefs } from '../devices/prefs';
import { BLE_DEVICE_ID, MATTRESS_DEVICE_ID, WATCH_DEVICE_ID, refreshDevicesFromPlatform } from '../devices/registry';
import { runOnEpochGrid, type CancelGridTimer } from '../platform/shared/epochGrid';
import type { PlatformBundle, SampleSensorSource, SensorSource, Unsubscribe } from '../platform';

/**
 * How long after the 30 s boundary the window is closed. A source that summarises a whole epoch
 * (the phone on the mattress) can only emit at the boundary itself, and a watch message crosses
 * a Bluetooth link to get here — closing on the tick itself would leave both out of the epoch
 * they describe. Three seconds is a tenth of the window and is invisible to everything
 * downstream, which only ever looks at `epoch.t`.
 */
const CLOSE_LAG_MS = 3_000;

export interface HubSourceEntry {
  /** The id the devices screen / `DeviceRegistry` knows this device by. */
  deviceId: string;
  /** Device name as the user should read it ("Polar H10", "Apple Watch"). */
  name: string;
  source: SensorSource | SampleSensorSource;
}

export interface SensorSourceReport {
  deviceId: string;
  name: string;
  /** Every source in this hub is evidence about the body — the 💓 category (DESIGN §3.2 step 3). */
  category: 'HEART';
  connected: boolean;
  battery: number | null;
  /** ISO of the newest reading, `null` when this source has never said anything. */
  lastDataAt: string | null;
  lastBpm: number | null;
}

export interface AppSensorHub {
  register(entry: HubSourceEntry): void;
  /** Starts every registered source (best effort) and the 30 s bell. Idempotent. */
  start(): Promise<void>;
  stop(): Promise<void>;
  onEpoch(listener: (epoch: SensorEpoch) => void): Unsubscribe;
  /** Fan-in of every source's `onCommand` — today only the watch's stop button. */
  onCommand(listener: (command: 'stop') => void): Unsubscribe;
  sources(): SensorSourceReport[];
  /** Push the current state of every source into `DeviceRegistry` (devices screen). */
  syncRegistry(): void;
}

function hasSamples(source: SensorSource | SampleSensorSource): source is SampleSensorSource {
  return typeof (source as SampleSensorSource).onSample === 'function';
}

export function createAppSensorHub(): AppSensorHub {
  const entries: HubSourceEntry[] = [];
  const merged: SensorHub = createSensorHub();
  const epochListeners = new Set<(epoch: SensorEpoch) => void>();
  const commandListeners = new Set<(command: 'stop') => void>();
  const unsubscribes: Unsubscribe[] = [];

  let started = false;
  let cancelGrid: CancelGridTimer | null = null;
  let lastClosedEnd: number | null = null;
  let lastEmittedT: number | null = null;

  function register(entry: HubSourceEntry): void {
    if (entries.some((existing) => existing.deviceId === entry.deviceId)) return;
    entries.push(entry);
  }

  function close(): void {
    const tEnd = epochIndexOf(Date.now());
    // The grid timer can only fire once per slot, but a clock jump (or a phone waking from a
    // long suspend) could bring it back to a slot already closed. Refuse rather than re-close:
    // an epoch already handed to the controller can never be rewritten (S8).
    if (lastClosedEnd !== null && tEnd <= lastClosedEnd) return;
    lastClosedEnd = tEnd;

    const epoch: SensorEpoch = merged.closeEpoch(tEnd) ?? {
      // Nobody said anything for this whole window. Reported honestly as an empty epoch so the
      // controller's own sensor-lost counter can run (see the file header) — `TIMER` is the
      // schema's name for "no sensor stood behind this".
      t: tEnd - EPOCH_SECONDS,
      hrMean: null,
      hrSd: null,
      motion: null,
      battery: null,
      source: 'TIMER',
    };

    // The engine's own normaliser, for the same reason every source runs it: a live epoch and a
    // replayed one must be judged by identical code (`replay.ts`).
    const [normalized] = normalizeEpochs([epoch]);
    if (!normalized) return;
    if (lastEmittedT !== null && normalized.t <= lastEmittedT) return;
    lastEmittedT = normalized.t;

    for (const listener of epochListeners) listener(normalized);
    syncRegistry();
  }

  async function start(): Promise<void> {
    if (started) return;
    started = true;

    for (const entry of entries) {
      const { deviceId, source } = entry;
      if (hasSamples(source)) {
        unsubscribes.push(source.onSample((sample: SensorSample) => merged.push(deviceId, sample)));
      } else {
        unsubscribes.push(
          source.onEpoch((epoch) =>
            merged.push(deviceId, {
              // Filed at the last second of the window it describes, so it lands in that window
              // and not in the next one.
              t: epoch.t + EPOCH_SECONDS - 1,
              bpm: epoch.hrMean ?? undefined,
              motion: epoch.motion ?? undefined,
              battery: epoch.battery,
              source: epoch.source,
            }),
          ),
        );
      }
      unsubscribes.push(source.onStatus(() => syncRegistry()));
      unsubscribes.push(
        source.onCommand((command) => {
          for (const listener of commandListeners) listener(command);
        }),
      );
    }

    // Best effort, one at a time: a strap that is out of range must not stop the watch from
    // starting, and none of them failing should stop the night (DESIGN §2.1 sleep-first).
    for (const entry of entries) {
      try {
        await entry.source.start();
      } catch {
        // `getStatus().error` already carries why; the night keeps going without this source.
      }
    }

    cancelGrid = runOnEpochGrid(close, CLOSE_LAG_MS);
    syncRegistry();
  }

  async function stop(): Promise<void> {
    if (!started) return;
    started = false;
    cancelGrid?.();
    cancelGrid = null;
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    for (const entry of entries) {
      try {
        await entry.source.stop();
      } catch {
        // stopping is best effort too — a source that cannot be stopped is already broken
      }
    }
    syncRegistry();
  }

  function sources(): SensorSourceReport[] {
    return entries.map((entry) => {
      const status = entry.source.getStatus();
      return {
        deviceId: entry.deviceId,
        name: entry.name,
        category: 'HEART' as const,
        connected: status.connected,
        battery: status.battery,
        lastDataAt: status.lastDataT === null ? null : new Date(status.lastDataT * 1000).toISOString(),
        lastBpm: status.lastBpm,
      };
    });
  }

  /**
   * Delegated to `src/devices/registry.ts` rather than writing entries from here: that module
   * already owns the one mapping from a platform `SensorStatus` to a `DeviceEntry` (it is what
   * the devices screen calls on its own refresh tick), and two writers with two copies of the
   * same mapping is how the night screen and the devices screen end up disagreeing about the
   * same strap.
   */
  function syncRegistry(): void {
    refreshDevicesFromPlatform();
  }

  return {
    register,
    start,
    stop,
    onEpoch(listener) {
      epochListeners.add(listener);
      return () => {
        epochListeners.delete(listener);
      };
    },
    onCommand(listener) {
      commandListeners.add(listener);
      return () => {
        commandListeners.delete(listener);
      };
    },
    sources,
    syncRegistry,
  };
}

/**
 * Tonight's rig: every source the user actually has (DESIGN §8.1 — "the user picks sources in
 * settings › devices · several can be connected at once").
 *
 * The watch is always registered — it reports itself as unavailable within a second if there is
 * no watch, which is cheaper than asking first and gives the devices screen something to show.
 * The strap is registered only when one has been bonded, and the phone only when the user turned
 * the mattress toggle on: registering either of those unasked would start a radio or a sensor for a
 * device nobody chose (APP-RUN §0.5 S8).
 */
export function buildNightSensorHub(platform: PlatformBundle): AppSensorHub {
  const hub = createAppSensorHub();
  const prefs = getSensorPrefs();

  hub.register({ deviceId: WATCH_DEVICE_ID, name: 'Apple Watch', source: platform.watchSensorSource });

  const bonded = prefs.ble;
  if (bonded) {
    hub.register({
      deviceId: BLE_DEVICE_ID,
      name: bonded.name ?? 'Heart rate sensor',
      source: platform.bleHeartRate,
    });
  }

  if (prefs.phoneOnMattress) {
    hub.register({ deviceId: MATTRESS_DEVICE_ID, name: 'iPhone', source: platform.phoneMotion });
  }

  return hub;
}

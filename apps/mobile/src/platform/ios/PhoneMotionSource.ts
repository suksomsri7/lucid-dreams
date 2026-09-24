/**
 * "มือถือบนที่นอน" — the phone itself as a motion source (DESIGN §8.1, row 4).
 *
 * The fallback for someone who owns neither a watch nor a strap: the phone lies on the
 * mattress and its accelerometer picks up the whole-body movements that matter here (turning
 * over, sitting up) the way Sleep Cycle does. It reports **no heart rate at all** — it is a
 * motion-only member of the 💓 category, and the devices screen says so, because a row that
 * merely says "connected" next to a heart icon would promise a pulse this cannot measure.
 *
 * ## The number it produces
 *
 * The same one the watch produces, so the estimator's thresholds mean the same thing whichever
 * device is on tonight (`targets/watch/MotionManager.swift`, WO L2.2n): sample |a| at 20 Hz,
 * subtract 1 g of gravity, take the absolute value, and average over the epoch —
 * `mean(| |a| − 1 |)` in g. A phone lying still reads ~0.00–0.01; a hand pushing the mattress
 * reads tenths.
 *
 * Averaging over the whole 30 s (rather than emitting per-second peaks) is what keeps it
 * comparable: `@lucid/engine`'s hub merges motion across sources by **max**, so a source that
 * reported peaks would quietly out-shout the watch's averages on every epoch and the night
 * would read as one long wakefulness.
 *
 * ## Only when the user asked for it
 *
 * `src/sensors/hub.ts` registers this source only while `getSensorPrefs().phoneOnMattress` is
 * on (the toggle in `app/plan/find-devices.tsx`). There is no "sense it automatically" path: a
 * phone on a nightstand would report the stillness of the nightstand, which is not evidence
 * about a sleeper and would be worse than no motion channel at all.
 */

import { Accelerometer } from 'expo-sensors';
import * as Battery from 'expo-battery';

import { epochIndexOf, normalizeEpochs, SensorEpochSchema, type SensorEpoch, type SensorSample } from '@lucid/engine';

import { runOnEpochGrid, type CancelGridTimer } from '../shared/epochGrid';
import type { SampleSensorSource, SensorStatus, Unsubscribe } from '../types';

/** 20 Hz — the watch's `ACCEL_HZ`, kept identical on purpose (see the header). */
export const ACCEL_HZ = 20;
const ACCEL_INTERVAL_MS = Math.round(1000 / ACCEL_HZ);

/**
 * Below this many samples an epoch is not summarised at all. iOS throttles sensor delivery in
 * the background, and a "mean" of three readings is not the same quantity as a mean of 600 —
 * publishing it anyway would feed the estimator a number whose meaning silently changed.
 * A quarter of the expected samples is the line: enough to average, few enough to survive
 * ordinary throttling.
 */
const MIN_SAMPLES_PER_EPOCH = (ACCEL_HZ * 30) / 4;

export class PhoneMotionSource implements SampleSensorSource {
  readonly id = 'phone-on-mattress';
  readonly kind = 'PHONE_MOTION' as const;

  private started = false;
  private available: boolean | null = null;
  private subscription: { remove: () => void } | null = null;
  private cancelGrid: CancelGridTimer | null = null;
  private battery: number | null = null;
  private lastEpochT: number | null = null;
  private lastDataT: number | null = null;
  private error: string | null = null;

  /** Running accumulator for the epoch currently being measured. */
  private energySum = 0;
  private energyCount = 0;

  private readonly sampleListeners = new Set<(sample: SensorSample) => void>();
  private readonly epochListeners = new Set<(epoch: SensorEpoch) => void>();
  private readonly statusListeners = new Set<(status: SensorStatus) => void>();
  private readonly commandListeners = new Set<(command: 'stop') => void>();

  async isAvailable(): Promise<boolean> {
    try {
      this.available = await Accelerometer.isAvailableAsync();
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async start(): Promise<void> {
    if (this.started) return; // idempotent by contract
    this.started = true;

    if (!(await this.isAvailable())) {
      this.error = 'ACCELEROMETER_UNAVAILABLE';
      this.emitStatus();
      return;
    }

    Accelerometer.setUpdateInterval(ACCEL_INTERVAL_MS);
    this.subscription = Accelerometer.addListener(({ x, y, z }) => this.ingest(x, y, z));
    this.cancelGrid = runOnEpochGrid(() => this.closeEpoch());
    void this.readBattery();
    this.error = null;
    this.emitStatus();
  }

  async stop(): Promise<void> {
    if (!this.started) return; // safe when never started
    this.started = false;
    this.subscription?.remove();
    this.subscription = null;
    this.cancelGrid?.();
    this.cancelGrid = null;
    this.energySum = 0;
    this.energyCount = 0;
    this.emitStatus();
  }

  getStatus(): SensorStatus {
    return {
      id: this.id,
      kind: this.kind,
      // "Connected" for a sensor that is physically part of the phone means "we are reading it".
      connected: this.started && this.error === null,
      reachable: this.started && this.error === null,
      lastEpochT: this.lastEpochT,
      lastDataT: this.lastDataT,
      // It measures movement, never a pulse — saying `null` here is what keeps the devices
      // screen from implying otherwise.
      lastBpm: null,
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

  onEpoch(listener: (epoch: SensorEpoch) => void): Unsubscribe {
    this.epochListeners.add(listener);
    return () => {
      this.epochListeners.delete(listener);
    };
  }

  onStatus(listener: (status: SensorStatus) => void): Unsubscribe {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** A phone on a mattress has no button to press; kept as a no-op for the contract. */
  onCommand(listener: (command: 'stop') => void): Unsubscribe {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }

  private ingest(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    this.energySum += Math.abs(magnitude - 1);
    this.energyCount += 1;
  }

  private closeEpoch(): void {
    const count = this.energyCount;
    const sum = this.energySum;
    this.energyCount = 0;
    this.energySum = 0;
    if (count < MIN_SAMPLES_PER_EPOCH) return;

    const boundary = epochIndexOf(Date.now());
    const motion = sum / count;

    // Stamped at the last second *inside* the window it summarises, not at the boundary: the
    // boundary second already belongs to the next epoch, and `src/sensors/hub.ts` closes the
    // window `[boundary − 30, boundary)` a moment later. One second early keeps this reading in
    // the epoch it actually describes.
    const sample: SensorSample = {
      t: boundary - 1,
      motion,
      battery: this.battery,
      source: this.kind,
    };
    this.lastDataT = boundary - 1;
    for (const listener of this.sampleListeners) listener(sample);

    if (this.epochListeners.size > 0) {
      const candidate: SensorEpoch = {
        t: boundary - 30,
        hrMean: null,
        hrSd: null,
        motion,
        battery: this.battery,
        source: this.kind,
      };
      // Same two gates every other source runs (`WatchSensorSource`): the engine's own
      // normaliser, then the schema, so a live epoch is judged exactly like a replayed one.
      const [normalized] = normalizeEpochs([candidate]);
      const parsed = normalized ? SensorEpochSchema.safeParse(normalized) : null;
      if (parsed?.success && (this.lastEpochT === null || parsed.data.t > this.lastEpochT)) {
        this.lastEpochT = parsed.data.t;
        for (const listener of this.epochListeners) listener(parsed.data);
      }
    }

    void this.readBattery();
    this.emitStatus();
  }

  private async readBattery(): Promise<void> {
    try {
      const level = await Battery.getBatteryLevelAsync();
      // The simulator reports -1 when it has no battery to report (same guard as `IosBatteryReader`).
      this.battery = level < 0 ? null : Math.min(Math.max(level, 0), 1);
    } catch {
      this.battery = null;
    }
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) listener(status);
  }
}

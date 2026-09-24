/**
 * `SensorSource` backed by the Apple Watch companion app (DESIGN §8.1, first row).
 *
 * The watch does the aggregation (HR per second + accelerometer at 20 Hz → one 30 s
 * epoch) and sends `{t, hrMean, hrSd, motion, battery}`. This class does three things
 * and nothing else:
 *
 *  1. validates every payload against the engine's `SensorEpochSchema` — a watch
 *     message is untrusted input (APP-RUN §0.5 S8): out-of-range HR and replayed or
 *     backwards epochs are dropped here, and again in the engine;
 *  2. keeps a status snapshot for the Diagnostics screen;
 *  3. never decides anything about REM — that is `packages/engine`.
 */

import { epochIndexOf, SensorEpochSchema, type SensorEpoch } from '@lucid/engine';

import type { SensorSource, SensorStatus, Unsubscribe } from '../types';
import { watchBridge, type WatchEpochPayload, type WatchLinkStatus } from './watchBridge';

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class WatchSensorSource implements SensorSource {
  readonly id = 'apple-watch';
  readonly kind = 'WATCH' as const;

  private started = false;
  private link: WatchLinkStatus = { paired: false, appInstalled: false, reachable: false, model: null };
  private lastEpochT: number | null = null;
  private battery: number | null = null;
  private error: string | null = null;

  private readonly epochListeners = new Set<(epoch: SensorEpoch) => void>();
  private readonly statusListeners = new Set<(status: SensorStatus) => void>();
  private readonly commandListeners = new Set<(command: 'stop') => void>();
  private unsubscribeEpoch: Unsubscribe | null = null;
  private unsubscribeStatus: Unsubscribe | null = null;
  private unsubscribeCommand: Unsubscribe | null = null;

  async isAvailable(): Promise<boolean> {
    if (!watchBridge.isNativeAvailable()) return false;
    const status = await watchBridge.activate();
    this.link = status;
    this.emitStatus();
    return status.paired && status.appInstalled;
  }

  async start(): Promise<void> {
    if (this.started) return; // idempotent by contract
    this.started = true;
    this.error = watchBridge.isNativeAvailable() ? null : 'WATCH_LINK_NATIVE_MODULE_MISSING';

    this.unsubscribeEpoch = watchBridge.onEpoch((payload) => this.ingest(payload));
    this.unsubscribeStatus = watchBridge.onStatus((status) => {
      this.link = status;
      this.emitStatus();
    });
    this.unsubscribeCommand = watchBridge.onCommand((command) => {
      for (const listener of this.commandListeners) listener(command);
    });

    this.link = await watchBridge.activate();
    await watchBridge.sendCommand('start');
    this.emitStatus();
  }

  async stop(): Promise<void> {
    if (!this.started) return; // safe when never started
    this.started = false;
    this.unsubscribeEpoch?.();
    this.unsubscribeStatus?.();
    this.unsubscribeCommand?.();
    this.unsubscribeEpoch = null;
    this.unsubscribeStatus = null;
    this.unsubscribeCommand = null;
    await watchBridge.sendCommand('stop');
    this.emitStatus();
  }

  getStatus(): SensorStatus {
    return {
      id: this.id,
      kind: this.kind,
      connected: this.link.paired && this.link.appInstalled,
      reachable: this.started && this.link.reachable,
      lastEpochT: this.lastEpochT,
      battery: this.battery,
      error: this.error,
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

  onCommand(listener: (command: 'stop') => void): Unsubscribe {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }

  /** Validate, align to the 30 s grid, drop replays, then fan out. */
  private ingest(payload: WatchEpochPayload): void {
    const seconds = toNullableNumber(payload.t);
    if (seconds === null || seconds < 0) {
      this.error = 'EPOCH_BAD_TIMESTAMP';
      this.emitStatus();
      return;
    }

    const candidate = {
      t: epochIndexOf(seconds * 1000),
      hrMean: toNullableNumber(payload.hrMean),
      hrSd: toNullableNumber(payload.hrSd),
      motion: toNullableNumber(payload.motion),
      battery: toNullableNumber(payload.battery),
      source: this.kind,
    };

    const parsed = SensorEpochSchema.safeParse(candidate);
    if (!parsed.success) {
      // out-of-range HR / battery: keep the night going, record why
      this.error = `EPOCH_REJECTED:${parsed.error.issues[0]?.path.join('.') ?? 'unknown'}`;
      this.emitStatus();
      return;
    }

    // replays and backwards clocks never reach the engine
    if (this.lastEpochT !== null && parsed.data.t <= this.lastEpochT) {
      this.emitStatus();
      return;
    }

    this.lastEpochT = parsed.data.t;
    if (parsed.data.battery !== null) this.battery = parsed.data.battery;
    this.error = null;

    for (const listener of this.epochListeners) listener(parsed.data);
    this.emitStatus();
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) listener(status);
  }
}

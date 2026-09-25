/**
 * `SensorSource` backed by the Apple Watch companion app (DESIGN §8.1, first row).
 *
 * The watch does the aggregation (HR per second + accelerometer at 20 Hz → one 30 s
 * epoch) and sends `{t, hrMean, hrSd, motion, battery}`. This class does three things
 * and nothing else:
 *
 *  1. validates every payload with the engine's own `normalizeEpochs` + `SensorEpochSchema` —
 *     a watch message is untrusted input (APP-RUN §0.5 S8): out-of-range HR and replayed or
 *     backwards epochs are dropped here, and again in the engine. Using the engine's
 *     normaliser rather than a local copy of the same rules is deliberate: it is the code a
 *     replayed diagnostics night goes through (`replay.ts`), so a live night and a replay
 *     cannot be judged differently;
 *  2. keeps a status snapshot for the Diagnostics screen;
 *  3. never decides anything about REM — that is `packages/engine`.
 */

import { epochIndexOf, normalizeEpochs, SensorEpochSchema, type SensorEpoch } from '@lucid/engine';

import { WATCH_APP_NOT_INSTALLED } from '../types';
import type { SensorSource, SensorStatus, Unsubscribe } from '../types';
import { watchBridge, type WatchEpochPayload, type WatchLinkStatus } from './watchBridge';

/** Re-activating WCSession more often than this buys nothing — activation is idempotent but not free. */
const PROBE_MIN_INTERVAL_MS = 5000;

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class WatchSensorSource implements SensorSource {
  readonly id = 'apple-watch';
  readonly kind = 'WATCH' as const;

  private started = false;
  private link: WatchLinkStatus = { paired: false, appInstalled: false, reachable: false, model: null };
  private lastEpochT: number | null = null;
  private lastBpm: number | null = null;
  private battery: number | null = null;
  private error: string | null = null;

  private readonly epochListeners = new Set<(epoch: SensorEpoch) => void>();
  private readonly statusListeners = new Set<(status: SensorStatus) => void>();
  private readonly commandListeners = new Set<(command: 'stop') => void>();
  private unsubscribeEpoch: Unsubscribe | null = null;
  private unsubscribeStatus: Unsubscribe | null = null;
  private unsubscribeCommand: Unsubscribe | null = null;

  private linkSubscribed = false;
  private lastProbeMs = 0;

  /**
   * R1 hotfix (2026-09-25): nothing ever called `isAvailable()`/`start()` before a night began,
   * so `this.link` stayed at its all-false default and every devices screen said "no pulse
   * device" even with a paired watch. Two fixes: (1) the native `status` event (fired from
   * `activationDidCompleteWith`, which is asynchronous) is listened to from the first probe on,
   * not only inside `start()`; (2) `refreshDevicesFromPlatform()` calls {@link probe}, which
   * activates the session at most once per {@link PROBE_MIN_INTERVAL_MS}.
   */
  private subscribeLinkStatus(): void {
    if (this.linkSubscribed || !watchBridge.isNativeAvailable()) return;
    this.linkSubscribed = true;
    watchBridge.onStatus((status) => {
      this.link = status;
      this.emitStatus();
    });
  }

  /** Fire-and-forget refresh of the paired/installed flags; safe to call on every screen tick. */
  probe(): void {
    const now = Date.now();
    if (now - this.lastProbeMs < PROBE_MIN_INTERVAL_MS) return;
    this.lastProbeMs = now;
    void this.isAvailable().catch(() => undefined);
  }

  async isAvailable(): Promise<boolean> {
    if (!watchBridge.isNativeAvailable()) return false;
    this.subscribeLinkStatus();
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

  /**
   * WO L3.9: a watch that is paired but has no Dreaming on it is not "no watch" — it is a watch
   * one tap away from working, and the devices screen has to be able to say so (the owner's
   * TestFlight 0.1.0 (1) showed "no pulse device" with the watch on his wrist). It travels in
   * `error` because that is the field for a machine-readable transport reason, and
   * `src/devices/registry.ts#watchLinkHint` is the only reader.
   */
  private linkError(): string | null {
    if (this.error !== null) return this.error;
    return this.link.paired && !this.link.appInstalled ? WATCH_APP_NOT_INSTALLED : null;
  }

  getStatus(): SensorStatus {
    return {
      id: this.id,
      kind: this.kind,
      connected: this.link.paired && this.link.appInstalled,
      reachable: this.started && this.link.reachable,
      lastEpochT: this.lastEpochT,
      // The watch's only output is epochs, so "last reading" and "last epoch" are one number.
      lastDataT: this.lastEpochT,
      lastBpm: this.lastBpm,
      battery: this.battery,
      error: this.linkError(),
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

    const candidate: SensorEpoch = {
      t: epochIndexOf(seconds * 1000),
      hrMean: toNullableNumber(payload.hrMean),
      hrSd: toNullableNumber(payload.hrSd),
      motion: toNullableNumber(payload.motion),
      battery: toNullableNumber(payload.battery),
      source: this.kind,
    };

    // The engine's own normaliser first (WO L2.2n): it is what `replay.ts` runs over a recorded
    // night, so a live epoch and a replayed one are put on the 30 s grid and range-checked by the
    // *same* code — the alternative was a second, hand-written copy of "HR out of 25..220 is not
    // evidence" here, and two copies of a rule is how they drift. It returns an empty array when
    // it dropped the epoch.
    const [normalized] = normalizeEpochs([candidate]);
    if (!normalized) {
      this.error = 'EPOCH_REJECTED:hrMean';
      this.emitStatus();
      return;
    }

    // Then the schema, which catches everything `normalizeEpochs` does not look at: a battery
    // above 1, a negative motion energy, an absurd hrSd.
    const parsed = SensorEpochSchema.safeParse(normalized);
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
    // WO L2.3: the devices screen prints the mockup's own "heart 62" line from this
    // (`SensorStatus.lastBpm`). Only overwritten when the epoch actually carried a heart rate —
    // a motion-only epoch must not blank the last real reading a second later.
    if (parsed.data.hrMean !== null) this.lastBpm = parsed.data.hrMean;
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

/**
 * JS side of the iPhone <-> Apple Watch link (WCSession).
 *
 * The native half now exists: `apps/mobile/modules/lucid-watch-link` (WO L2.2n). It is still
 * resolved **optionally**, and every function here degrades to "not connected" rather than
 * throwing, because the module is genuinely absent in three real situations:
 *   1. the web QC bundle (`expo export --platform web`, APP-RUN §0.2 rule 2);
 *   2. any build made before this work order (TestFlight R1 candidates already out there);
 *   3. an iPhone with no watch at all, where `WCSession.isSupported()` is `false` — there the
 *      module loads but every status field is `false`.
 *
 * What lives where, so this file stays small:
 *   - transport, queues, threads → Swift (`LucidWatchLinkModule.swift`);
 *   - validation of the payload → `WatchSensorSource.ts`, against the engine's own schema
 *     (APP-RUN §0.5 S8: a watch message is untrusted input, and the app must judge it by the
 *     same rules a replayed diagnostics file is judged by);
 *   - this file: names, the optional-module fallback, and nothing else.
 *
 * Event names changed with the native module: the L1.1 stub declared `onEpoch`/`onStatus`/
 * `onCommand`, the module emits `epoch`/`status`/`command` (the names the work order specifies,
 * and the ones Expo's own `Events(...)` list reads best). The exported functions kept their
 * `on*` names, so no caller changed.
 */

import LucidWatchLink, {
  type NativeWatchEpoch,
  type NativeWatchLinkStatus,
} from '../../../modules/lucid-watch-link';

/** Raw payload the watch sends. Treated as untrusted input (APP-RUN §0.5 S8). */
export interface WatchEpochPayload {
  t?: unknown;
  hrMean?: unknown;
  hrSd?: unknown;
  motion?: unknown;
  battery?: unknown;
}

export interface WatchLinkStatus {
  /** A watch is paired with this phone. */
  paired: boolean;
  /** Our watch app is installed on it. */
  appInstalled: boolean;
  /** `WCSession.isReachable` — messages can go through right now. */
  reachable: boolean;
  /** Watch model string when the native module knows it — it never does; see below. */
  model: string | null;
}

export const WATCH_LINK_UNAVAILABLE = 'WATCH_LINK_NATIVE_MODULE_MISSING' as const;

export const OFFLINE_STATUS: WatchLinkStatus = {
  paired: false,
  appInstalled: false,
  reachable: false,
  model: null,
};

/**
 * The native side says `installed`, this side has always said `appInstalled`, and `model` is
 * always `null` because `WCSession` exposes no watch model (the L1.1 stub left the field open
 * "when the native module knows it"; it does not, and a hard-coded "Apple Watch" would be a
 * made-up device name on the diagnostics screen).
 *
 * Also the last line of defence for a malformed status: anything non-boolean becomes `false`, so
 * a broken bridge reads as "no watch" instead of "connected" — the safe direction, since a
 * missing watch only costs the night its best sensor (L2.7's timer fallback takes over), while a
 * falsely "connected" one would make the night wait for epochs that never come.
 */
function toStatus(raw: NativeWatchLinkStatus | null | undefined): WatchLinkStatus {
  if (raw === null || raw === undefined) return OFFLINE_STATUS;
  return {
    paired: raw.paired === true,
    appInstalled: raw.installed === true,
    reachable: raw.reachable === true,
    model: typeof raw.model === 'string' && raw.model.length > 0 ? raw.model : null,
  };
}

export const watchBridge = {
  /** `false` on web and in any build without the L2.2n native module. */
  isNativeAvailable(): boolean {
    return LucidWatchLink !== null;
  },

  async activate(): Promise<WatchLinkStatus> {
    if (!LucidWatchLink) return OFFLINE_STATUS;
    try {
      return toStatus(await LucidWatchLink.activate());
    } catch {
      // `WCSession` refusing to activate must not stop a night from starting data-only
      // (DESIGN §2.1, sleep first).
      return OFFLINE_STATUS;
    }
  },

  getStatus(): WatchLinkStatus {
    if (!LucidWatchLink) return OFFLINE_STATUS;
    try {
      return toStatus(LucidWatchLink.getStatus());
    } catch {
      return OFFLINE_STATUS;
    }
  },

  /** Phone → watch. Swallows "not reachable": the watch may simply be off the wrist. */
  async sendCommand(command: 'start' | 'stop'): Promise<void> {
    if (!LucidWatchLink) return;
    try {
      await LucidWatchLink.sendCommand(command);
    } catch {
      // The watch app starts its own night when the user presses its button, and a phone-side
      // 'stop' is followed by `stop()` on this side anyway, so a lost command never leaves the
      // two sides disagreeing for long.
    }
  },

  /**
   * Phone → watch face: the numbers the watch shows but never computes (DESIGN §8.2 — the
   * estimator lives on the phone). Called from `IosLiveStatus`, which is the one place that
   * already knows the current status line, whisper count and REM estimate.
   */
  async sendStatus(status: {
    pRem: number | null;
    cuesPlayed: number;
    cuesPlanned: number;
  }): Promise<void> {
    if (!LucidWatchLink) return;
    try {
      await LucidWatchLink.sendStatus(status.pRem, status.cuesPlayed, status.cuesPlanned);
    } catch {
      // A watch-face number is never worth failing a night over.
    }
  },

  /**
   * Phone → watch complication: nights in a row (`targets/watch-complication`).
   *
   * No caller yet: the streak is a fact about the SQLite journal and the work order that owns the
   * journal totals (L3.x) is the right place to push it — one line, right where the streak is
   * computed. Until then the complication honestly shows a dash rather than a zero.
   */
  async setStreakNights(nights: number): Promise<void> {
    if (!LucidWatchLink) return;
    try {
      await LucidWatchLink.setStreakNights(nights);
    } catch {
      // as above
    }
  },

  onEpoch(listener: (payload: WatchEpochPayload) => void): () => void {
    if (!LucidWatchLink) return () => undefined;
    const subscription = LucidWatchLink.addListener('epoch', (payload: NativeWatchEpoch) =>
      listener(payload),
    );
    return () => subscription.remove();
  },

  onStatus(listener: (status: WatchLinkStatus) => void): () => void {
    if (!LucidWatchLink) return () => undefined;
    const subscription = LucidWatchLink.addListener('status', (status) => listener(toStatus(status)));
    return () => subscription.remove();
  },

  /** The watch's own hold-to-stop button (mockup `05-night.png` frame b · WO L2.8). */
  onCommand(listener: (command: 'stop') => void): () => void {
    if (!LucidWatchLink) return () => undefined;
    const subscription = LucidWatchLink.addListener('command', (command) => {
      if (command?.type === 'stop') listener('stop');
    });
    return () => subscription.remove();
  },
};

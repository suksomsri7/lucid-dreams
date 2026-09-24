/**
 * JS side of the iPhone <-> Apple Watch link (WCSession).
 *
 * ⚠️ HONEST STATUS (L1.1, built on Linux): the native half does not exist yet.
 *
 * The watch app in `targets/watch` already sends every 30 s epoch with
 * `WCSession.sendMessage` (falling back to `transferUserInfo` when unreachable).
 * Receiving it on the phone needs an iOS native module — a ~120-line Swift
 * `Module` that implements `WCSessionDelegate` and re-emits the payload as an Expo
 * event. That module cannot be written *and compiled* here: there is no macOS,
 * no Xcode and no Apple account yet (APP-RUN §0.3 item 2).
 *
 * So this file is the *complete JS contract* against a native module named
 * `LucidWatchLink`, resolved optionally. When the native module is missing (today,
 * and on the web QC build) everything degrades to "not connected" instead of crashing.
 *
 * To finish in L2.2 (needs a Mac or an EAS build):
 *  1. add `modules/lucid-watch-link/ios/LucidWatchLinkModule.swift` implementing
 *     `WCSessionDelegate` (`session(_:didReceiveMessage:)` and
 *     `session(_:didReceiveUserInfo:)`) and emitting the `onEpoch` / `onStatus` events
 *     declared below;
 *  2. expose `isPaired`, `isWatchAppInstalled`, `isReachable` from `WCSession.default`;
 *  3. no schema changes here — the payload is validated below, not trusted.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

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
  /** Watch model string when the native module knows it. */
  model: string | null;
}

interface NativeWatchLink {
  activate(): Promise<WatchLinkStatus>;
  getStatus(): WatchLinkStatus;
  /** Ask the watch to start/stop its workout session. */
  sendCommand(command: 'start' | 'stop'): Promise<void>;
  addListener(event: 'onEpoch', listener: (payload: WatchEpochPayload) => void): { remove(): void };
  addListener(event: 'onStatus', listener: (status: WatchLinkStatus) => void): { remove(): void };
  /**
   * The other direction: the watch face/complication has its own "stop" button
   * (mockup `05-night.png` frame b) — pressing it sends this event to the phone
   * instead of (or in addition to) `sendCommand`, which only goes phone → watch.
   * WO L2.8's JS-side contract; the native `LucidWatchLinkModule.swift` emitting it is
   * the same "needs a Mac" gap `sendCommand`/`onEpoch` above already document.
   */
  addListener(event: 'onCommand', listener: (command: { type: 'stop' }) => void): { remove(): void };
}

const native = requireOptionalNativeModule<NativeWatchLink>('LucidWatchLink');

export const WATCH_LINK_UNAVAILABLE = 'WATCH_LINK_NATIVE_MODULE_MISSING' as const;

export const OFFLINE_STATUS: WatchLinkStatus = {
  paired: false,
  appInstalled: false,
  reachable: false,
  model: null,
};

export const watchBridge = {
  /** `false` until the native module from L2.2 is in the build. */
  isNativeAvailable(): boolean {
    return native !== null;
  },

  async activate(): Promise<WatchLinkStatus> {
    if (!native) return OFFLINE_STATUS;
    return native.activate();
  },

  getStatus(): WatchLinkStatus {
    if (!native) return OFFLINE_STATUS;
    return native.getStatus();
  },

  async sendCommand(command: 'start' | 'stop'): Promise<void> {
    if (!native) return;
    await native.sendCommand(command);
  },

  onEpoch(listener: (payload: WatchEpochPayload) => void): () => void {
    if (!native) return () => undefined;
    const subscription = native.addListener('onEpoch', listener);
    return () => subscription.remove();
  },

  onStatus(listener: (status: WatchLinkStatus) => void): () => void {
    if (!native) return () => undefined;
    const subscription = native.addListener('onStatus', listener);
    return () => subscription.remove();
  },

  /** WO L2.8: the watch's own "stop" button, see `NativeWatchLink.addListener('onCommand', …)` above. */
  onCommand(listener: (command: 'stop') => void): () => void {
    if (!native) return () => undefined;
    const subscription = native.addListener('onCommand', (command) => listener(command.type));
    return () => subscription.remove();
  },
};

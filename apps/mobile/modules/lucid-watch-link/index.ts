/**
 * `LucidWatchLink` — the typed JavaScript surface of the iPhone ⇄ Apple Watch link
 * (WO L2.2 · native half: `ios/LucidWatchLinkModule.swift`).
 *
 * This file is deliberately thin: it declares the native module's shape and resolves it
 * **optionally**. Everything above it (`src/platform/ios/watchBridge.ts`) keeps working when
 * the module is absent — which is the case on the web QC bundle (`expo export --platform web`)
 * and in any build made before this work order. `requireNativeModule` would throw at import
 * time there and take the whole bundle down with it.
 *
 * Nothing here validates the payloads: a watch message is untrusted input and is checked
 * against the engine's own schema one layer up (APP-RUN §0.5 S8), so that the app and a
 * replayed diagnostics file are judged by exactly the same rules.
 */

import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/**
 * One 30 s epoch as it comes off the wire. Every field is `unknown` on purpose — the Swift side
 * copies whatever numbers the watch sent and leaves absent fields out of the dictionary
 * entirely, so a missing key and a `null` are different things here.
 */
export interface NativeWatchEpoch {
  t?: unknown;
  hrMean?: unknown;
  hrSd?: unknown;
  motion?: unknown;
  battery?: unknown;
}

export interface NativeWatchLinkStatus {
  /** A watch is paired with this iPhone. */
  paired: boolean;
  /** Our watch app is installed on it. `WCSession.isWatchAppInstalled`. */
  installed: boolean;
  /** `WCSession.isReachable` — a message can go through right now. */
  reachable: boolean;
  /** Always `null`: `WCSession` exposes no watch model. Kept so the field never has to be added later. */
  model: string | null;
}

export interface NativeWatchCommand {
  /** The watch's own hold-to-stop button is the only command it sends (DESIGN §3.4). */
  type: 'stop';
}

export interface LucidWatchLinkNativeModule {
  /** Idempotent. Resolving says nothing about whether a watch is there — read the result. */
  activate(): Promise<NativeWatchLinkStatus>;
  getStatus(): NativeWatchLinkStatus;
  /** Phone → watch. Rejects when the watch is not reachable right now. */
  sendCommand(command: 'start' | 'stop'): Promise<void>;
  /** Phone → watch face: the live status the watch mirrors but never computes. */
  sendStatus(pRem: number | null, cuesPlayed: number, cuesPlanned: number): Promise<void>;
  /** Phone → watch complication: nights in a row (`targets/watch-complication`). */
  setStreakNights(nights: number): Promise<void>;

  addListener(event: 'epoch', listener: (payload: NativeWatchEpoch) => void): EventSubscription;
  addListener(event: 'status', listener: (status: NativeWatchLinkStatus) => void): EventSubscription;
  addListener(event: 'command', listener: (command: NativeWatchCommand) => void): EventSubscription;
}

/** `null` when the native module is not in this build (web, or any pre-L2.2 binary). */
const LucidWatchLink = requireOptionalNativeModule<LucidWatchLinkNativeModule>('LucidWatchLink');

export default LucidWatchLink;

/**
 * `LucidLiveActivity` — typed surface of the ActivityKit module
 * (native half: `ios/LucidLiveActivityModule.swift`, view: `targets/live-activity/`).
 *
 * Resolved optionally so the web QC bundle and any build made before this work order keep
 * working: `IosLiveStatus` reports `isSupported() === false` instead of crashing at import time.
 *
 * Every string passed in is **already translated** (`LiveStatusContent`'s own contract in
 * `src/platform/types.ts`) — this layer never translates and never formats numbers.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

export interface LucidLiveActivityNativeModule {
  /** `false` when Live Activities are switched off for the device or for this app. */
  isSupported(): boolean;
  /**
   * `theme` is the fixed line for the whole night ("🐋 ดำน้ำกับฉลามวาฬ"); the other three change.
   * Rejects when Live Activities are disabled or ActivityKit refuses the request. Calling it
   * twice updates the existing card rather than starting a second one.
   */
  start(theme: string, status: string, cuesPlayed: number, cuesPlanned: number): Promise<void>;
  /** No-op when no card is on screen. */
  update(status: string, cuesPlayed: number, cuesPlanned: number): Promise<void>;
  /** Removes the card immediately. Safe when nothing is running. */
  end(): Promise<void>;
}

const LucidLiveActivity = requireOptionalNativeModule<LucidLiveActivityNativeModule>('LucidLiveActivity');

export default LucidLiveActivity;

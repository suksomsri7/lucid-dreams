/**
 * `LucidAudioRoute` — typed surface of the audio-output-route reader
 * (native half: `ios/LucidAudioRouteModule.swift`, consumed by `src/platform/ios/audioRoute.ts`).
 *
 * Resolved **optionally**, like every other local module here (`lucid-watch-link`,
 * `lucid-focus`): it is genuinely absent on the web QC bundle (`expo export --platform web`,
 * APP-RUN §0.2 rule 2), on Android, and in any build made before WO L3.9 — including the
 * TestFlight 0.1.0 (1) that is on the owner's phone right now. `requireNativeModule` would throw
 * at import time in all three cases and take the bundle down with it; `null` here just means
 * "no route information", which the layer above already has to handle.
 */

import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/**
 * One output port as iOS describes it. Both fields are `unknown` on purpose — this is native
 * input like any other, and `src/platform/ios/audioRoute.ts` is the one place that decides what
 * a value has to look like to be believed (APP-RUN §0.5 S8).
 */
export interface NativeAudioRoute {
  /**
   * `AVAudioSession.Port`'s raw value: `BluetoothA2DP`, `BluetoothHFP`, `BluetoothLE`,
   * `Headphones`, `USBAudio`, `AirPlay`, `CarAudio`, `BuiltInSpeaker`, `BuiltInReceiver`, …
   * The only field anything is decided from.
   */
  portType?: unknown;
  /** The user-visible device name ("Sleep A20", "iPhone Speaker"). Only ever displayed. */
  portName?: unknown;
}

export interface LucidAudioRouteNativeModule {
  /** `null` when iOS publishes no output port at all. Synchronous — two local property reads. */
  getCurrentRoute(): NativeAudioRoute | null;
  /**
   * Fires on `AVAudioSession.routeChangeNotification` — headphones plugged in or pulled out, a
   * Bluetooth device connecting or disconnecting, the system overriding the port. Both fields are
   * `null` when the new route has no output.
   */
  addListener(event: 'onRouteChange', listener: (route: NativeAudioRoute) => void): EventSubscription;
}

/** `null` on web/Android and in any build without the L3.9 native module. */
const LucidAudioRoute = requireOptionalNativeModule<LucidAudioRouteNativeModule>('LucidAudioRoute');

export default LucidAudioRoute;

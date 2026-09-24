/**
 * The single door between the app and any platform API.
 *
 * Selection happens twice, on purpose:
 *  1. **at bundle time** — Metro resolves `./native` to `native.ios.ts` on iOS and to
 *     `native.ts` elsewhere, so iOS-only modules (`expo-glass-effect`, the WCSession
 *     bridge) are physically absent from the web and Android bundles;
 *  2. **at runtime** — `Platform.OS` below picks the bundle, and falls back to the stub
 *     if the native one is somehow missing.
 *
 * Android and web both get the throwing stubs in Phase 1 (APP-RUN §0.2 rule 8).
 */

import { Platform } from 'react-native';

import { createStubPlatform } from './android';
import { createNativePlatform } from './native';
import type { PlatformBundle } from './types';

function select(): PlatformBundle {
  if (Platform.OS === 'ios') {
    return createNativePlatform() ?? createStubPlatform('unsupported');
  }
  if (Platform.OS === 'android') {
    return createStubPlatform('android');
  }
  // web (QC screenshots) and anything else
  return createStubPlatform('unsupported');
}

let cached: PlatformBundle | null = null;

/** Lazily built once, so importing this module has no side effects. */
export function getPlatform(): PlatformBundle {
  cached ??= select();
  return cached;
}

/** Test seam — lets a screen test inject fakes. Never called in app code. */
export function __setPlatformForTests(bundle: PlatformBundle | null): void {
  cached = bundle;
}

export { GlassSurface, hasRealGlass } from './GlassSurface';
export type { GlassSurfaceProps } from './GlassSurface';
export { NotImplementedError } from './types';
export type {
  AudioEvent,
  AudioPlayer,
  AudioPlayerStatus,
  AudioSessionState,
  BatteryReader,
  BleAvailability,
  BleBondedDevice,
  BleScanResult,
  BleSensorSource,
  DeviceInfoReader,
  Display,
  HealthImport,
  LiveStatus,
  LiveStatusContent,
  NotificationsPermission,
  PlatformBundle,
  SampleSensorSource,
  SensorEpoch,
  SensorSample,
  SensorSource,
  SensorStatus,
  SleepPhase,
  SpeechResult,
  SpeechToText,
  Unsubscribe,
} from './types';

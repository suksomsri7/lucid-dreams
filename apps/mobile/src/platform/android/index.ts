/**
 * Android stubs. Every method throws `NotImplementedError` (APP-RUN §0.2 rule 8:
 * "stub `android/` from L1.1 onward · no Android testing in Phase 1").
 *
 * Why stubs that throw rather than silent no-ops: a night engine that thinks it has a
 * heart-rate source when it has none would whisper on a prior alone. Failing loudly is
 * the sleep-first default (DESIGN §2.1).
 *
 * This bundle is also what the **web** QC build gets, because nothing here touches a
 * native module — so `expo export --platform web` renders every screen and the screens
 * simply show "this device cannot do that yet" (see `src/i18n`).
 *
 * When Android becomes real (Phase 2), the shopping list is:
 *  - `WearSensorSource` — Health Services on Wear OS, same 30 s epoch payload;
 *  - `BleHeartRateSource`/`PhoneMotionSource` — the same `react-native-ble-plx`/`expo-sensors`
 *    code the iOS side runs, plus Android's runtime Bluetooth permissions;
 *  - `AndroidAudioPlayer` — foreground service + `expo-audio` (already cross-platform);
 *  - `AndroidLiveStatus` — ongoing notification instead of a Live Activity;
 *  - `AndroidHealthImport` — Health Connect sleep stages;
 *  - `AndroidSpeechToText` — on-device `SpeechRecognizer`.
 */

import type {
  AudioEvent,
  AudioPlayer,
  AudioPlayerStatus,
  BatteryReader,
  BleAvailability,
  BleBondedDevice,
  BleScanResult,
  BleSensorSource,
  DeviceInfoReader,
  Display,
  HealthImport,
  LiveStatus,
  NotificationsPermission,
  PlatformBundle,
  SampleSensorSource,
  SensorSource,
  SensorStatus,
  SleepPhase,
  SpeechResult,
  SpeechToText,
  Unsubscribe,
} from '../types';
import { NotImplementedError } from '../types';

const noop = (): Unsubscribe => () => undefined;

class AndroidSensorSource implements SensorSource {
  readonly id = 'android-wear-stub';
  readonly kind = 'WATCH' as const;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async start(): Promise<void> {
    throw new NotImplementedError('Wear OS sensor source');
  }

  async stop(): Promise<void> {
    // never started — safe
  }

  getStatus(): SensorStatus {
    return {
      id: this.id,
      kind: this.kind,
      connected: false,
      reachable: false,
      lastEpochT: null,
      lastDataT: null,
      lastBpm: null,
      battery: null,
      error: 'NOT_IMPLEMENTED',
    };
  }

  onEpoch(): Unsubscribe {
    return noop();
  }

  onStatus(): Unsubscribe {
    return noop();
  }

  onCommand(): Unsubscribe {
    return noop();
  }
}

/**
 * BLE heart rate (WO L2.3). Android *could* run `react-native-ble-plx` as-is — the library is
 * cross-platform and the GATT profile is the same — but Phase 1 builds no Android app and the
 * permission model there (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, and location on older API
 * levels) is a real piece of work, not a re-export. Until that work happens this reports "not
 * here" rather than half-working. On **web** this same stub is what the QC bundle gets, which is
 * also what keeps `react-native-ble-plx` out of a bundle that has no radio to talk to.
 */
class AndroidBleHeartRateSource implements BleSensorSource {
  readonly id = 'ble-heart-rate-stub';
  readonly kind = 'BLE_HR' as const;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async availability(): Promise<BleAvailability> {
    return 'UNSUPPORTED';
  }

  selected(): BleBondedDevice | null {
    return null;
  }

  async scan(_onResults: (results: BleScanResult[]) => void): Promise<Unsubscribe> {
    throw new NotImplementedError('BLE scanning');
  }

  async select(_device: BleBondedDevice): Promise<void> {
    throw new NotImplementedError('BLE pairing');
  }

  async forget(): Promise<void> {
    // nothing was ever bonded — safe
  }

  async start(): Promise<void> {
    throw new NotImplementedError('BLE heart-rate source');
  }

  async stop(): Promise<void> {
    // never started — safe
  }

  getStatus(): SensorStatus {
    return {
      id: this.id,
      kind: this.kind,
      connected: false,
      reachable: false,
      lastEpochT: null,
      lastDataT: null,
      lastBpm: null,
      battery: null,
      error: 'NOT_IMPLEMENTED',
    };
  }

  onSample(): Unsubscribe {
    return noop();
  }

  onEpoch(): Unsubscribe {
    return noop();
  }

  onStatus(): Unsubscribe {
    return noop();
  }

  onCommand(): Unsubscribe {
    return noop();
  }
}

/** Phone-on-mattress accelerometer (WO L2.3) — same story as the BLE stub above. */
class AndroidPhoneMotionSource implements SampleSensorSource {
  readonly id = 'phone-on-mattress-stub';
  readonly kind = 'PHONE_MOTION' as const;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async start(): Promise<void> {
    throw new NotImplementedError('Phone motion source');
  }

  async stop(): Promise<void> {
    // never started — safe
  }

  getStatus(): SensorStatus {
    return {
      id: this.id,
      kind: this.kind,
      connected: false,
      reachable: false,
      lastEpochT: null,
      lastDataT: null,
      lastBpm: null,
      battery: null,
      error: 'NOT_IMPLEMENTED',
    };
  }

  onSample(): Unsubscribe {
    return noop();
  }

  onEpoch(): Unsubscribe {
    return noop();
  }

  onStatus(): Unsubscribe {
    return noop();
  }

  onCommand(): Unsubscribe {
    return noop();
  }
}

class AndroidAudioPlayer implements AudioPlayer {
  async configureSession(): Promise<void> {
    throw new NotImplementedError('Android audio session');
  }

  async startBed(): Promise<void> {
    throw new NotImplementedError('Android bed audio');
  }

  async stopBed(): Promise<void> {
    // nothing playing — safe
  }

  async setVolume(): Promise<void> {
    throw new NotImplementedError('Android audio volume');
  }

  async playCue(): Promise<void> {
    throw new NotImplementedError('Android cue playback');
  }

  /**
   * Android has no build in Phase 1, and this same stub is what the **web** QC bundle
   * gets (`createStubPlatform('unsupported')`, see the file header) — the plan-card
   * preview and ear-test screens still need to call *something* there without crashing
   * the export, so this logs and resolves instead of throwing like the rest of the
   * class. Kept deliberately silent about volume/pan (nothing plays) — a QC screenshot
   * never depends on sound.
   */
  async playOneShot(options: { source: string; volume: number; pan?: number }): Promise<void> {
    // eslint-disable-next-line no-console -- intentional web/Android stub log (WO L1.7ui)
    console.log('[AudioPlayer.playOneShot] stub (no native audio on this platform)', options);
  }

  getStatus(): AudioPlayerStatus {
    return { state: 'idle', volume: 0, route: null, error: 'NOT_IMPLEMENTED' };
  }

  onEvent(_listener: (event: AudioEvent) => void): Unsubscribe {
    return noop();
  }

  async dispose(): Promise<void> {
    // nothing to release
  }
}

class AndroidLiveStatus implements LiveStatus {
  isSupported(): boolean {
    return false;
  }

  async start(): Promise<void> {
    throw new NotImplementedError('Android ongoing notification');
  }

  async update(): Promise<void> {
    throw new NotImplementedError('Android ongoing notification');
  }

  async stop(): Promise<void> {
    // nothing shown — safe
  }

  /**
   * Nothing draws a stop button on this platform yet (the ongoing notification is Phase 2), so
   * there is nothing to listen to. Returns the same no-op unsubscriber as the other listeners
   * here rather than throwing: a night on the web QC bundle subscribes to this at start-up.
   */
  onStopRequested(_listener: () => void): Unsubscribe {
    return noop();
  }
}

class AndroidHealthImport implements HealthImport {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async requestAuthorization(): Promise<boolean> {
    return false;
  }

  async fetchSleepPhases(): Promise<SleepPhase[]> {
    throw new NotImplementedError('Health Connect sleep import');
  }

  async fetchHeartRateSamples(): Promise<{ atIso: string; bpm: number }[]> {
    throw new NotImplementedError('Health Connect heart rate import');
  }
}

class AndroidNotificationsPermission implements NotificationsPermission {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async requestAuthorization(): Promise<boolean> {
    return false;
  }
}

class AndroidSpeechToText implements SpeechToText {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async requestPermissions(): Promise<boolean> {
    return false;
  }

  async start(): Promise<void> {
    throw new NotImplementedError('Android speech recognition');
  }

  async stop(): Promise<void> {
    // nothing running — safe
  }

  onResult(_listener: (result: SpeechResult) => void): Unsubscribe {
    return noop();
  }

  onError(_listener: (error: string) => void): Unsubscribe {
    return noop();
  }
}

class AndroidBatteryReader implements BatteryReader {
  async sample(): Promise<null> {
    return null;
  }
}

class AndroidDisplay implements Display {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async setBrightness(): Promise<void> {
    // no-op — Phase 2/web, never wired to a real backlight (see file header)
  }
}

class AndroidDeviceInfoReader implements DeviceInfoReader {
  /**
   * L1.2 fix: this stub used to hardcode `platform: 'android'` even when
   * `createStubPlatform('unsupported')` built it for the **web** QC bundle — so
   * `diagnostics.export.device.platform` (and anything else reading `deviceInfo.read()`)
   * reported "android" while running in a browser. Take the real platform name so it
   * reports 'web' there instead.
   */
  constructor(private readonly platformName: 'android' | 'web') {}

  async read(): Promise<{
    platform: 'ios' | 'android' | 'web';
    osVersion: string;
    model: string;
    modelName: string | null;
  }> {
    return { platform: this.platformName, osVersion: 'unknown', model: 'unknown', modelName: null };
  }
}

/** Used for `Platform.OS === 'android'` and for the web QC build. */
export function createStubPlatform(name: 'android' | 'unsupported'): PlatformBundle {
  const deviceInfoPlatform = name === 'android' ? 'android' : 'web';
  return {
    name,
    hasLiquidGlass: false,
    watchSensorSource: new AndroidSensorSource(),
    bleHeartRate: new AndroidBleHeartRateSource(),
    phoneMotion: new AndroidPhoneMotionSource(),
    audioPlayer: new AndroidAudioPlayer(),
    liveStatus: new AndroidLiveStatus(),
    healthImport: new AndroidHealthImport(),
    speechToText: new AndroidSpeechToText(),
    notifications: new AndroidNotificationsPermission(),
    battery: new AndroidBatteryReader(),
    deviceInfo: new AndroidDeviceInfoReader(deviceInfoPlatform),
    display: new AndroidDisplay(),
  };
}

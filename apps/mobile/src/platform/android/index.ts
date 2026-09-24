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
  DeviceInfoReader,
  HealthImport,
  LiveStatus,
  NotificationsPermission,
  PlatformBundle,
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
    audioPlayer: new AndroidAudioPlayer(),
    liveStatus: new AndroidLiveStatus(),
    healthImport: new AndroidHealthImport(),
    speechToText: new AndroidSpeechToText(),
    notifications: new AndroidNotificationsPermission(),
    battery: new AndroidBatteryReader(),
    deviceInfo: new AndroidDeviceInfoReader(deviceInfoPlatform),
  };
}

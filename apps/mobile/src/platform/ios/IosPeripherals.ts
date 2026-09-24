/**
 * The iOS pieces that are either fully real (battery, device info, glass detection) or
 * declared-but-not-yet-wired (Live Activity, HealthKit, Speech).
 *
 * The three unwired ones each need a native module or an extra dependency that this
 * spike deliberately does not add (APP-RUN §0.5 S9: every new dependency must be
 * justified). They are honest about it: `isSupported()` / `isAvailable()` return
 * `false` and the mutating calls throw a named error instead of silently doing nothing,
 * so a caller can never believe a Live Activity is on screen when it is not.
 *
 *  - `IosLiveStatus`  → ActivityKit widget, scheduled for L1.7 (needs a widget target;
 *    `@bacons/apple-targets` is already configured, so it is a target + native module).
 *  - `IosHealthImport` → HealthKit read access, scheduled for L2.9 (the entitlement and
 *    the usage strings are already in `app.config.ts`).
 *  - `IosSpeechToText` → `expo-speech-recognition` (DESIGN §8.2), scheduled for L1.6.
 *  - `IosNotificationsPermission` → `expo-notifications`, scheduled for L1.7/L3.1 (the
 *    usage string is already in `app.config.ts`; WO L1.3 only needs the ask to happen
 *    once at onboarding, not the scheduling API).
 */

import * as Battery from 'expo-battery';
import * as Brightness from 'expo-brightness';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { systemClock, type BatterySample, type Clock, type DeviceKind } from '@lucid/engine';

import type {
  BatteryReader,
  DeviceInfoReader,
  Display,
  HealthImport,
  LiveStatus,
  NotificationsPermission,
  SleepPhase,
  SpeechResult,
  SpeechToText,
  Unsubscribe,
} from '../types';

const NOT_WIRED = (what: string, wo: string): Error =>
  new Error(`${what} has no native implementation yet (scheduled for ${wo})`);

// ---------------------------------------------------------------------------

export class IosLiveStatus implements LiveStatus {
  isSupported(): boolean {
    return false; // becomes `true` when the ActivityKit target lands in L1.7
  }

  async start(): Promise<void> {
    throw NOT_WIRED('Live Activity', 'L1.7');
  }

  async update(): Promise<void> {
    throw NOT_WIRED('Live Activity', 'L1.7');
  }

  async stop(): Promise<void> {
    // stopping something that was never started must be harmless
  }
}

// ---------------------------------------------------------------------------

/**
 * WO L2.9's JS-side contract against HealthKit's own `sleepAnalysis` category
 * (`HKCategoryTypeIdentifier.sleepAnalysis`) — still declared-but-not-wired (see the
 * class-level TODOs below) because no maintained Expo HealthKit module targets SDK 57
 * yet (WO L1.3's own finding, unchanged as of this WO). The exact mapping the future
 * Swift bridge (`LucidHealthKitModule.swift`, same "needs a Mac" shape as
 * `watchBridge.ts`'s `LucidWatchLinkModule`) must produce, so `SleepPhase.stage` here
 * and `HKCategoryValueSleepAnalysis` there never drift apart:
 *
 *   `HKCategoryValueSleepAnalysis.asleepREM`  → `'REM'`
 *   `HKCategoryValueSleepAnalysis.asleepCore` → `'CORE'`  (N1+N2 collapsed, `types.ts`'s own comment)
 *   `HKCategoryValueSleepAnalysis.asleepDeep` → `'DEEP'`
 *   `HKCategoryValueSleepAnalysis.awake`      → `'AWAKE'`
 *   `HKCategoryValueSleepAnalysis.inBed`      → `'IN_BED'`
 *
 * `src/health/appleSleep.ts` is the app-side half of this contract (turns `SleepPhase[]`
 * into `@lucid/data`'s `ApplePhaseInput[]` and, from the stored epochs, a
 * precision/recall number) — it never assumes this class actually has data; every
 * failure mode here (`isAvailable() === false`, `requestAuthorization() === false`, or
 * `fetchSleepPhases()` throwing) is treated identically as "no Apple data yet"
 * (APP-RUN §0.5 S10: never show "0%" for "we never asked").
 */
export class IosHealthImport implements HealthImport {
  async isAvailable(): Promise<boolean> {
    return false; // HealthKit bridge lands in a future Opus native WO
  }

  async requestAuthorization(): Promise<boolean> {
    // WO L1.3: no maintained Expo HealthKit module targets SDK 57 yet, so this stays a
    // named-and-honest stub (never claim access we do not have — APP-RUN §0.5 S10) —
    // the entitlement + usage strings are already declared in `app.config.ts` so the
    // native bridge only has to fill this function in, nothing else.
    // TODO(native WO): call the real HealthKit authorization request here.
    return false;
  }

  async fetchSleepPhases(): Promise<SleepPhase[]> {
    // TODO(native WO): `HKSampleQuery` over `HKCategoryTypeIdentifier.sleepAnalysis`,
    // mapped through the `HKCategoryValueSleepAnalysis` table above.
    throw NOT_WIRED('HealthKit sleep import', 'a future Opus native WO');
  }

  async fetchHeartRateSamples(): Promise<{ atIso: string; bpm: number }[]> {
    throw NOT_WIRED('HealthKit heart rate import', 'a future Opus native WO');
  }
}

// ---------------------------------------------------------------------------

/**
 * The system notification prompt (DESIGN §3.4 daytime reality-check / evening reminder —
 * WO L1.3 only asks for the permission at onboarding time, scheduling those is L1.7/L3.1).
 * No `expo-notifications` dependency added yet (see the long comment on
 * `NotificationsPermission` in `../types.ts`) — this stays declared-but-not-wired like
 * `IosLiveStatus`/`IosHealthImport` above.
 */
export class IosNotificationsPermission implements NotificationsPermission {
  async isAvailable(): Promise<boolean> {
    return false; // becomes `true` once expo-notifications is added (L1.7/L3.1)
  }

  async requestAuthorization(): Promise<boolean> {
    // TODO(L1.7/L3.1): call the real notification permission request here.
    return false;
  }
}

// ---------------------------------------------------------------------------

export class IosSpeechToText implements SpeechToText {
  async isAvailable(): Promise<boolean> {
    return false; // expo-speech-recognition is added in L1.6
  }

  async requestPermissions(): Promise<boolean> {
    return false;
  }

  async start(): Promise<void> {
    throw NOT_WIRED('On-device speech recognition', 'L1.6');
  }

  async stop(): Promise<void> {
    // nothing running — safe
  }

  onResult(_listener: (result: SpeechResult) => void): Unsubscribe {
    return () => undefined;
  }

  onError(_listener: (error: string) => void): Unsubscribe {
    return () => undefined;
  }
}

// ---------------------------------------------------------------------------

function toBatteryState(state: Battery.BatteryState): BatterySample['state'] {
  switch (state) {
    case Battery.BatteryState.CHARGING:
      return 'CHARGING';
    case Battery.BatteryState.FULL:
      return 'FULL';
    case Battery.BatteryState.UNPLUGGED:
      return 'UNPLUGGED';
    default:
      return 'UNKNOWN';
  }
}

/** Real reading for the phone. Watch battery arrives inside the watch epochs. */
export class IosBatteryReader implements BatteryReader {
  constructor(private readonly clock: Clock = systemClock) {}

  async sample(device: DeviceKind): Promise<BatterySample | null> {
    if (device !== 'PHONE') return null;
    try {
      const [level, state, lowPowerMode] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
        Battery.isLowPowerModeEnabledAsync(),
      ]);
      // the simulator reports -1 when it has no battery to report
      if (level < 0) return null;
      return {
        at: this.clock.nowIso(),
        device: 'PHONE',
        level: Math.min(Math.max(level, 0), 1),
        state: toBatteryState(state),
        lowPowerMode,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Real, no permission needed on iOS (`Brightness.setBrightnessAsync` is unrestricted
 * there — the `SYSTEM_BRIGHTNESS` permission `expo-brightness`'s own types call out is
 * an Android-only concept; see `plugin/build/withBrightness.js`, which only ever adds
 * `android.permission.WRITE_SETTINGS`). WO L2.8's night screen dims the hardware
 * backlight on top of the already-dark UI (mockup `05-night.png` frame a).
 */
export class IosDisplay implements Display {
  async isAvailable(): Promise<boolean> {
    try {
      return await Brightness.isAvailableAsync();
    } catch {
      return false;
    }
  }

  async setBrightness(value: number): Promise<void> {
    const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    try {
      await Brightness.setBrightnessAsync(clamped);
    } catch {
      // Simulator / restricted context — the night must go on without a dimmed screen.
    }
  }
}

export class IosDeviceInfoReader implements DeviceInfoReader {
  async read(): Promise<{
    platform: 'ios' | 'android' | 'web';
    osVersion: string;
    model: string;
    modelName: string | null;
  }> {
    const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
    return {
      platform,
      osVersion: Device.osVersion ?? String(Platform.Version ?? 'unknown'),
      model: Device.modelId ?? 'unknown',
      modelName: Device.modelName ?? null,
    };
  }
}

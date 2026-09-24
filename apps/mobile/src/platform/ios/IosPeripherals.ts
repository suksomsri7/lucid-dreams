/**
 * The iOS pieces that are either fully real (battery, device info, glass detection, and — since
 * WO L2.2n — the Live Activity and HealthKit) or still honestly unwired (Speech, notifications).
 *
 * The unwired ones need a dependency this spike deliberately does not add yet (APP-RUN §0.5 S9:
 * every new dependency must be justified). They stay honest about it: `isSupported()` /
 * `isAvailable()` return `false` and the mutating calls throw a named error instead of silently
 * doing nothing, so a caller can never believe a Live Activity is on screen when it is not.
 *
 *  - `IosLiveStatus`  → **real** (L2.2n): `modules/lucid-live-activity` (ActivityKit) plus the
 *    widget extension in `targets/live-activity`. Also mirrors the same numbers onto the watch
 *    face, see the class comment.
 *  - `IosHealthImport` → **real** (L2.2n): `modules/lucid-health` (read-only HealthKit).
 *  - `IosSpeechToText` → `expo-speech-recognition` (DESIGN §8.2), scheduled for L1.6.
 *  - `IosNotificationsPermission` → `expo-notifications`, scheduled for L1.7/L3.1 (the
 *    usage string is already in `app.config.ts`; WO L1.3 only needs the ask to happen
 *    once at onboarding, not the scheduling API).
 */

import * as Battery from 'expo-battery';
import * as Brightness from 'expo-brightness';
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { systemClock, type BatterySample, type Clock, type DeviceKind } from '@lucid/engine';

import LucidHealth from '../../../modules/lucid-health';
import LucidLiveActivity from '../../../modules/lucid-live-activity';
import type {
  BatteryReader,
  DeviceInfoReader,
  Display,
  HealthImport,
  LiveStatus,
  LiveStatusContent,
  NotificationsPermission,
  SleepPhase,
  SpeechResult,
  SpeechToText,
  Unsubscribe,
} from '../types';
import { watchBridge } from './watchBridge';

const NOT_WIRED = (what: string, wo: string): Error =>
  new Error(`${what} has no native implementation yet (scheduled for ${wo})`);

// ---------------------------------------------------------------------------

/**
 * The night's status everywhere outside the app (DESIGN §3.4 "นอกแอป"): the lock-screen Live
 * Activity **and** the watch face.
 *
 * Both surfaces show the same three facts (theme · status · whispers n/8) and neither computes
 * anything, so they are updated from one place rather than from two callers that could drift
 * apart — `LiveStatusContent` already carries exactly what each of them needs. The watch mirror
 * is best-effort and never affects this class's result: a watch-face number is not worth failing
 * a night over, while the Live Activity is the thing the user is promised on the plan card.
 *
 * `pRem` is deliberately **not** sent to the lock screen (mockup `05-night.png` frame b does not
 * show a percentage there — a number on the lock screen invites reading it at 03:00), but it *is*
 * sent to the watch, where screen A shows "น่าจะฝัน 72%" (DESIGN §10).
 */
export class IosLiveStatus implements LiveStatus {
  private readonly stopListeners = new Set<() => void>();
  private linkSubscription: { remove(): void } | null = null;

  isSupported(): boolean {
    // Two different falses: no native module in this build, or the user switched Live Activities
    // off in Settings. Both mean "do not pretend there is a card".
    return LucidLiveActivity !== null && LucidLiveActivity.isSupported();
  }

  async start(content: LiveStatusContent): Promise<void> {
    if (!LucidLiveActivity) throw NOT_WIRED('Live Activity', 'a build that includes modules/lucid-live-activity');
    await LucidLiveActivity.start(
      themeLine(content),
      content.headline,
      content.cuesPlayed,
      content.cuesPlanned,
    );
    void this.mirrorToWatch(content);
  }

  async update(content: LiveStatusContent): Promise<void> {
    if (!LucidLiveActivity) throw NOT_WIRED('Live Activity', 'a build that includes modules/lucid-live-activity');
    await LucidLiveActivity.update(content.headline, content.cuesPlayed, content.cuesPlanned);
    void this.mirrorToWatch(content);
  }

  async stop(): Promise<void> {
    // Stopping something that was never started must be harmless — including when the native
    // module is missing entirely.
    this.linkSubscription?.remove();
    this.linkSubscription = null;
    this.stopListeners.clear();
    if (!LucidLiveActivity) return;
    await LucidLiveActivity.end().catch(() => undefined);
  }

  /**
   * The Live Activity's stop button is a deep link back into the app (a widget cannot reach the
   * `NightController` living in the JS runtime any other way — see the comment in
   * `targets/live-activity/DreamingLiveActivity.swift`). This turns that URL back into a plain
   * callback.
   *
   * `getInitialURL()` is checked as well as the event: if the phone was locked and the app was not
   * running, the tap *launches* the app and the URL arrives as the initial one, not as an event.
   */
  onStopRequested(listener: () => void): Unsubscribe {
    this.stopListeners.add(listener);

    if (this.linkSubscription === null) {
      this.linkSubscription = Linking.addEventListener('url', ({ url }) => {
        if (isStopLink(url)) this.fireStop();
      });
      void Linking.getInitialURL()
        .then((url) => {
          if (url !== null && isStopLink(url)) this.fireStop();
        })
        .catch(() => undefined);
    }

    return () => {
      this.stopListeners.delete(listener);
      if (this.stopListeners.size === 0) {
        this.linkSubscription?.remove();
        this.linkSubscription = null;
      }
    };
  }

  private fireStop(): void {
    for (const listener of [...this.stopListeners]) listener();
  }

  private async mirrorToWatch(content: LiveStatusContent): Promise<void> {
    await watchBridge.sendStatus({
      pRem: content.pRem,
      cuesPlayed: content.cuesPlayed,
      cuesPlanned: content.cuesPlanned,
    });
  }
}

/** "🐋 ดำน้ำกับฉลามวาฬ" — line 1 of the lock-screen card (mockup `05-night.png` frame b). */
function themeLine(content: LiveStatusContent): string {
  const title = content.title.trim();
  return title.length > 0 ? `${content.emoji} ${title}` : content.emoji;
}

/**
 * Which incoming URLs mean "stop the night".
 *
 * `dreaming://night?stop=1` is what the Live Activity actually sends: `apps/mobile/app/` has no
 * `stop` route, and expo-router answers an unmatched path with its "Unmatched Route" screen — the
 * stop button would cover the night with an error page instead of ending it. `dreaming://stop` is
 * accepted too, so a later work order can add that route without touching the widget.
 */
function isStopLink(url: string): boolean {
  const parsed = Linking.parse(url);
  if (parsed.path === 'stop' || parsed.hostname === 'stop') return true;
  const flag = parsed.queryParams?.stop;
  return flag === '1' || flag === 'true';
}

// ---------------------------------------------------------------------------

/**
 * HealthKit's own `sleepAnalysis` category, read the morning after (WO L2.9's JS side, native
 * half wired in L2.2n: `modules/lucid-health`). No third-party Expo HealthKit dependency was
 * added — the bridge is ~150 lines of Swift for two queries, and every maintained wrapper brings
 * the whole HealthKit surface plus its own permission model (APP-RUN §0.5 S9).
 *
 * The mapping the Swift side produces, kept here as well so `SleepPhase.stage` and
 * `HKCategoryValueSleepAnalysis` never drift apart:
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
    if (!LucidHealth) return false; // web bundle, or a build older than L2.2n
    return LucidHealth.isAvailable();
  }

  /**
   * 🔴 `true` here means "the user has now been asked about sleep and heart rate", **not** "we have
   * read access": HealthKit deliberately never tells an app that a read was denied — a denied query
   * returns an empty result, exactly like having no data (Apple's own privacy design; the native
   * file spells this out). That is why `src/health/appleSleep.ts` treats an empty
   * `fetchSleepPhases()` identically to a refusal ("no Apple data yet", never "0%" — APP-RUN §0.5
   * S10), and why this is still an honest answer rather than a claim we cannot back.
   */
  async requestAuthorization(): Promise<boolean> {
    if (!LucidHealth) return false;
    try {
      return await LucidHealth.requestAuthorization();
    } catch {
      return false;
    }
  }

  async fetchSleepPhases(range: { fromIso: string; toIso: string }): Promise<SleepPhase[]> {
    if (!LucidHealth) throw NOT_WIRED('HealthKit sleep import', 'a build that includes modules/lucid-health');
    // The native side already returns exactly the `SleepPhase` shape (including `IN_BED` with the
    // underscore) and drops `asleepUnspecified` rather than guessing a stage for it, so there is
    // nothing to map here — one mapping, in one place.
    return LucidHealth.readSleepStages(range.fromIso, range.toIso);
  }

  async fetchHeartRateSamples(range: {
    fromIso: string;
    toIso: string;
  }): Promise<{ atIso: string; bpm: number }[]> {
    if (!LucidHealth) throw NOT_WIRED('HealthKit heart rate import', 'a build that includes modules/lucid-health');
    return LucidHealth.readHeartRate(range.fromIso, range.toIso);
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

/**
 * `LucidHealth` — typed surface of the read-only HealthKit bridge
 * (native half: `ios/LucidHealthModule.swift`).
 *
 * Resolved optionally: on the web QC bundle, on Android and in any build made before this work
 * order the module is simply absent and `IosHealthImport.isAvailable()` answers `false`.
 *
 * Nothing here is used while a night runs — Apple's stages only exist hours later. It is the
 * *reference answer* the morning report compares our own estimate against (DESIGN §5 · WO L2.9).
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * One contiguous Apple sleep stage. `stage` mirrors `SleepStage` in
 * `apps/mobile/src/platform/types.ts` exactly, including `IN_BED` with the underscore — the
 * Swift mapping produces these five strings and nothing else (`asleepUnspecified` is dropped
 * rather than guessed at; see the native file).
 */
export interface NativeSleepPhase {
  /** ISO-8601, UTC, with milliseconds. */
  start: string;
  end: string;
  stage: 'REM' | 'CORE' | 'DEEP' | 'AWAKE' | 'IN_BED';
}

export interface NativeHeartRateSample {
  atIso: string;
  bpm: number;
}

export interface LucidHealthNativeModule {
  /** `false` where HealthKit does not exist at all (iPad, simulator without Health). */
  isAvailable(): boolean;
  /**
   * Shows the system sheet the first time. `true` means "the user has now been asked about every
   * type we need" — **not** "read access was granted": HealthKit deliberately never tells an app
   * that a read was denied (a denied query returns an empty result). Callers must treat an empty
   * `readSleepStages` exactly like a refusal.
   */
  requestAuthorization(): Promise<boolean>;
  /** Oldest first. An empty array is a normal answer ("Apple has nothing for that night"). */
  readSleepStages(startIso: string, endIso: string): Promise<NativeSleepPhase[]>;
  readHeartRate(startIso: string, endIso: string): Promise<NativeHeartRateSample[]>;
}

const LucidHealth = requireOptionalNativeModule<LucidHealthNativeModule>('LucidHealth');

export default LucidHealth;

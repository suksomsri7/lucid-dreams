/**
 * Settings — one page, one store (WO L3.6 · mockup `09-settings.png` · DESIGN §5.3/§5.5).
 * Same `AsyncStorage` + `useSyncExternalStore` shape as `src/store/onboarding.ts` /
 * `src/store/night.ts` — read either of those first if this file is confusing.
 *
 * `consentAi` and the language switch already live elsewhere (`src/store/onboarding.ts`'s
 * `consentAi` · `src/i18n`'s `setLocale`) and are *not* duplicated here — `settings.tsx`
 * reads both stores side by side, same as every other screen that needs onboarding state.
 *
 * Every clamp below is the **UI floor**, mirroring but never replacing the engine's own
 * hard rails (`@lucid/engine`'s `GUARD_MIN_HOURS`/`VOLUME_MIN`/`VOLUME_MAX`/
 * `MAX_CUES_PER_NIGHT`, `resolveNightParams` in `nightController.ts` — APP-RUN §0.5 S6):
 * a corrupt AsyncStorage row here degrades to a *quiet* default, and the engine clamps
 * again on top regardless of what this store ever wrote.
 */

import { useSyncExternalStore } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { GUARD_MIN_HOURS, MAX_CUES_PER_NIGHT, VOLUME_MAX, VOLUME_MIN } from '@lucid/engine';

const STORAGE_KEY = 'lucid.settings.v1';

/** DESIGN §5.3 "เงียบ 3 ชม.แรก" row — 2–4 h, UI floor `Math.max(2, …)` (mockup 09, WO L3.6 spec). */
export const MIN_GUARD_HOURS = GUARD_MIN_HOURS;
export const MAX_GUARD_HOURS = 4;
export const DEFAULT_GUARD_HOURS = 3;

/** "กระซิบสูงสุด 8 ครั้ง/คืน" — floor kept well above zero so a corrupt value cannot silence the whole night, ceiling is the engine's own hard cap. */
export const MIN_CUES_PER_NIGHT = 4;
export const MAX_CUES_PER_NIGHT_SETTING = MAX_CUES_PER_NIGHT;
export const DEFAULT_MAX_CUES_PER_NIGHT = MAX_CUES_PER_NIGHT;

/** "เตือนมองมือกลางวัน 3 ครั้ง" (DESIGN §3.4 / mockup 10's "reality check … 3 ครั้ง/วัน"). */
export const MIN_REALITY_CHECKS_PER_DAY = 1;
export const MAX_REALITY_CHECKS_PER_DAY = 5;
export const DEFAULT_REALITY_CHECKS_PER_DAY = 3;

/** "ระดับเสียงเริ่มต้น" slider rails — the same 8–35 % the engine will clamp to regardless. */
export const MIN_VOLUME_START = VOLUME_MIN;
export const MAX_VOLUME_START = VOLUME_MAX;
export const DEFAULT_VOLUME_START = 0.15;

export interface SettingsState {
  /** Sleep Guard length, hours (DESIGN §5.3). */
  guardHours: number;
  /** Whisper cap for the whole night. */
  maxCuesPerNight: number;
  /** Sleep Guard: two cue-caused wake-ups stop the night's whispers for good (§5.3). */
  stopAfterTwoWakes: boolean;
  /** "คืนควบคุม 1 ใน 4" — on/off; the ratio itself is `controlNight.ts#CONTROL_NIGHT_RATIO`, fixed. */
  controlNightsEnabled: boolean;
  /** Daytime reality-check notifications per day (DESIGN §3.4). */
  realityChecksPerDay: number;
  /** Boost night / WBTB — off by default (§0.5 S6: a stronger technique, never assumed). */
  boostNight: boolean;
  /** First night's / manual override starting volume, 0..1 — "ค่าเริ่มต้นเท่านั้น" after night 1. */
  volumeStart: number;
  /** "ปรับให้เองทุกคืน" — always on in normal mode (mockup 09: "เปิด · ปิดไม่ได้ในโหมดปกติ"); kept as a field for forward-compat, `settings.tsx` renders it as a disabled switch. */
  autoAdjust: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
  guardHours: DEFAULT_GUARD_HOURS,
  maxCuesPerNight: DEFAULT_MAX_CUES_PER_NIGHT,
  stopAfterTwoWakes: true,
  controlNightsEnabled: true,
  realityChecksPerDay: DEFAULT_REALITY_CHECKS_PER_DAY,
  boostNight: false,
  volumeStart: DEFAULT_VOLUME_START,
  autoAdjust: true,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitize(partial: Partial<SettingsState>): SettingsState {
  return {
    guardHours: clamp(partial.guardHours ?? DEFAULT_SETTINGS.guardHours, MIN_GUARD_HOURS, MAX_GUARD_HOURS),
    maxCuesPerNight: Math.round(
      clamp(partial.maxCuesPerNight ?? DEFAULT_SETTINGS.maxCuesPerNight, MIN_CUES_PER_NIGHT, MAX_CUES_PER_NIGHT_SETTING),
    ),
    stopAfterTwoWakes: partial.stopAfterTwoWakes ?? DEFAULT_SETTINGS.stopAfterTwoWakes,
    controlNightsEnabled: partial.controlNightsEnabled ?? DEFAULT_SETTINGS.controlNightsEnabled,
    realityChecksPerDay: Math.round(
      clamp(partial.realityChecksPerDay ?? DEFAULT_SETTINGS.realityChecksPerDay, MIN_REALITY_CHECKS_PER_DAY, MAX_REALITY_CHECKS_PER_DAY),
    ),
    boostNight: partial.boostNight ?? DEFAULT_SETTINGS.boostNight,
    volumeStart: clamp(partial.volumeStart ?? DEFAULT_SETTINGS.volumeStart, MIN_VOLUME_START, MAX_VOLUME_START),
    // Always true in Phase 1 (no "manual mode" exists yet) — a stored `false` from a
    // future build must not silently disable the engine's own volume ramp today.
    autoAdjust: true,
  };
}

let state: SettingsState = DEFAULT_SETTINGS;
let hydrated = false;
let hydratingPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
}

async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) state = sanitize({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SettingsState>) });
  } catch {
    // Corrupt or missing storage — keep the (sleep-first) defaults, do not throw.
  } finally {
    hydrated = true;
    emit();
  }
}

hydratingPromise = hydrate();

export function getSettings(): SettingsState {
  return state;
}

export function isSettingsHydrated(): boolean {
  return hydrated;
}

/** Awaited by non-React code (`src/data/night.ts`, `src/learning/`) that needs the real, persisted value before deciding tonight's mode/volume — never guesses ahead of `AsyncStorage`. */
export async function ensureSettingsHydrated(): Promise<SettingsState> {
  if (!hydrated) await (hydratingPromise ??= hydrate());
  return state;
}

function update(partial: Partial<SettingsState>): void {
  state = sanitize({ ...state, ...partial });
  emit();
  persist();
}

export function setGuardHours(hours: number): void {
  update({ guardHours: hours });
}
export function setMaxCuesPerNight(count: number): void {
  update({ maxCuesPerNight: count });
}
export function setStopAfterTwoWakes(value: boolean): void {
  update({ stopAfterTwoWakes: value });
}
export function setControlNightsEnabled(value: boolean): void {
  update({ controlNightsEnabled: value });
}
export function setRealityChecksPerDay(count: number): void {
  update({ realityChecksPerDay: count });
}
export function setBoostNight(value: boolean): void {
  update({ boostNight: value });
}
export function setVolumeStart(volume: number): void {
  update({ volumeStart: volume });
}

/** Re-renders whenever any setting or the hydration flag changes. */
export function useSettings(): SettingsState & { hydrated: boolean } {
  const snapshot = useSyncExternalStore(subscribe, getSettings, getSettings);
  const hydratedFlag = useSyncExternalStore(subscribe, isSettingsHydrated, isSettingsHydrated);
  return { ...snapshot, hydrated: hydratedFlag };
}

/** Test/QC seam — mirrors `store/onboarding.ts`'s `__resetOnboardingStateForTests`. Never called in app code. */
export function __resetSettingsForTests(): void {
  state = DEFAULT_SETTINGS;
  hydrated = true;
  emit();
}

/** Real reset path — Settings › ลบทั้งหมด (WO L3.6). See `store/onboarding.ts#resetOnboardingAfterDeleteAll`'s doc comment; same shape, same reason no persist call is needed here. */
export function resetSettingsAfterDeleteAll(): void {
  state = DEFAULT_SETTINGS;
  hydrated = true;
  emit();
}

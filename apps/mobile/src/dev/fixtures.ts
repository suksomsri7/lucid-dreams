/**
 * Web-only QC fixture switch (Fable parity review round, WO L1.3): lets the "found"
 * happy-path state from mockup `01-onboarding.png` actually be screenshotted, since
 * Phase 1 has no real device pairing yet (Watch link is L2.2, BLE is L2.3) — without
 * this, every render honestly shows the empty state instead (see
 * `ledger/wo-notes/L1.3.md` parity table).
 *
 * Guarded so it can never reach a real device: `__DEV__` covers native dev builds,
 * `Platform.OS === 'web'` covers the QC export (which is a release bundle as far as
 * `__DEV__` is concerned, since `expo export` always builds for production) — a
 * **native release build is neither**, so every function below is a no-op there and the
 * whole module does nothing at runtime.
 *
 * Usage (URL query string, read once per page load):
 * - `?fixture=devices` — populate `DeviceRegistry` with a connected Apple Watch Series 9
 *   (84% battery) and Sleep A20 (92% battery), matching mockup 01(b) exactly.
 * - `?fixture=accepted` — pre-tick the welcome screen's consent checkbox (mockup 01(a)).
 * - `?fixture=ear-passed` — WO L1.7ui: same device set as `devices`, plus both ear
 *   tests already recorded as passed, for the `earTest.correct` / "both ears ready"
 *   states on `app/plan/ear-left.tsx` / `ear-right.tsx` (mockup `04-dream-plan.png` c/d).
 * - `?fixture=plan` (WO L1.7ui) — or implicitly, any of the three fixtures above: seeds
 *   `useNightState()`'s plan with the same whale-shark + sea-turtle plan
 *   `?fixture=advisor-plan` shows mid-conversation, so every `app/plan/*` screen can be
 *   screenshotted directly by URL without walking through the advisor chat first.
 * - `?fixture=night` (WO L2.8) — `app/night.tsx` drives its controller from
 *   `simulateNight` instead of a watch (`src/night/session.ts#startNightFixture`); no
 *   store fixture needed here, that function builds its own plan.
 * - `?fixture=report` (WO L2.10) — `app/report/[id].tsx` renders `src/report/fixture.ts`'s
 *   canned `NightReport` instead of reading the (web-less) database.
 * - `?fixture=ble` (WO L2.3) — `app/plan/find-devices.tsx` lists two canned BLE heart-rate
 *   devices instead of scanning (the web bundle has no radio, and the owner has not bought a
 *   strap yet — DESIGN §8.1 note of 24 Sep), and `app/plan/devices.tsx` shows the same strap
 *   already connected in the 💓 category with a live heart rate.
 */

import { Platform } from 'react-native';

import type { DreamPlan } from '../advisor/types';
import { getSensorPrefs, rememberBleDevice, setPhoneOnMattress } from '../devices/prefs';
import {
  BLE_DEVICE_ID,
  HEADPHONES_DEVICE_ID,
  MATTRESS_DEVICE_ID,
  WATCH_DEVICE_ID,
  deviceRegistry,
  setLiveHeartRate,
} from '../devices/registry';
import { getLocale, translate, type Locale } from '../i18n';
import { getNightState, saveTonightPlan } from '../store/night';
import { completeOnboarding } from '../store/onboarding';

const FIXTURES_ENABLED = __DEV__ || Platform.OS === 'web';

function readFixtureParam(): string | null {
  if (!FIXTURES_ENABLED) return null;
  // `window`/`location` only exist on web; a native dev build has nothing to read a
  // query string from, so it simply never has a fixture requested.
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) return null;
  return new URLSearchParams(window.location.search).get('fixture');
}

/**
 * Call once from the devices screen's mount effect, right after
 * `refreshDevicesFromPlatform()` — this overwrites the same registry entry ids
 * (`WATCH_DEVICE_ID`/`HEADPHONES_DEVICE_ID`), so the fixture cleanly replaces whatever
 * the real (empty, on web) platform read reported, rather than adding a second, hidden
 * entry alongside it.
 */
/** `?fixture=devices`, `?fixture=ear-passed` or `?fixture=ble` — all three want the same found-device set. */
export function devicesFixtureRequested(): boolean {
  const value = readFixtureParam();
  return value === 'devices' || value === 'ear-passed' || value === 'ble';
}

/** `?fixture=ble` (WO L2.3) — see the file header. */
export function bleFixtureRequested(): boolean {
  return readFixtureParam() === 'ble';
}

/**
 * The canned scan result `app/plan/find-devices.tsx` shows on the web QC build. Generic,
 * real-world model names on purpose: the owner owns neither device, so these stand for "whatever
 * standard BLE Heart Rate Profile strap you bought" — the page treats them exactly as it would
 * treat a real advertiser (guessed kind from the name, signal strength, tap to bond).
 */
export function fixtureBleScanResults(): { id: string; name: string; rssi: number; services: string[] }[] {
  return [
    { id: 'fixture-polar-h10', name: 'Polar H10 A1B2C3', rssi: -54, services: ['180d', '180f'] },
    { id: 'fixture-garmin-hrm', name: 'Garmin HRM-Pro', rssi: -73, services: ['180d'] },
  ];
}

/** The tap on the first row, replayed without a radio (`select()` throws on the web stub). */
export function applyBleSelectFixture(device: { id: string; name: string | null }): boolean {
  if (!bleFixtureRequested()) return false;
  rememberBleDevice(device);
  return true;
}

export function earPassedFixtureRequested(): boolean {
  return readFixtureParam() === 'ear-passed';
}

/**
 * `platform.battery`/`platform/dnd.ts` have no real reading on web (the QC bundle gets
 * the same stub `AndroidBatteryReader` Android does — always `null`, see
 * `platform/android/index.ts`), so `app/plan/devices.tsx` cannot show "iPhone is
 * charging, 78%" or pass the phone/DND half of `evaluateReadiness` there without this — matches
 * mockup 04(b)'s phone card exactly (78%, charging, DND already allowing the app).
 */
export function fixturePhoneStatus(): { charging: boolean; battery: number } | null {
  return devicesFixtureRequested() ? { charging: true, battery: 0.78 } : null;
}

export function applyDeviceFoundFixture(): void {
  if (!devicesFixtureRequested()) return;
  const now = new Date().toISOString();

  // `?fixture=ble` only: the strap the user just tapped on `find-devices`, plus the phone on the
  // mattress, both live. Written after `refreshDevicesFromPlatform()` (the devices screen calls
  // the two in that order on every tick), so these replace the empty web readings rather than
  // sitting beside them — same trick, and the same ids, as the watch/headphones rows below.
  if (bleFixtureRequested()) {
    // Guarded: this runs on the devices screen's 3 s tick, and flipping the preference every
    // tick would re-persist and re-render for nothing.
    if (!getSensorPrefs().phoneOnMattress) setPhoneOnMattress(true);
    deviceRegistry.add({
      id: BLE_DEVICE_ID,
      category: 'HEART',
      name: 'Polar H10 A1B2C3',
      connected: true,
      battery: 0.86,
      lastDataAt: now,
    });
    setLiveHeartRate(BLE_DEVICE_ID, 62);
    deviceRegistry.add({
      id: MATTRESS_DEVICE_ID,
      category: 'HEART',
      name: translate(getLocale(), 'devices.mattress.name'),
      connected: true,
      battery: 0.78,
      lastDataAt: now,
    });
  }
  deviceRegistry.add({
    id: WATCH_DEVICE_ID,
    category: 'HEART',
    name: 'Apple Watch Series 9',
    connected: true,
    battery: 0.84,
    lastDataAt: now,
  });
  deviceRegistry.add({
    id: HEADPHONES_DEVICE_ID,
    category: 'AUDIO',
    name: 'Sleep A20',
    connected: true,
    battery: 0.92,
    lastDataAt: now,
  });
}

/** Read once for the welcome screen's initial checkbox state. */
export function isAcceptedFixtureRequested(): boolean {
  return readFixtureParam() === 'accepted';
}

/**
 * WO L1.4 — the two advisor-room QC fixtures (`ledger/design-app/02-advisor-start.png` /
 * `03-advisor-chat.png`): `advisor-start` is just the room's natural empty state (no
 * special handling needed, included for symmetry/documentation), `advisor-plan` seeds
 * `createMockAdvisorAdapter` straight to the finished mockup-03 conversation so the
 * parity screenshot doesn't depend on scripting taps through the flow first.
 */
export type AdvisorFixture = 'advisor-start' | 'advisor-plan';

export function advisorFixtureRequested(): AdvisorFixture | null {
  const value = readFixtureParam();
  return value === 'advisor-start' || value === 'advisor-plan' ? value : null;
}

/**
 * These fixtures screenshot a screen that lives *past* onboarding (the advisor room,
 * `app/plan/*` — WO L1.7ui), which `app/_layout.tsx`'s onboarding gate would otherwise
 * redirect away from on a fresh, un-onboarded web QC session (`hasOnboarded` starts
 * `false`, `src/store/onboarding.ts`). Called once from `RootLayout` — safe to call
 * every render, `completeOnboarding()` is already a no-op once `hasOnboarded` is `true`.
 * Deliberately **not** applied for the `devices`/`accepted` fixtures — those two
 * screenshot the onboarding screens themselves and must NOT skip past them this way.
 */
export function applyOnboardingBypassForAdvisorFixture(): void {
  const value = readFixtureParam();
  // `night`/`report` (WO L2.8/L2.10) land past onboarding too — `/night?fixture=night`
  // and `/report/demo?fixture=report` must be screenshottable directly by URL, same as
  // the four fixtures above already are. `morning-record`/`morning-result` (WO L3.1) are
  // the tab-1 shell (`app/(tabs)/index.tsx`), same as `advisor-start`/`advisor-plan`.
  const bypasses =
    value === 'advisor-start' ||
    value === 'advisor-plan' ||
    value === 'plan' ||
    value === 'ear-passed' ||
    value === 'night' ||
    value === 'ble' ||
    value === 'report' ||
    value === 'morning-record' ||
    value === 'morning-result';
  if (!bypasses) return;
  completeOnboarding();
}

export function planFixtureRequested(): boolean {
  const value = readFixtureParam();
  return value === 'plan' || value === 'ear-passed' || value === 'ble';
}

/** `?fixture=night` (WO L2.8) — see the file header. */
export function nightFixtureRequested(): boolean {
  return readFixtureParam() === 'night';
}

/** `?fixture=report` (WO L2.10) — see the file header. */
export function reportFixtureRequested(): boolean {
  return readFixtureParam() === 'report';
}

/**
 * Seeds `useNightState()`'s plan with the same whale-shark + sea-turtle plan
 * `?fixture=advisor-plan` shows mid-conversation (`adapter.ts`'s mock `buildThemePlan`,
 * duplicated here rather than imported — that function is private to the mock adapter
 * and this is a dev-only fixture, not a second source of truth for the real plan shape)
 * — WO L1.7ui, so `app/plan/*` can be screenshotted directly by URL. No-ops once a real
 * plan already exists (e.g. the user actually walked the advisor room first).
 */
/** The one whale-shark plan every fixture in this file that needs a `DreamPlan` builds — factored out once `?fixture=morning-*` (WO L3.1) became the second user of it. */
function buildFixtureWhalePlan(lang: Locale): DreamPlan {
  return {
    theme: {
      emoji: '🐋',
      titleTh: translate('th', 'advisor.theme.whale'),
      titleEn: translate('en', 'advisor.theme.whale'),
      place: translate(lang, 'advisor.theme.whale.place'),
    },
    seedLines: [translate(lang, 'advisor.theme.whale.seed1'), translate(lang, 'advisor.clarify.turtle.detail')],
    anchorPhrase: translate(lang, 'advisor.anchorPhrase'),
    ambienceKey: 'underwater',
    clarify: null,
  };
}

export function applyPlanFixture(lang: Locale): void {
  if (!planFixtureRequested()) return;
  if (getNightState().plan !== null) return;
  saveTonightPlan(buildFixtureWhalePlan(lang), lang);
}

// ---------------------------------------------------------------------------
// WO L3.1 — the morning flow's own two QC fixtures (mockup `06-morning.png`)
// ---------------------------------------------------------------------------

export type MorningFixture = 'morning-record' | 'morning-result';

/**
 * `?fixture=morning-record` — frame a: greeted, mic listening, a live partial transcript
 * bubble on screen. `?fixture=morning-result` — frame b: transcript already given, all
 * questions answered (8/7/YES/7 — `dreamed`/`themeMatch`/`lucid`/`sleepQuality`, the exact
 * numbers mockup 06 frame b shows), result bubble shown. Both drive `useMorning.ts`
 * straight to the target state instead of walking the mic/composer/chip taps a real
 * screenshot script would otherwise have to script — same convention as `?fixture=night`
 * driving `startNightFixture` instead of a real watch.
 */
export function morningFixtureRequested(): MorningFixture | null {
  const value = readFixtureParam();
  return value === 'morning-record' || value === 'morning-result' ? value : null;
}

/** `useMorning.ts`'s own fixture plan — same whale-shark theme, so the greet line's "🐋" and the result's theme-match question both read naturally. */
export function morningFixturePlan(lang: Locale): DreamPlan {
  return buildFixtureWhalePlan(lang);
}

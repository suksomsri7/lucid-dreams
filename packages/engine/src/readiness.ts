/**
 * `readiness.ts` — the device check, step 1/3 before a night (DESIGN-APP §3.2 · APP-RUN L1.7).
 *
 * The user may bring **any** hardware: the app scans, reports what it found in three
 * categories and decides whether the night can start. Nothing here knows about
 * Bluetooth or HealthKit — it takes a snapshot of what the platform layer found and
 * returns a verdict plus a reason **code** (the UI owns the wording; Thai strings
 * live in `apps/mobile/src/i18n`, fitness rule B).
 *
 * The three categories (DESIGN §3.2):
 *   💓 `HEART` — pulse/motion (Apple Watch, chest strap, phone on the mattress). Required.
 *      A watch that is connected but silent is worse than no watch: the REM estimator
 *      would run on nothing and still fire cues, so "connected" is not enough —
 *      we demand a sample within {@link HEART_DATA_MAX_AGE_SEC} seconds.
 *   🎧 `AUDIO` — headphones/speaker. Required, **and** its battery must last until the
 *      alarm: buds that die at 03:00 turn the whole night into a control night
 *      without telling anyone.
 *   👁 `EYE`  — EOG/Dream Mask. Optional, always "ok", listed so the screen can say
 *      "no device · not required" instead of hiding a future category.
 *
 * Plus two phone-level gates: the iPhone must survive the night (charging or ≥ 50%),
 * and Do-Not-Disturb must actually let the app play audio — a silenced night looks
 * identical to a broken engine in the morning report.
 *
 * `DeviceCategory`/`DeviceEntry` are defined here because `src/devices.ts` does not
 * exist in this worktree; if a parallel work order adds it, these two types move
 * there and this file re-exports them (noted as a debt in `ledger/wo-notes/L1.6e.md`).
 */

// ---------------------------------------------------------------------------
// Device registry
// ---------------------------------------------------------------------------

export type DeviceCategory = 'HEART' | 'AUDIO' | 'EYE';

/** All categories in screen order (DESIGN §3.2 — pulse, sound, eyes). */
export const DEVICE_CATEGORIES: readonly DeviceCategory[] = ['HEART', 'AUDIO', 'EYE'];

/** One thing the app found. `battery`/`lastDataAt` are `null` when the device cannot report them. */
export interface DeviceEntry {
  id: string;
  category: DeviceCategory;
  name: string;
  connected: boolean;
  /** 0..1, or `null` when unknown (a wired speaker has no battery). */
  battery: number | null;
  /** ISO timestamp of the last sample received, or `null` if it never sent one. */
  lastDataAt: string | null;
  /** Set by the UI when the user pinned this device as the one to use. Informational. */
  required?: boolean;
}

/** Machine-readable blockers. The UI maps these to sentences; never show them raw. */
export type ReadinessReason =
  | 'HEART_NONE'
  | 'HEART_STALE'
  | 'AUDIO_NONE'
  | 'AUDIO_BATTERY'
  | 'PHONE_BATTERY'
  | 'DND_BLOCKS'
  | 'EAR_L'
  | 'EAR_R';

export interface ReadinessCategoryReport {
  ok: boolean;
  /** Everything found in this category, connected or not — the screen lists them all. */
  found: DeviceEntry[];
  reason: ReadinessReason | null;
  /** `true` only for `EYE`: a missing optional category never blocks the night. */
  optional: boolean;
}

export interface ReadinessCheck {
  ok: boolean;
  reason: ReadinessReason | null;
}

export type ReadinessNextStep = 'FIX_DEVICES' | 'EAR_TEST_L' | 'EAR_TEST_R' | 'START';

export interface ReadinessReport {
  ok: boolean;
  categories: Record<DeviceCategory, ReadinessCategoryReport>;
  phone: ReadinessCheck;
  dnd: ReadinessCheck;
  earTest: ReadinessCheck;
  /** The one thing to fix first, in the order the user should fix them. */
  firstBlocker: ReadinessReason | null;
  nextStep: ReadinessNextStep;
  /** Hours from `nowIso` to `wakeAtIso` — shown next to the battery numbers. */
  hoursToWake: number;
}

/** Shape of a passed ear test (the row `memorization.ts` produces). */
export interface ReadinessEarTests {
  L?: { side: string; rounds: number; answer: number; attempts: number; volume: number } | null;
  R?: { side: string; rounds: number; answer: number; attempts: number; volume: number } | null;
}

export interface ReadinessInput {
  devices: DeviceEntry[];
  phone: { charging: boolean; battery: number };
  dndAllowsAppAudio: boolean;
  nowIso: string;
  wakeAtIso: string;
  earTests: ReadinessEarTests;
}

// ---------------------------------------------------------------------------
// Thresholds (DESIGN §3.2 · APP-RUN L1.7)
// ---------------------------------------------------------------------------

/** A pulse device must have delivered a sample this recently to count as alive. */
export const HEART_DATA_MAX_AGE_SEC = 10;
/**
 * Battery model for headphones: 100% ≈ 12 h of quiet playback. Deliberately a single
 * number, not a per-model table — the check only has to answer "will these last until
 * the alarm?", and R1 on real hardware will correct the constant if it is optimistic.
 */
export const AUDIO_HOURS_PER_FULL_CHARGE = 12;
/** The phone must be charging or above this, or it dies before the morning recall. */
export const PHONE_MIN_BATTERY = 0.5;
/** Fallback hours-to-wake when a timestamp is unreadable: assume the worst (a long night). */
const HOURS_TO_WAKE_FALLBACK = 12;

function parseIso(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.length === 0) return Number.NaN;
  return Date.parse(value);
}

function heartIsFresh(device: DeviceEntry, nowMs: number): boolean {
  const t = parseIso(device.lastDataAt);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false;
  // `abs` on purpose: a watch whose clock runs a few seconds ahead is alive, not stale.
  return Math.abs(nowMs - t) <= HEART_DATA_MAX_AGE_SEC * 1000;
}

function audioLastsUntilWake(device: DeviceEntry, hoursToWake: number): boolean {
  // Unknown battery = assume ok. Blocking a wired speaker because it cannot report a
  // percentage would make the screen unpassable for half the plausible setups.
  if (device.battery === null || device.battery === undefined || !Number.isFinite(device.battery)) return true;
  return device.battery * AUDIO_HOURS_PER_FULL_CHARGE >= hoursToWake;
}

/**
 * Decide whether tonight can start.
 *
 * Blocker order — `HEART → AUDIO → PHONE → DND → EAR` — is the order of the screens:
 * there is no point sending someone to the ear test if the watch is not even talking
 * (oracle R9). `ok` is true only when nothing at all blocks, so the "เริ่มคืนนี้"
 * button has exactly one source of truth.
 */
export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const devices = Array.isArray(input.devices) ? input.devices : [];
  const nowMs = parseIso(input.nowIso);
  const wakeMs = parseIso(input.wakeAtIso);
  const hoursToWake =
    Number.isFinite(nowMs) && Number.isFinite(wakeMs)
      ? Math.max(0, (wakeMs - nowMs) / 3_600_000)
      : HOURS_TO_WAKE_FALLBACK;

  const inCategory = (category: DeviceCategory): DeviceEntry[] =>
    devices.filter((device) => device.category === category);

  // 💓 HEART — required, needs live data.
  const heartFound = inCategory('HEART');
  const heartConnected = heartFound.filter((device) => device.connected);
  let heart: ReadinessCategoryReport;
  if (heartConnected.length === 0) {
    heart = { ok: false, found: heartFound, reason: 'HEART_NONE', optional: false };
  } else if (!heartConnected.some((device) => heartIsFresh(device, nowMs))) {
    heart = { ok: false, found: heartFound, reason: 'HEART_STALE', optional: false };
  } else {
    heart = { ok: true, found: heartFound, reason: null, optional: false };
  }

  // 🎧 AUDIO — required, needs battery to last the night.
  const audioFound = inCategory('AUDIO');
  const audioConnected = audioFound.filter((device) => device.connected);
  let audio: ReadinessCategoryReport;
  if (audioConnected.length === 0) {
    audio = { ok: false, found: audioFound, reason: 'AUDIO_NONE', optional: false };
  } else if (!audioConnected.some((device) => audioLastsUntilWake(device, hoursToWake))) {
    audio = { ok: false, found: audioFound, reason: 'AUDIO_BATTERY', optional: false };
  } else {
    audio = { ok: true, found: audioFound, reason: null, optional: false };
  }

  // 👁 EYE — optional, listed only.
  const eye: ReadinessCategoryReport = {
    ok: true,
    found: inCategory('EYE'),
    reason: null,
    optional: true,
  };

  const phoneBattery = Number.isFinite(input.phone?.battery) ? input.phone.battery : 0;
  const phone: ReadinessCheck =
    input.phone?.charging === true || phoneBattery >= PHONE_MIN_BATTERY
      ? { ok: true, reason: null }
      : { ok: false, reason: 'PHONE_BATTERY' };

  const dnd: ReadinessCheck =
    input.dndAllowsAppAudio === true ? { ok: true, reason: null } : { ok: false, reason: 'DND_BLOCKS' };

  const earTests = input.earTests ?? {};
  const earTest: ReadinessCheck = !earTests.L
    ? { ok: false, reason: 'EAR_L' }
    : !earTests.R
      ? { ok: false, reason: 'EAR_R' }
      : { ok: true, reason: null };

  const ordered: (ReadinessReason | null)[] = [heart.reason, audio.reason, phone.reason, dnd.reason, earTest.reason];
  const firstBlocker = ordered.find((reason) => reason !== null) ?? null;

  const deviceBlocked = !heart.ok || !audio.ok || !phone.ok || !dnd.ok;
  const nextStep: ReadinessNextStep = deviceBlocked
    ? 'FIX_DEVICES'
    : earTest.reason === 'EAR_L'
      ? 'EAR_TEST_L'
      : earTest.reason === 'EAR_R'
        ? 'EAR_TEST_R'
        : 'START';

  return {
    ok: firstBlocker === null,
    categories: { HEART: heart, AUDIO: audio, EYE: eye },
    phone,
    dnd,
    earTest,
    firstBlocker,
    nextStep,
    hoursToWake: Math.round(hoursToWake * 100) / 100,
  };
}

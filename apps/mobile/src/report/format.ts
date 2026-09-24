/**
 * Turning one `NightReport` (`@lucid/data`) into what mockup `07-night-report.png`
 * draws (WO L2.10 · APP-RUN §2 "L2.10"). Every function here is pure — no `Date.now()`,
 * no i18n lookups by itself (callers pass `t`) — so `app/report/[id].tsx` and any future
 * L3.5 journal screen can share it.
 *
 * `Band`'s own contract (`src/ui/Band.tsx`) is fractions of the night, not clock times —
 * that component's header names this file's job explicitly: "the screen that renders
 * this (L2.10/L3.5) is responsible for turning real timestamps into fractions".
 */

import { epochSecondsFrom, formatLocal, type ApplePhaseRecord, type CueRecord, type NightReport, type WakeRecord } from '@lucid/data';
import { AWAKE_QUIET_SEC, type AmbienceKey } from '@lucid/engine';

import type { DreamPlan } from '../advisor/types';
import type { BandSegment, BandTick } from '../ui/Band';
import type { Locale, TranslationKey } from '../i18n';

export function intlLocale(locale: Locale): string {
  return locale === 'th' ? 'th-TH' : 'en-GB';
}

/** `HH:mm` in the device time zone (oracle R10.7 — `formatLocal`, never a hand-rolled `Date` read). */
export function fmtTime(iso: string, locale: Locale): string {
  return formatLocal(iso, { locale: intlLocale(locale) });
}

/** The night's own `params.plan` (`ensureNightSession`, `src/data/night.ts`) — `null` for anything malformed or missing (an import, an old schema, a fixture). */
export function planFromSessionParams(params: Record<string, unknown>): DreamPlan | null {
  const candidate = params.plan;
  if (candidate === null || typeof candidate !== 'object') return null;
  const plan = candidate as Partial<DreamPlan>;
  if (typeof plan.theme !== 'object' || plan.theme === null) return null;
  return plan as DreamPlan;
}

const AMBIENCE_KEY: Record<AmbienceKey, TranslationKey> = {
  underwater: 'report.ambience.underwater',
  wind: 'report.ambience.wind',
  rain: 'report.ambience.rain',
  silence: 'report.ambience.silence',
};

export function ambienceLabelKey(key: AmbienceKey): TranslationKey {
  return AMBIENCE_KEY[key];
}

// ---------------------------------------------------------------------------
// The band (mockup 07's "ทั้งคืน · 23:10 → 06:51" card)
// ---------------------------------------------------------------------------

export interface BandModel {
  segments: BandSegment[];
  ticks: BandTick[];
  /** `band2` — the thin Apple-REM line under the main band, same fraction system. */
  appleSegments: { startFraction: number; endFraction: number }[];
  rangeStartT: number;
  rangeEndT: number;
  guardHours: number | null;
  cueTimes: string[];
  wakeTimes: string[];
  /** Longest Apple REM stretch, for the legend's "ช่วงยาว {range}" — `null` with no Apple data. */
  longestAppleRange: { startIso: string; endIso: string } | null;
}

/** REM-likely runs (`p_REM ≥ threshold`) as start/end pairs — `repo.ts#buildEvents` only ever records the *rising edge*; the band needs the whole run. */
function remLikelyRuns(epochs: readonly { t: number; pRem: number | null }[], threshold = 0.5): { startT: number; endT: number }[] {
  const runs: { startT: number; endT: number }[] = [];
  let open: number | null = null;
  let lastT: number | null = null;
  for (const epoch of epochs) {
    const above = epoch.pRem !== null && epoch.pRem >= threshold;
    if (above && open === null) open = epoch.t;
    if (!above && open !== null) {
      runs.push({ startT: open, endT: (lastT ?? open) + 30 });
      open = null;
    }
    lastT = epoch.t;
  }
  if (open !== null && lastT !== null) runs.push({ startT: open, endT: lastT + 30 });
  return runs;
}

export function buildBandModel(report: NightReport): BandModel {
  const { session, epochs, cues, wakes, applePhases } = report;
  const rangeStartT = epochSecondsFrom(session.startedAt);
  const lastEpoch = epochs[epochs.length - 1];
  const lastEpochT = lastEpoch ? lastEpoch.t + 30 : rangeStartT;
  const rangeEndT = session.endedAt !== null ? epochSecondsFrom(session.endedAt) : lastEpochT;
  const span = Math.max(1, rangeEndT - rangeStartT);
  const fraction = (t: number): number => Math.min(1, Math.max(0, (t - rangeStartT) / span));

  const onsetT = session.onsetAt !== null ? epochSecondsFrom(session.onsetAt) : null;
  const guardUntilT = session.guardUntil !== null ? epochSecondsFrom(session.guardUntil) : null;

  const segments: BandSegment[] = [];
  if (onsetT !== null && guardUntilT !== null) {
    segments.push({ kind: 'guard', startFraction: fraction(onsetT), endFraction: fraction(guardUntilT) });
    segments.push({ kind: 'watch', startFraction: fraction(guardUntilT), endFraction: 1 });
  } else if (onsetT !== null) {
    segments.push({ kind: 'watch', startFraction: fraction(onsetT), endFraction: 1 });
  }
  for (const run of remLikelyRuns(epochs)) {
    segments.push({ kind: 'rem', startFraction: fraction(run.startT), endFraction: fraction(run.endT) });
  }

  const realCues = cues.filter((cue: CueRecord) => cue.type !== 'SEED');
  const ticks: BandTick[] = [
    ...realCues.map((cue: CueRecord) => ({ kind: 'cue' as const, fraction: fraction(epochSecondsFrom(cue.at)) })),
    ...wakes.map((wake: WakeRecord) => ({ kind: 'wake' as const, fraction: fraction(epochSecondsFrom(wake.at)) })),
  ];

  const appleRanges = applePhases
    .filter((phase: ApplePhaseRecord) => phase.stage === 'REM')
    .map((phase: ApplePhaseRecord) => ({ startT: epochSecondsFrom(phase.startIso), endT: epochSecondsFrom(phase.endIso) }));
  const appleSegments = appleRanges.map((range) => ({ startFraction: fraction(range.startT), endFraction: fraction(range.endT) }));
  const longest = appleRanges.reduce<{ startT: number; endT: number } | null>((best, range) => {
    if (best === null || range.endT - range.startT > best.endT - best.startT) return range;
    return best;
  }, null);

  return {
    segments,
    ticks,
    appleSegments,
    rangeStartT,
    rangeEndT,
    guardHours: onsetT !== null && guardUntilT !== null ? Math.round(((guardUntilT - onsetT) / 3600) * 10) / 10 : null,
    cueTimes: realCues.map((cue: CueRecord) => cue.at),
    wakeTimes: wakes.map((wake: WakeRecord) => wake.at),
    longestAppleRange: longest === null ? null : { startIso: new Date(longest.startT * 1000).toISOString(), endIso: new Date(longest.endT * 1000).toISOString() },
  };
}

// ---------------------------------------------------------------------------
// Duration + header
// ---------------------------------------------------------------------------

export function nightDurationParts(session: NightReport['session']): { h: number; m: number } {
  if (session.endedAt === null) return { h: 0, m: 0 };
  const totalMin = Math.max(0, Math.round((epochSecondsFrom(session.endedAt) - epochSecondsFrom(session.startedAt)) / 60));
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}

/** Same "15 min before watching resumes" number the engine's Sleep Guard enforces — used by the wake row's sub-line, not re-derived. */
export const WAKE_REST_MIN = Math.round(AWAKE_QUIET_SEC / 60);

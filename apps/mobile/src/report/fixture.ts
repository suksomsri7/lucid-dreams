/**
 * `?fixture=report` (WO L2.10 web QC parity) — the exact night mockup
 * `07-night-report.png` draws, as a real `NightReport` (`@lucid/data`) rather than a
 * screen hand-drawn to look like one: every field below is the same shape
 * `src/data/report.ts#fetchNightReport` would hand the screen from SQLite, so the
 * screen itself never has a "fixture mode" branch beyond "where did this object come
 * from" (same convention as `src/night/session.ts#startNightFixture`).
 *
 * Times are UTC instants on 2026-09-24 chosen to print as the mockup's own captions
 * (23:10 → 06:51 etc.) when rendered in a UTC-timezone browser (the VPS QC screenshot
 * environment); a browser in another time zone will show different digits in the same
 * positions — `ledger/wo-notes/L2.8ui.md` notes this as the parity caveat it is.
 */

import type { ApplePhaseRecord, CueRecord, EpochRecord, NightEvent, NightReport, ReportRecord, SessionRecord, WakeRecord } from '@lucid/data';

import type { DreamPlan } from '../advisor/types';
import { translate, type Locale } from '../i18n';

const SESSION_ID = 'demo';
const START_ISO = '2026-09-23T23:10:00.000Z';
const END_ISO = '2026-09-24T06:51:00.000Z';
const ONSET_ISO = '2026-09-23T23:31:00.000Z';
const GUARD_UNTIL_ISO = '2026-09-24T02:31:00.000Z';

function t(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function fixturePlan(locale: Locale): DreamPlan {
  return {
    theme: {
      emoji: '🐋',
      titleTh: translate('th', 'advisor.theme.whale'),
      titleEn: translate('en', 'advisor.theme.whale'),
      place: translate(locale, 'advisor.theme.whale.place'),
    },
    seedLines: [translate(locale, 'advisor.theme.whale.seed1'), translate(locale, 'advisor.clarify.turtle.detail')],
    anchorPhrase: translate(locale, 'advisor.anchorPhrase'),
    ambienceKey: 'underwater',
    clarify: null,
  };
}

/** REM-likely bumps around each cue (mockup band's mint segments), baseline elsewhere. */
function pRemAt(seconds: number): number {
  const windows: [number, number][] = [
    [t('2026-09-24T03:04:00.000Z'), t('2026-09-24T03:23:00.000Z')],
    [t('2026-09-24T05:30:00.000Z'), t('2026-09-24T05:50:00.000Z')],
  ];
  for (const [start, end] of windows) {
    if (seconds >= start && seconds < end) return 0.78;
  }
  return 0.08;
}

function generateEpochs(): EpochRecord[] {
  const startT = t(START_ISO);
  const endT = t(END_ISO);
  const onsetT = t(ONSET_ISO);
  const wakeT = t('2026-09-24T04:05:00.000Z');
  const epochs: EpochRecord[] = [];
  let id = 1;
  for (let epochT = startT; epochT < endT; epochT += 30) {
    const asleep = epochT >= onsetT;
    const inWake = epochT >= wakeT && epochT < wakeT + 3 * 60;
    const pRem = asleep && !inWake ? pRemAt(epochT) : 0;
    epochs.push({
      id: id++,
      sessionId: SESSION_ID,
      t: epochT,
      hrMean: inWake ? 78 : asleep ? 55 + Math.round(pRem * 6) : 68,
      hrSd: asleep ? 2 : 5,
      motion: inWake ? 0.4 : asleep ? 0.02 : 0.1,
      battery: 0.7,
      pRem,
      state: asleep ? (inWake ? 'AWAKE' : pRem >= 0.5 ? 'REM_LIKELY' : 'WATCHING') : 'FALLING_ASLEEP',
      source: 'WATCH',
    });
  }
  return epochs;
}

function fixtureCues(): CueRecord[] {
  return [
    { id: 1, sessionId: SESSION_ID, at: '2026-09-23T23:14:00.000Z', index: 1, volume: 0.15, type: 'SEED', pRemAtCue: null, played: true, response: 'NONE' },
    { id: 2, sessionId: SESSION_ID, at: '2026-09-24T03:12:00.000Z', index: 1, volume: 0.15, type: 'WHISPER', pRemAtCue: 0.75, played: true, response: 'NONE' },
    { id: 3, sessionId: SESSION_ID, at: '2026-09-24T03:19:00.000Z', index: 2, volume: 0.18, type: 'WHISPER', pRemAtCue: 0.78, played: true, response: 'NONE' },
    { id: 4, sessionId: SESSION_ID, at: '2026-09-24T05:40:00.000Z', index: 3, volume: 0.18, type: 'WHISPER', pRemAtCue: 0.8, played: true, response: 'HEARD_IN_DREAM' },
  ];
}

function fixtureWakes(): WakeRecord[] {
  return [{ id: 1, sessionId: SESSION_ID, at: '2026-09-24T04:05:00.000Z', durationSec: 180, cause: 'MOTION' }];
}

function fixtureApplePhases(): ApplePhaseRecord[] {
  return [
    { id: 1, sessionId: SESSION_ID, startIso: '2026-09-24T03:11:00.000Z', endIso: '2026-09-24T03:24:00.000Z', stage: 'REM' },
    { id: 2, sessionId: SESSION_ID, startIso: '2026-09-24T04:50:00.000Z', endIso: '2026-09-24T05:35:00.000Z', stage: 'REM' },
    { id: 3, sessionId: SESSION_ID, startIso: '2026-09-24T05:39:00.000Z', endIso: '2026-09-24T05:52:00.000Z', stage: 'REM' },
  ];
}

function fixtureReport(): ReportRecord {
  return {
    id: 'mr-demo',
    sessionId: SESSION_ID,
    dreamed: 1,
    themeMatchUser: 8,
    lucid: 'YES',
    sleepQuality: 7,
    cueWoke: false,
    audioPath: null,
    transcript: null,
    recordedAt: END_ISO,
  };
}

function fixtureEvents(cues: CueRecord[], wakes: WakeRecord[], report: ReportRecord): NightEvent[] {
  const events: NightEvent[] = [
    { at: START_ISO, kind: 'START', sessionId: SESSION_ID, mode: 'CUE', themeKey: 'whale' },
    { at: cues[0]?.at ?? START_ISO, kind: 'SEED', cueId: 1, index: 1, volume: 0.15, type: 'SEED', played: true, response: 'NONE', pRemAtCue: null },
    { at: ONSET_ISO, kind: 'ONSET' },
    { at: GUARD_UNTIL_ISO, kind: 'GUARD_END' },
    { at: '2026-09-24T03:11:00.000Z', kind: 'REM_LIKELY', pRem: 0.74 },
    ...cues.slice(1).map((cue) => ({ at: cue.at, kind: 'CUE' as const, cueId: cue.id, index: cue.index, volume: cue.volume, type: cue.type, played: cue.played, response: cue.response, pRemAtCue: cue.pRemAtCue })),
    ...wakes.map((wake) => ({ at: wake.at, kind: 'WAKE' as const, durationSec: wake.durationSec, cause: wake.cause })),
    { at: '2026-09-24T05:39:00.000Z', kind: 'REM_LIKELY', pRem: 0.81 },
    { at: END_ISO, kind: 'END' },
    { at: report.recordedAt, kind: 'REPORT', lucid: report.lucid, themeMatchUser: report.themeMatchUser, dreamed: report.dreamed },
  ];
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export function fixtureNightReport(locale: Locale): NightReport {
  const plan = fixturePlan(locale);
  const cues = fixtureCues();
  const wakes = fixtureWakes();
  const report = fixtureReport();

  const session: SessionRecord = {
    id: SESSION_ID,
    dateIso: '2026-09-23',
    themeId: null,
    themeKey: 'whale',
    mode: 'CUE',
    startedAt: START_ISO,
    onsetAt: ONSET_ISO,
    guardUntil: GUARD_UNTIL_ISO,
    endedAt: END_ISO,
    watchConnected: true,
    params: { plan },
    applePhasesFetched: true,
    createdAt: START_ISO,
  };

  return {
    session,
    epochs: generateEpochs(),
    cues,
    wakes,
    applePhases: fixtureApplePhases(),
    report,
    aiScore: null,
    earTests: [],
    events: fixtureEvents(cues, wakes, report),
  };
}

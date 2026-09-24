/**
 * One `NightEvent` (`@lucid/data#buildEvents`) → one `EventRow` (`src/ui/EventRow.tsx`,
 * mockup `07-night-report.png`'s "เหตุการณ์ทั้งคืน" card) — WO L2.10.
 *
 * `pRemAtCue === 0` is not "0 % REM" — it is the engine's own placeholder for "no
 * probability existed at all" (timer-mode/sensor-loss cues, `wakeDetector.ts`'s
 * `timerCueWindows`), documented as a debt for this screen in
 * `ledger/wo-notes/L2.6-2.7.md` §6 item 5 ("pRemAtCue = 0 ในโหมดจับเวลา … ต้องแสดงเป็น
 * '—' ไม่ใช่ 0%") — `formatPercent` below is the fix.
 */

import { BED_VOLUME_BED, BED_VOLUME_FULL } from '@lucid/engine';
import type { NightEvent } from '@lucid/data';

import type { DreamPlan } from '../advisor/types';
import type { Locale, TranslateParams, TranslationKey } from '../i18n';
import { ambienceLabelKey, fmtTime, WAKE_REST_MIN } from './format';

export interface EventRowModel {
  time: string;
  title: string;
  sub?: string;
}

type Translate = (key: TranslationKey, params?: TranslateParams) => string;

function formatPercent(value: unknown): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (n === null || n <= 0) return '—';
  return String(Math.round(n * 100));
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface EventTextContext {
  t: Translate;
  locale: Locale;
  plan: DreamPlan | null;
  /** Epoch seconds where Apple scored REM — for the cue row's "ตรงกับ REM ของ Apple ✓". */
  appleRemEpochTs: ReadonlySet<number>;
  epochSecondsFrom: (iso: string) => number;
}

const WAKE_CAUSE_KEY: Record<string, TranslationKey> = {
  MOTION: 'report.event.wakeCause.motion',
  HR: 'report.event.wakeCause.hr',
  USER: 'report.event.wakeCause.user',
};

export function describeEvent(event: NightEvent, ctx: EventTextContext): EventRowModel {
  const { t, locale, plan } = ctx;
  const time = fmtTime(event.at, locale);

  switch (event.kind) {
    case 'START':
      return {
        time,
        title: t('report.event.start'),
        sub: plan
          ? t('report.event.start.sub', { ambience: t(ambienceLabelKey(plan.ambienceKey)), percent: Math.round(BED_VOLUME_FULL * 100) })
          : undefined,
      };

    case 'SEED': {
      const index = num(event.index);
      const line = plan?.seedLines[index - 1];
      return { time, title: t('report.event.seed'), sub: line ? `“${line}”` : undefined };
    }

    case 'ONSET':
      return { time, title: t('report.event.onset'), sub: t('report.event.onset.sub', { percent: Math.round(BED_VOLUME_BED * 100) }) };

    case 'GUARD_END':
      return { time, title: t('report.event.guardEnd') };

    case 'REM_LIKELY':
      return { time, title: t('report.event.remLikely', { percent: formatPercent(event.pRem) }) };

    case 'CUE': {
      const index = num(event.index);
      const matchesApple = ctx.appleRemEpochTs.has(ctx.epochSecondsFrom(event.at));
      const base = t(event.response === 'WOKE' ? 'report.event.cue.sub.woke' : 'report.event.cue.sub.notWoke');
      return {
        time,
        title: t('report.event.cue', { n: index, percent: formatPercent(event.pRemAtCue) }),
        sub: matchesApple ? `${base}${t('report.event.cue.sub.appleMatch')}` : base,
      };
    }

    case 'WAKE': {
      const min = Math.max(0, Math.round(num(event.durationSec) / 60));
      const causeKey = WAKE_CAUSE_KEY[str(event.cause)] ?? 'report.event.wakeCause.motion';
      return {
        time,
        title: t('report.event.wake', { min, cause: t(causeKey) }),
        sub: t('report.event.wake.sub', { min: WAKE_REST_MIN }),
      };
    }

    case 'END':
      return { time, title: t('report.event.end') };

    case 'REPORT':
      return { time, title: t('report.event.report') };

    default:
      return { time, title: String(event.kind) };
  }
}

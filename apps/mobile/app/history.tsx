import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { NightSummary } from '@lucid/data';

import { fetchLastNights } from '../src/data/history';
import { useT, type Locale, type TranslateParams, type TranslationKey } from '../src/i18n';
import { THEME_CHIPS } from '../src/advisor';
import { GlassCard, Row, Screen, Sub, Title } from '../src/ui';

type Translate = (key: TranslationKey, params?: TranslateParams) => string;

/**
 * `advisor.history` ("History") — every past night, reached from the link in the advisor room (`AdvisorRoom.tsx`,
 * mockups 02/03), not the Journal tab (that screen's 30-night chart + totals is
 * L2.10/L3.5 — this is just the `.li` row list, mockup `08-journal.png`'s bottom card).
 *
 * `getRepo()` throws on web by design (`src/data/index.ts` — the web build is QC-only,
 * no SQLite there), so this screen never even tries it there and shows the same 3-row
 * fixture the mockup itself uses instead (WO L1.4 deliverables). It reaches the real
 * repo through `../src/data/history.ts` rather than `getRepo()` directly — see that
 * file's header for why (a Metro/web bundling problem, not a data-layer one).
 */
export default function HistoryScreen() {
  const { t, locale } = useT();
  const [rows, setRows] = useState<NightSummary[] | null>(Platform.OS === 'web' ? [] : null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    fetchLastNights(30)
      .then((summaries) => {
        if (!cancelled) setRows(summaries);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nights = Platform.OS === 'web' ? historyFixtureRows() : (rows ?? []);
  const loading = Platform.OS !== 'web' && rows === null;

  return (
    <Screen testID="screen-history">
      <Title>{t('history.title')}</Title>
      <Sub>{t('history.subtitle')}</Sub>

      {loading ? (
        <GlassCard variant="soft">
          <Sub>{t('common.loading')}</Sub>
        </GlassCard>
      ) : nights.length === 0 ? (
        <GlassCard variant="soft">
          <Sub>{t('history.empty')}</Sub>
        </GlassCard>
      ) : (
        <GlassCard noPadding>
          {nights.map((night, index) => (
            <Row
              key={night.id}
              label={nightLabel(night, locale)}
              value={nightValue(night, t)}
              last={index === nights.length - 1}
            />
          ))}
        </GlassCard>
      )}
    </Screen>
  );
}

function nightLabel(night: NightSummary, locale: Locale): string {
  const emoji = THEME_CHIPS.find((theme) => theme.key === night.themeKey)?.emoji ?? '🌙';
  return `${formatNightDate(night.dateIso, locale)} · ${emoji}`;
}

function nightValue(night: NightSummary, t: Translate): string {
  const parts: string[] = [];
  if (night.themeMatchUser !== null) parts.push(t('history.row.themeMatch', { n: night.themeMatchUser }));
  if (night.mode === 'CONTROL') {
    parts.push(t('history.row.control'));
  } else {
    if (night.lucid !== null) parts.push(t(night.lucid === 'YES' ? 'history.row.lucidYes' : 'history.row.lucidNo'));
    parts.push(t('history.row.cueCount', { n: night.playedCueCount }));
  }
  return parts.join(' · ');
}

/** `Intl`, not a lookup table — the rendered weekday/month text is Thai for `locale==='th'` but the *source* never is (fitness rule B). */
function formatNightDate(dateIso: string, locale: Locale): string {
  const date = new Date(`${dateIso}T12:00:00`);
  const formatter = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return Number.isNaN(date.getTime()) ? dateIso : formatter.format(date);
}

/** Web QC fallback — 3 nights matching mockup `08-journal.png`'s `.li` rows, dated relative to "today" so `formatNightDate` stays honest. */
function historyFixtureRows(): NightSummary[] {
  const today = new Date();
  const isoOffset = (daysAgo: number): string => {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().slice(0, 10);
  };
  const base = {
    startedAt: '',
    onsetAt: null,
    guardUntil: null,
    endedAt: null,
    watchConnected: true,
    params: {},
    applePhasesFetched: false,
    createdAt: '',
    epochCount: 0,
    wakeCount: 0,
    hasReport: true,
  } as const;
  return [
    { ...base, id: 'fixture-0', dateIso: isoOffset(0), themeId: null, themeKey: 'whale', mode: 'CUE', cueCount: 3, playedCueCount: 3, lucid: 'YES', themeMatchUser: 8, dreamed: 1, sleepQuality: 7 },
    { ...base, id: 'fixture-1', dateIso: isoOffset(1), themeId: null, themeKey: 'fly', mode: 'CONTROL', cueCount: 0, playedCueCount: 0, lucid: 'NO', themeMatchUser: 5, dreamed: 1, sleepQuality: 6 },
    { ...base, id: 'fixture-2', dateIso: isoOffset(2), themeId: null, themeKey: 'whale', mode: 'CUE', cueCount: 4, playedCueCount: 4, lucid: 'YES', themeMatchUser: 7, dreamed: 1, sleepQuality: 7 },
  ];
}

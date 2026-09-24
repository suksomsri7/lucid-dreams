import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import type { NightSummary } from '@lucid/data';

import { THEME_CHIPS } from '../../src/advisor';
import { fetchLastNights } from '../../src/data/history';
import { retryPendingAppleImports } from '../../src/health/appleSleep';
import { useT, type Locale, type TranslateParams, type TranslationKey } from '../../src/i18n';
import { GlassCard, Row, Screen, Sub, Title } from '../../src/ui';

type Translate = (key: TranslationKey, params?: TranslateParams) => string;

/**
 * Tab 2 — every past night (mockup 08). The `.li` row list itself (this file) and the
 * link into `/report/[id]` are WO L2.10; the 30-night chart + the three running totals
 * on top of it are L3.5 — this screen still shows just the list `history.tsx` already
 * draws for the advisor room's "History" link (WO L1.4), now wired to the real report
 * screen instead of nowhere.
 *
 * Also the one place that calls `retryPendingAppleImports()` (WO L2.9's "simple
 * on-app-open retry" — see that function's own header) — the Journal tab is the screen
 * an owner opens specifically to look at past nights, so it is the natural point to
 * quietly catch up any night whose Apple sleep stages were not ready yet at 7am.
 */
export default function JournalScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<NightSummary[] | null>(Platform.OS === 'web' ? [] : null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    void retryPendingAppleImports().catch(() => undefined);

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

  const nights = Platform.OS === 'web' ? journalFixtureRows() : (rows ?? []);
  const loading = Platform.OS !== 'web' && rows === null;

  return (
    <Screen testID="screen-journal">
      <Title>{t('journal.title')}</Title>
      <Sub>{t('journal.subtitle')}</Sub>

      {loading ? (
        <GlassCard variant="soft">
          <Sub>{t('common.loading')}</Sub>
        </GlassCard>
      ) : nights.length === 0 ? (
        <GlassCard variant="soft">
          <Sub>{t('journal.empty')}</Sub>
        </GlassCard>
      ) : (
        <GlassCard noPadding>
          {nights.map((night, index) => (
            <Row
              key={night.id}
              label={nightLabel(night, locale)}
              value={nightValue(night, t)}
              last={index === nights.length - 1}
              onPress={() => router.push(`/report/${night.id}`)}
              testID={`journal-row-${night.id}`}
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

/** `Intl`, not a lookup table — same convention as `history.tsx`'s own `formatNightDate`. */
function formatNightDate(dateIso: string, locale: Locale): string {
  const date = new Date(`${dateIso}T12:00:00`);
  const formatter = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return Number.isNaN(date.getTime()) ? dateIso : formatter.format(date);
}

/** Web QC fallback — identical rows to `history.tsx`'s own fixture, `id`s point at `/report/[id]`'s own `?fixture=report`. */
function journalFixtureRows(): NightSummary[] {
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
    { ...base, id: 'demo', dateIso: isoOffset(0), themeId: null, themeKey: 'whale', mode: 'CUE', cueCount: 3, playedCueCount: 3, lucid: 'YES', themeMatchUser: 8, dreamed: 1, sleepQuality: 7 },
    { ...base, id: 'fixture-1', dateIso: isoOffset(1), themeId: null, themeKey: 'fly', mode: 'CONTROL', cueCount: 0, playedCueCount: 0, lucid: 'NO', themeMatchUser: 5, dreamed: 1, sleepQuality: 6 },
    { ...base, id: 'fixture-2', dateIso: isoOffset(2), themeId: null, themeKey: 'whale', mode: 'CUE', cueCount: 4, playedCueCount: 4, lucid: 'YES', themeMatchUser: 7, dreamed: 1, sleepQuality: 7 },
  ];
}

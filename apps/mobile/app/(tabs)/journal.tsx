import { useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { NightSummary, StatsResult } from '@lucid/data';
import { explainLearning, type PersonalModel } from '@lucid/engine';

import { THEME_CHIPS } from '../../src/advisor';
import { fetchLastNights } from '../../src/data/history';
import { fetchJournalStats } from '../../src/journal/stats';
import { exportNightJson, fetchNightReport } from '../../src/data/report';
import { retryPendingAppleImports } from '../../src/health/appleSleep';
import { getPersonalModel } from '../../src/learning';
import { useT, type Locale, type TranslateParams, type TranslationKey } from '../../src/i18n';
import { GlassCard, Hyp, Row, Screen, Sub, Title, colors, spacing, typeScale, type HypBar } from '../../src/ui';

type Translate = (key: TranslationKey, params?: TranslateParams) => string;

/** DESIGN §5.5: nothing about "control vs. cue" is meaningful with almost no control
 * nights to compare against — mockup 08's own header shows the real 16/27/8/6.4 numbers
 * precisely because there is enough of both; oracle M5.3's own name for the floor. */
const MIN_CONTROL_NIGHTS_TO_COMPARE = 4;
/** "Last 30 nights" (mockup 08's own chart title). */
const CHART_NIGHTS = 30;
/** DESIGN §5.5 gate for the histogram below, same floor `getPersonalModel`'s
 * `explainLearning` uses for "Learning n/14" — cue-time-of-day needs fewer nights
 * than the bandit does to say something honest, but still more than one or two. */
const MIN_NIGHTS_FOR_DREAM_TIME = 7;
/** How many recent CUE nights' cue timestamps are inspected for "you tend to dream…" — full
 * epoch history would answer this more precisely but at the cost of reading every
 * `SensorEpoch` row of every recent night; cue timestamps are already a REM-likely
 * sample (a cue only ever fires in `REM_LIKELY`/`CUE`), so they are cheap and honest. */
const DREAM_TIME_NIGHTS_SAMPLED = 20;
/** Half-hour buckets across a day, same granularity DESIGN §7's own `remHistogram[24×2]` uses. */
const DREAM_TIME_BUCKET_MIN = 30;
const DREAM_TIME_BUCKETS = (24 * 60) / DREAM_TIME_BUCKET_MIN;

/**
 * Tab 2 — every past night + the totals (mockup `08-journal.png`, WO L3.5). The row list
 * itself and the link into `/report/[id]` are L2.10; everything above the list (the two
 * headline percentages vs. control nights, the average theme match, the night count, the
 * 30-night bar chart, "you tend to dream…" and the learning card) is this WO.
 */
export default function JournalScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const isWeb = Platform.OS === 'web';
  const fixture = isWeb && readFixtureParam() === 'journal';

  const [rows, setRows] = useState<NightSummary[] | null>(isWeb ? [] : null);
  const [stats, setStats] = useState<StatsResult | null>(fixture ? journalFixtureStats() : null);
  const [dreamTimeRange, setDreamTimeRange] = useState<{ startMin: number; endMin: number } | null>(
    fixture ? { startMin: 4 * 60 + 30, endMin: 5 * 60 + 30 } : null,
  );
  const [model, setModel] = useState<PersonalModel | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isWeb) return;
    let cancelled = false;

    void retryPendingAppleImports().catch(() => undefined);

    fetchLastNights(CHART_NIGHTS)
      .then((summaries) => {
        if (cancelled) return;
        setRows(summaries);
        void fetchJournalStats(CHART_NIGHTS).then((result) => !cancelled && setStats(result));
        void computeDreamTimeRange().then((range) => !cancelled && setDreamTimeRange(range));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    void getPersonalModel()
      .then((personalModel) => !cancelled && setModel(personalModel))
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isWeb]);

  const nights = isWeb ? journalFixtureRows() : (rows ?? []);
  const loading = !isWeb && rows === null;

  async function handleExport(): Promise<void> {
    if (isWeb) return;
    try {
      const bundle = await exportNightJson();
      const directory = new Directory(Paths.cache, 'journal-export');
      if (!directory.exists) directory.create({ intermediates: true });
      const target = new File(directory, `dreaming-export-${Date.now()}.json`);
      target.create({ intermediates: true, overwrite: true });
      target.write(JSON.stringify(bundle, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target.uri, { mimeType: 'application/json', dialogTitle: t('journal.export'), UTI: 'public.json' });
      }
      setExportMessage(t('report.export.done'));
    } catch {
      setExportMessage(t('report.export.failed'));
    }
  }

  const canCompareControl = (stats?.controlNights ?? 0) >= MIN_CONTROL_NIGHTS_TO_COMPARE;
  const chartBars: HypBar[] = (isWeb ? journalFixtureBars() : buildHypBars(rows ?? []));
  const dreamTimeText =
    dreamTimeRange === null
      ? t('journal.chart.dreamTime.unknown')
      : t('journal.chart.dreamTime', { range: `${formatMinuteOfDay(dreamTimeRange.startMin)}–${formatMinuteOfDay(dreamTimeRange.endMin)}` });

  return (
    <Screen testID="screen-journal">
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Title>{t('journal.title')}</Title>
          <Sub>{t('journal.subtitle')}</Sub>
        </View>
        <Text
          accessibilityRole="link"
          onPress={() => void handleExport()}
          style={[typeScale.body, styles.exportLink]}
          testID="journal-export"
        >
          {t('journal.export')}
        </Text>
      </View>

      {stats !== null ? (
        <GlassCard testID="journal-stats-card">
          <Sub>{t('journal.stats.header', { n: stats.nights })}</Sub>
          <View style={styles.statsRow}>
            <View style={styles.statsMain}>
              <Text style={[typeScale.num, styles.statsBigOn]}>{formatPercent(stats.lucidRateCue)}</Text>
              <Sub>{t('journal.stats.cueLabel')}</Sub>
            </View>
            <View style={styles.statsVsCol}>
              <Sub>{t('journal.stats.vs')}</Sub>
              <Text style={[typeScale.h1, styles.statsSmall]}>
                {canCompareControl ? formatPercent(stats.lucidRateControl) : t('journal.stats.notEnoughControl')}
              </Text>
              {canCompareControl ? <Sub>{t('journal.stats.controlLabel')}</Sub> : null}
            </View>
          </View>
        </GlassCard>
      ) : null}

      {stats !== null ? (
        <View style={styles.twoUp}>
          <GlassCard style={{ flex: 1 }} testID="journal-theme-match-card">
            <Text style={typeScale.h1}>{stats.themeMatchAvg.toFixed(1)}</Text>
            <Sub>{t('journal.stats.themeMatchAvg')}</Sub>
          </GlassCard>
          <GlassCard style={{ flex: 1 }} testID="journal-nights-card">
            <Text style={typeScale.h1}>{stats.nights}</Text>
            <Sub>{t('journal.stats.nights')}</Sub>
          </GlassCard>
        </View>
      ) : null}

      <GlassCard testID="journal-chart-card">
        <View style={styles.chartHeader}>
          <Sub style={{ fontWeight: '700' }}>{t('journal.chart.title', { n: CHART_NIGHTS })}</Sub>
          <Sub>{t('journal.chart.legendHigh')}</Sub>
        </View>
        <Hyp bars={chartBars} testID="journal-hyp" />
        <View style={styles.legendRow}>
          <LegendDot tone={colors.acc} label={t('dev.hyp.legend.on')} />
          <LegendDot tone="rgba(107,92,255,0.28)" label={t('dev.hyp.legend.default')} />
          <LegendDot tone="rgba(17,19,24,0.10)" label={t('dev.hyp.legend.ctl')} />
        </View>
        <Sub style={{ marginTop: spacing.xs }} testID="journal-dream-time">
          {dreamTimeText}
        </Sub>
      </GlassCard>

      {model !== null ? (
        <GlassCard testID="journal-learning-card">
          <Sub style={{ fontWeight: '700' }}>{t('journal.learning.title')}</Sub>
          <Sub>{explainLearning(model, locale)}</Sub>
        </GlassCard>
      ) : null}

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
      {exportMessage ? <Sub testID="journal-export-message">{exportMessage}</Sub> : null}
    </Screen>
  );
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: tone }]} />
      <Sub>{label}</Sub>
    </View>
  );
}

function readFixtureParam(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  return new URLSearchParams(window.location.search).get('fixture');
}

function formatPercent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

function formatMinuteOfDay(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60) % 24;
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

async function computeDreamTimeRange(): Promise<{ startMin: number; endMin: number } | null> {
  const recent = await fetchLastNights(DREAM_TIME_NIGHTS_SAMPLED);
  const cueNights = recent.filter((night) => night.mode === 'CUE' && night.playedCueCount > 0);
  if (cueNights.length < MIN_NIGHTS_FOR_DREAM_TIME) return null;

  const buckets = new Array<number>(DREAM_TIME_BUCKETS).fill(0);
  let sampleCount = 0;
  for (const night of cueNights) {
    const report = await fetchNightReport(night.id).catch(() => null);
    if (report === null) continue;
    for (const cue of report.cues) {
      if (cue.type === 'SEED' || !cue.played) continue;
      const date = new Date(cue.at);
      const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
      const bucket = Math.floor(minuteOfDay / DREAM_TIME_BUCKET_MIN) % DREAM_TIME_BUCKETS;
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
      sampleCount += 1;
    }
  }
  if (sampleCount < MIN_NIGHTS_FOR_DREAM_TIME) return null;

  // Densest 2-bucket (1 h) window, wrapping past midnight.
  let bestStart = 0;
  let bestSum = -1;
  for (let start = 0; start < DREAM_TIME_BUCKETS; start += 1) {
    const sum = (buckets[start] ?? 0) + (buckets[(start + 1) % DREAM_TIME_BUCKETS] ?? 0);
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = start;
    }
  }
  const startMin = bestStart * DREAM_TIME_BUCKET_MIN;
  const endMin = (startMin + 2 * DREAM_TIME_BUCKET_MIN) % (24 * 60);
  return { startMin, endMin };
}

function buildHypBars(summaries: NightSummary[]): HypBar[] {
  // `lastNights` returns newest-first; the chart reads oldest → newest left to right.
  return [...summaries]
    .reverse()
    .map((night) => ({
      value: (night.themeMatchUser ?? 0) / 10,
      tone: night.mode === 'CONTROL' ? 'ctl' : night.lucid === 'YES' ? 'on' : 'default',
    }));
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

// ---------------------------------------------------------------------------
// `?fixture=journal` (WO L3.5 QC parity) — mockup `08-journal.png`'s own numbers exactly:
// 27% vs 8%, 6.4, 16 nights, 30-night chart, "you tend to dream 04:30–05:30".
// ---------------------------------------------------------------------------

function journalFixtureStats(): StatsResult {
  return {
    nights: 16,
    cueNights: 12,
    controlNights: 4,
    lucidRateCue: 0.27,
    lucidRateControl: 0.08,
    themeMatchAvg: 6.4,
    windowDays: 30,
    fromDateIso: '2026-08-25',
  };
}

function journalFixtureBars(): HypBar[] {
  const bars: HypBar[] = [];
  for (let i = 0; i < CHART_NIGHTS; i += 1) {
    const isControl = i % 7 === 3;
    const isLucid = !isControl && i % 3 === 0;
    const value = isControl ? 0.25 + (i % 3) * 0.08 : 0.45 + ((i * 37) % 55) / 100;
    bars.push({ value: Math.min(1, value), tone: isControl ? 'ctl' : isLucid ? 'on' : 'default' });
  }
  return bars;
}

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

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  exportLink: { color: colors.acc, fontWeight: '600', paddingTop: 4 },
  statsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  statsMain: { flex: 1 },
  statsBigOn: { color: colors.acc },
  statsVsCol: { alignItems: 'flex-start' },
  statsSmall: { fontSize: 24 },
  twoUp: { flexDirection: 'row', gap: spacing.md },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
});

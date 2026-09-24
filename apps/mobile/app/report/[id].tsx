/**
 * The night report (DESIGN §5.2 · §7 · mockup `07-night-report.png` — WO L2.10).
 * Everything on screen comes straight from one `NightReport` (`@lucid/data`): the band
 * (`src/report/format.ts#buildBandModel`), the event list
 * (`src/report/eventText.ts#describeEvent`), the "tonight's result" card and the export button.
 *
 * `?fixture=report` (web QC, `src/dev/fixtures.ts`) swaps the database read for
 * `src/report/fixture.ts`'s canned `NightReport` — the same object shape either way, so
 * nothing below has a fixture-mode branch beyond "which report did we get".
 */

import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { NightReport } from '@lucid/data';
import { buildDiagnosticsExport, nextNightVolume, systemClock, type CueEvent, type CueType } from '@lucid/engine';

import { THEME_CHIPS } from '../../src/advisor';
import { fetchNightDiagnosticsDraft, fetchNightReport } from '../../src/data/report';
import { reportFixtureRequested } from '../../src/dev/fixtures';
import { compareAppleToEstimate } from '../../src/health/appleSleep';
import { useT } from '../../src/i18n';
import { getPlatform } from '../../src/platform';
import {
  appleRemEpochSeconds,
  buildBandModel,
  fmtTime,
  intlLocale,
  nightDurationParts,
  planFromSessionParams,
  timelineLabels,
} from '../../src/report/format';
import { describeEvent } from '../../src/report/eventText';
import { fixtureNightReport } from '../../src/report/fixture';
import { AppleRemLine } from '../../src/report/AppleRemLine';
import { Band, Button, Chip, EventRow, GlassCard, Screen, StepNav, Sub, colors, spacing, typeScale } from '../../src/ui';

export default function NightReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useT();
  const router = useRouter();
  const isFixture = reportFixtureRequested();

  const [report, setReport] = useState<NightReport | null>(Platform.OS === 'web' ? fixtureNightReport(locale) : null);
  const [notFound, setNotFound] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web' || isFixture) return;
    if (typeof id !== 'string' || id === '') {
      setNotFound(true);
      return;
    }
    let cancelled = false;
    fetchNightReport(id)
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isFixture]);

  async function handleExport(): Promise<void> {
    if (Platform.OS === 'web' || report === null) return;
    try {
      const draft = await fetchNightDiagnosticsDraft(report.session.id);
      const device = await getPlatform().deviceInfo.read();
      const payload = buildDiagnosticsExport(
        {
          ...draft,
          appVersion: Constants.expoConfig?.version ?? draft.appVersion,
          buildNumber: Constants.expoConfig?.ios?.buildNumber ?? draft.buildNumber,
          device: { platform: device.platform, osVersion: device.osVersion, model: device.model, modelName: device.modelName, locale },
          // Historical export, not a live diagnostics screen — no live sensor/audio-event/battery
          // trace to report (`DataDiagnosticsDraft`'s own fields are typed `unknown[]` precisely
          // because the data layer never inspects their shape — `@lucid/engine`'s schema does).
          sensors: [],
          audioEvents: [],
          batterySamples: [],
        },
        systemClock,
      );

      const directory = new Directory(Paths.cache, 'night-report');
      if (!directory.exists) directory.create({ intermediates: true });
      const target = new File(directory, `night-${report.session.id}.json`);
      target.create({ intermediates: true, overwrite: true });
      target.write(JSON.stringify(payload, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target.uri, { mimeType: 'application/json', dialogTitle: t('report.result.export'), UTI: 'public.json' });
      }
      setExportMessage(t('report.export.done'));
    } catch {
      setExportMessage(t('report.export.failed'));
    }
  }

  if (notFound) {
    return (
      <Screen testID="screen-report-notfound">
        <StepNav title={t('report.title')} onBack={() => router.back()} />
        <GlassCard variant="soft">
          <Sub>{t('report.notFound')}</Sub>
        </GlassCard>
      </Screen>
    );
  }

  if (report === null) {
    return <Screen testID="screen-report-loading" />;
  }

  const { session, cues, wakes, applePhases, report: morning } = report;
  const plan = planFromSessionParams(session.params);
  const theme = THEME_CHIPS.find((definition) => definition.key === session.themeKey);
  const themeLabel = theme ? t(theme.planTitleKey) : (session.themeKey ?? '—');
  const dateLabel = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${session.dateIso}T12:00:00`),
  );
  const { h, m } = nightDurationParts(session);
  const range = `${fmtTime(session.startedAt, locale)} → ${fmtTime(session.endedAt ?? session.startedAt, locale)}`;
  const isControl = session.mode === 'CONTROL';

  const band = buildBandModel(report);
  const remEpochTs = appleRemEpochSeconds(applePhases);
  const realCues = cues.filter((cue) => cue.type !== 'SEED');
  const match = compareAppleToEstimate(applePhases, report.epochs);

  const currentVolume = realCues[0]?.volume ?? 0.15;
  const engineCues: CueEvent[] = realCues.map((cue) => ({
    t: Math.floor(Date.parse(cue.at) / 1000),
    index: cue.index,
    volume: cue.volume,
    type: cue.type as CueType,
    pRemAtCue: cue.pRemAtCue ?? 0,
    played: cue.played,
    response: cue.response,
  }));
  const nextVolume = Math.round(nextNightVolume(engineCues, currentVolume) * 100);

  return (
    <Screen testID="screen-report">
      <StepNav title={t('report.title')} onBack={() => router.back()} testID="report-nav" />

      <View>
        <Text style={[typeScale.h2, styles.headerTitle]}>
          {dateLabel} · {theme?.emoji ?? '🌙'} {themeLabel}
        </Text>
        <Sub style={styles.headerSub}>{t('report.duration', { h, m, range })}</Sub>
      </View>

      <View style={styles.chipsRow}>
        <Chip label={t(isControl ? 'report.chip.control' : 'report.chip.cue')} tone="acc" size="sm" testID="report-mode-chip" />
        {session.watchConnected ? <Chip label={t('report.device.watch')} size="sm" testID="report-chip-watch" /> : null}
        {report.earTests.length > 0 ? <Chip label={t('report.device.headphones')} size="sm" testID="report-chip-headphones" /> : null}
      </View>

      <GlassCard testID="report-band-card">
        <Sub>{t('report.band.title', { range })}</Sub>
        <View style={styles.bandWrap}>
          <Band segments={band.segments} ticks={band.ticks} testID="report-band" />
          <AppleRemLine segments={band.appleSegments} testID="report-apple-line" />
        </View>
        <View style={styles.timelineRow}>
          {timelineLabels(band.rangeStartT, band.rangeEndT, locale).map((label, index) => (
            // eslint-disable-next-line react/no-array-index-key -- fixed-length, evenly spaced, never reordered
            <Text key={index} style={[typeScale.chipSm, styles.timelineLabel]}>
              {label}
            </Text>
          ))}
        </View>

        <View style={styles.legend}>
          {band.guardHours !== null ? <Sub style={styles.legendLine}>{t('report.band.legend.guard', { h: band.guardHours })}</Sub> : null}
          <Sub style={styles.legendLine}>{t('report.band.legend.watch')}</Sub>
          <Sub style={styles.legendLine}>{t('report.band.legend.rem')}</Sub>
          <Sub style={styles.legendLine}>
            {band.cueTimes.length === 0
              ? t('report.band.legend.cues.none')
              : t('report.band.legend.cues', { times: band.cueTimes.map((iso) => fmtTime(iso, locale)).join(' · ') })}
          </Sub>
          <Sub style={styles.legendLine}>
            {band.wakeTimes.length === 0
              ? t('report.band.legend.wake.none')
              : t('report.band.legend.wake', { times: band.wakeTimes.map((iso) => fmtTime(iso, locale)).join(' · ') })}
          </Sub>
          <Sub style={styles.legendLine}>
            {band.longestAppleRange === null
              ? t('report.band.legend.apple.none')
              : t('report.band.legend.apple', {
                  range: `${fmtTime(band.longestAppleRange.startIso, locale)}–${fmtTime(band.longestAppleRange.endIso, locale)}`,
                })}
          </Sub>
          <Sub style={styles.legendLine} testID="report-apple-precision">
            {match === null ? t('report.apple.none') : t('report.apple.precision', { percent: Math.round(match.precision * 100) })}
          </Sub>
        </View>

        {isControl ? (
          <Sub style={styles.controlNote} testID="report-control-note">
            {t('report.control.wouldHaveFired', { n: realCues.length })}
          </Sub>
        ) : null}
      </GlassCard>

      <GlassCard noPadding testID="report-events-card">
        <View style={styles.eventsHeader}>
          <Text style={[typeScale.h2, styles.eventsTitle]}>{t('report.events.title')}</Text>
          <Sub>{t('report.events.count', { n: report.events.length })}</Sub>
        </View>
        <View style={styles.eventsList}>
          {report.events.map((event, index) => {
            const model = describeEvent(event, {
              t,
              locale,
              plan,
              appleRemEpochTs: remEpochTs,
              epochSecondsFrom: (iso) => Math.floor(Date.parse(iso) / 1000),
            });
            return (
              <EventRow
                key={`${event.kind}-${event.at}-${index}`}
                time={model.time}
                title={model.title}
                sub={model.sub}
                last={index === report.events.length - 1}
                testID={`report-event-${index}`}
              />
            );
          })}
        </View>
      </GlassCard>

      <GlassCard testID="report-result-card">
        <View style={styles.resultHeader}>
          <Text style={[typeScale.h2, styles.resultTitle]}>{t('report.result.title')}</Text>
          <Button label={t('report.result.export')} tone="gh" size="sm" onPress={() => void handleExport()} testID="report-export-button" />
        </View>

        {morning === null ? (
          <Sub>{t('report.result.empty')}</Sub>
        ) : (
          <>
            <View style={styles.statsRow}>
              <ResultStat value={morning.themeMatchUser === null ? '—' : `${morning.themeMatchUser}/10`} label={t('report.result.themeMatch')} />
              <ResultStat value={morning.lucid === 'YES' ? '✓' : morning.lucid === 'NO' ? '✗' : '—'} label={t('report.result.lucid')} tone={morning.lucid === 'YES' ? colors.rem : undefined} />
              <ResultStat value={morning.sleepQuality === null ? '—' : `${morning.sleepQuality}/10`} label={t('report.result.sleepQuality')} />
            </View>
            {!isControl ? <Sub style={styles.nextNight}>{t('report.result.next', { percent: nextVolume })}</Sub> : null}
          </>
        )}
        {exportMessage ? <Sub testID="report-export-message">{exportMessage}</Sub> : null}
      </GlassCard>
    </Screen>
  );
}

interface ResultStatProps {
  value: string;
  label: string;
  tone?: string;
}

function ResultStat({ value, label, tone }: ResultStatProps) {
  return (
    <View style={styles.statCell}>
      <Text style={[typeScale.h1, styles.statValue, tone ? { color: tone } : undefined]}>{value}</Text>
      <Sub>{label}</Sub>
    </View>
  );
}

const styles = StyleSheet.create({
  headerTitle: { color: colors.ink },
  headerSub: { marginTop: 2 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  bandWrap: { marginTop: spacing.sm },
  timelineRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  timelineLabel: { color: colors.mut },
  legend: { marginTop: spacing.sm, gap: 2 },
  legendLine: { fontSize: 11 },
  controlNote: { marginTop: spacing.sm, fontWeight: '600', color: colors.ink2 },
  eventsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, paddingBottom: spacing.xs },
  eventsList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  eventsTitle: { color: colors.ink },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultTitle: { color: colors.ink },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  statCell: { flex: 1 },
  statValue: { color: colors.ink },
  nextNight: { marginTop: spacing.md },
});

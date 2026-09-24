/**
 * The dark, all-night screen (DESIGN §3.4 · §4-05 · mockup `05-night.png` frame a — WO
 * L2.8, replacing the L1.7ui placeholder). `app/plan/ear-right.tsx`'s "start tonight"
 * button already `router.replace()`s here, so this screen only has to boot
 * `src/night/session.ts` and repaint whatever it reports.
 *
 * `?fixture=night` (web QC only, `src/dev/fixtures.ts`) drives the same controller
 * through `startNightFixture` instead of a real watch — see that function's own header
 * for why the shown percentage will not be pixel-identical to the mockup's "72%" on
 * every run.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LIVE_TEXT_KEYS } from '@lucid/engine';

import { nightFixtureRequested } from '../src/dev/fixtures';
import { useT, type TranslationKey } from '../src/i18n';
import { Orb } from '../src/night/Orb';
import { startNightFixture, startNightSession, type NightLiveStats, type NightSessionHandle } from '../src/night/session';
import { useNightState } from '../src/store/night';
import { Chip, GlassSurface, Screen, night, radius, spacing, typeScale } from '../src/ui';

function formatHm(totalSec: number | null): string {
  if (totalSec === null) return '—';
  const totalMin = Math.max(0, Math.floor(totalSec / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** 24h clock, no timezone name — the top status line is a glance, not the report screen's audit trail. */
function formatClock(iso: string | null): string {
  if (iso === null) return '--:--';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export default function NightScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const nightState = useNightState();
  const isFixture = nightFixtureRequested();

  const [handle, setHandle] = useState<NightSessionHandle | null>(null);
  const [stats, setStats] = useState<NightLiveStats | null>(null);
  const stopping = useRef(false);

  useEffect(() => {
    if (isFixture) return;
    if (nightState.hydrated && nightState.plan === null) router.replace('/plan');
  }, [isFixture, nightState.hydrated, nightState.plan, router]);

  useEffect(() => {
    let cancelled = false;
    let created: NightSessionHandle | null = null;

    void (async () => {
      if (isFixture) {
        created = startNightFixture(locale);
      } else if (nightState.hydrated && nightState.plan !== null) {
        created = await startNightSession(nightState);
      } else {
        return;
      }
      if (cancelled) {
        created.dispose();
        return;
      }
      setHandle(created);
      setStats(created.getStats());
    })();

    return () => {
      cancelled = true;
      created?.dispose();
    };
    // Boots once the plan/hydration/fixture inputs are ready — re-running on every
    // `stats` tick would restart the night, which is exactly the bug this guards against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFixture, nightState.hydrated, nightState.plan, locale]);

  useEffect(() => {
    if (!handle) return undefined;
    return handle.subscribe(() => setStats(handle.getStats()));
  }, [handle]);

  async function onHoldStop(): Promise<void> {
    if (!handle || stopping.current) return;
    stopping.current = true;
    await handle.stop();
    // The real "I'm awake" morning flow is WO L3.1 — until it exists, hold-to-stop lands
    // back on the tab shell rather than a dead-end screen (WO's own "or back to tabs").
    router.replace('/(tabs)');
  }

  const pRemPercent = stats?.pRem == null ? null : Math.round(stats.pRem * 100);
  const showRemChip = stats != null && stats.pRem != null && stats.pRem >= 0.5;
  const liveKey = (stats ? LIVE_TEXT_KEYS[stats.state] : LIVE_TEXT_KEYS.IDLE) as TranslationKey;
  const cuesText =
    !stats || stats.cuesPlayed === 0
      ? t('night.cues.none')
      : t('night.cues.line', {
          n: stats.cuesPlayed,
          status: t(stats.anyCueWoke ? 'night.cues.status.woke' : 'night.cues.status.notWoke'),
        });

  return (
    <Screen
      testID="screen-night"
      withTabBarInset={false}
      night
      footer={
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('night.hold.label')}
            onLongPress={() => void onHoldStop()}
            delayLongPress={1000}
            disabled={!handle}
            style={({ pressed }) => [pressed && styles.holdPressed]}
            testID="night-hold-stop"
          >
            <GlassSurface tint="clear" background={night.btnDg} night radius={radius.btn} contentStyle={styles.holdSurface}>
              <Text style={[typeScale.buttonBig, { color: night.btnDgText }]}>{t('night.hold.label')}</Text>
            </GlassSurface>
          </Pressable>
          <Text style={[typeScale.label, styles.holdHint]}>{t('night.hold.hint')}</Text>
        </View>
      }
    >
      <View style={styles.topRow}>
        <Text style={[typeScale.sub, styles.topText]}>
          {formatClock(stats?.nowIso ?? null)} · {t(liveKey)}
        </Text>
        <View style={styles.sp} />
        {showRemChip ? <Chip label={t('night.chip.remLikely')} tone="rem" size="sm" night testID="night-rem-chip" /> : null}
      </View>

      {stats?.timerFallback ? (
        <View style={styles.timerChipRow}>
          <Chip label={t('night.timerFallback')} size="sm" night testID="night-timer-fallback" />
        </View>
      ) : null}

      <View style={styles.orbWrap}>
        <Orb percent={pRemPercent} label={t('night.orb.label')} testID="night-orb" />
      </View>

      <View style={styles.statsRow}>
        <StatCard
          label={t('night.stat.heart')}
          value={stats?.hrBpm == null ? '—' : t('night.stat.heart.value', { n: Math.round(stats.hrBpm) })}
          testID="night-stat-heart"
        />
        <StatCard label={t('night.stat.still')} value={t('night.stat.still.value', { n: stats?.stillMin ?? 0 })} testID="night-stat-still" />
        <StatCard label={t('night.stat.asleep')} value={formatHm(stats?.sleptForSec ?? null)} testID="night-stat-asleep" />
      </View>

      <Text style={[typeScale.sub, styles.cuesLine]} testID="night-cues-line">
        {cuesText}
      </Text>
    </Screen>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  testID?: string;
}

function StatCard({ label, value, testID }: StatCardProps) {
  return (
    <GlassSurface tint="regular" night radius={radius.card} contentStyle={styles.statCard} testID={testID}>
      <Text style={[typeScale.label, styles.statLabel]}>{label}</Text>
      <Text style={[typeScale.h2, styles.statValue]} numberOfLines={1}>
        {value}
      </Text>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center' },
  topText: { color: night.sub },
  sp: { flex: 1 },
  timerChipRow: { alignItems: 'flex-start' },
  orbWrap: { alignItems: 'center', paddingVertical: spacing.xxl },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, alignItems: 'center', gap: 5 },
  statLabel: { color: night.mut, textTransform: 'none' },
  statValue: { color: night.text },
  cuesLine: { textAlign: 'center', color: night.sub, marginTop: spacing.lg },
  holdSurface: { height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: radius.btn },
  holdPressed: { opacity: 0.85 },
  holdHint: { textAlign: 'center', color: night.mut, marginTop: spacing.sm },
});

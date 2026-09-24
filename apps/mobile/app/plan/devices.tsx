/**
 * Check devices — step 1/3 of the pre-start flow (WO L1.7ui, mockup `04-dream-plan.png`
 * frame b · DESIGN §3.2 step 3). Same 3-category layout as `onboarding/devices.tsx`
 * (WO L1.3) — that screen never blocks (pairing does not exist yet in Phase 1); **this**
 * screen is the real per-night gate `readiness.ts` was written for: the "next · test
 * left ear" button is enabled only when `evaluateReadiness` says the device half of
 * tonight is actually ready (heart + audio + phone battery + Do Not Disturb).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  evaluateReadiness,
  summarizeDevices,
  AUDIO_HOURS_PER_FULL_CHARGE,
  type DeviceCategory,
  type DeviceEntry,
  type ReadinessReason,
} from '@lucid/engine';

import { applyDeviceFoundFixture, applyPlanFixture, fixturePhoneStatus } from '../../src/dev/fixtures';
import {
  HEADPHONES_DEVICE_ID,
  WATCH_DEVICE_ID,
  deviceRegistry,
  refreshDevicesFromPlatform,
} from '../../src/devices/registry';
import { useT, type TranslationKey } from '../../src/i18n';
import { getPlatform } from '../../src/platform';
import { dndAllowsAppAudio } from '../../src/platform/dnd';
import { useNightState } from '../../src/store/night';
import {
  Button,
  Chip,
  GlassCard,
  Icon,
  Screen,
  StepNav,
  colors,
  radius,
  spacing,
} from '../../src/ui';

const HEART_SEARCH_KEYS: TranslationKey[] = [
  'onboarding.devices.search.heart.chestStrap',
  'onboarding.devices.search.heart.armband',
  'onboarding.devices.search.heart.mattress',
];
const AUDIO_SEARCH_KEYS: TranslationKey[] = [
  'onboarding.devices.search.audio.bluetooth',
  'onboarding.devices.search.audio.speaker',
];

type SearchableCategory = 'HEART' | 'AUDIO';

const BLOCKER_KEY: Partial<Record<ReadinessReason, TranslationKey>> = {
  HEART_NONE: 'ready.blocker.HEART_NONE',
  HEART_STALE: 'ready.blocker.HEART_STALE',
  AUDIO_NONE: 'ready.blocker.AUDIO_NONE',
  AUDIO_BATTERY: 'ready.blocker.AUDIO_BATTERY',
  PHONE_BATTERY: 'ready.blocker.PHONE_BATTERY',
  DND_BLOCKS: 'ready.blocker.DND_BLOCKS',
};

/** Re-check the platform every few seconds while this screen is open — a watch/headphone
 * pairing that completes, or a phone that starts charging, should unlock the footer
 * without the user having to leave and come back. Also what keeps a `?fixture=devices`
 * entry's `lastDataAt` inside `HEART_DATA_MAX_AGE_SEC` (10 s) for as long as the screen
 * stays open, since the fixture is a one-time snapshot otherwise. */
const REFRESH_MS = 3000;

export default function PlanDevicesScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const { plan, earTests, hydrated } = useNightState();

  const [devices, setDevices] = useState<DeviceEntry[]>(() => deviceRegistry.list());
  const [searchCategory, setSearchCategory] = useState<SearchableCategory | null>(null);
  const [phone, setPhone] = useState<{ charging: boolean; battery: number } | null>(null);
  const [dndOk, setDndOk] = useState<boolean>(true);

  // `?fixture=devices`/`?fixture=ear-passed` (WO L1.7ui QC parity) — lets this screen be
  // screenshotted directly by URL without visiting `/plan` first. No-op once a real plan
  // exists.
  useEffect(() => {
    applyPlanFixture(locale);
  }, [locale]);

  useEffect(() => {
    function tick(): void {
      refreshDevicesFromPlatform();
      applyDeviceFoundFixture();
      setDevices(deviceRegistry.list());
    }
    tick();
    const unsubscribe = deviceRegistry.subscribe(setDevices);
    const interval = setInterval(tick, REFRESH_MS);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function readPhone(): Promise<void> {
      const fixture = fixturePhoneStatus();
      if (fixture) {
        if (!cancelled) setPhone(fixture);
        return;
      }
      const sample = await getPlatform().battery.sample('PHONE');
      if (cancelled) return;
      if (sample) {
        setPhone({ charging: sample.state === 'CHARGING' || sample.state === 'FULL', battery: sample.level });
      } else {
        setPhone(null);
      }
    }
    void readPhone();
    const interval = setInterval(() => void readPhone(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    void dndAllowsAppAudio().then(setDndOk);
  }, []);

  useEffect(() => {
    if (hydrated && !plan) router.replace('/plan');
  }, [hydrated, plan, router]);

  const summary = useMemo(() => summarizeDevices(devices), [devices]);
  const summaryOf = (category: DeviceCategory) =>
    summary.find((entry) => entry.category === category) ?? {
      category,
      required: category !== 'EYE',
      found: 0,
      connected: 0,
      ok: category === 'EYE',
    };
  const heartSummary = summaryOf('HEART');
  const audioSummary = summaryOf('AUDIO');
  const heartDevices = devices.filter((entry) => entry.category === 'HEART' && entry.connected);
  const audioDevices = devices.filter((entry) => entry.category === 'AUDIO' && entry.connected);

  const readiness = useMemo(() => {
    const now = new Date();
    const wakeAt = new Date(now.getTime() + 8 * 3600 * 1000); // no wake-time setting exists yet (debt, see wo-notes)
    return evaluateReadiness({
      devices,
      phone: phone ?? { charging: false, battery: 0 },
      dndAllowsAppAudio: dndOk,
      nowIso: now.toISOString(),
      wakeAtIso: wakeAt.toISOString(),
      earTests,
    });
  }, [devices, phone, dndOk, earTests]);

  const devicesOk = readiness.nextStep !== 'FIX_DEVICES';
  const blockerKey = readiness.firstBlocker ? BLOCKER_KEY[readiness.firstBlocker] : undefined;

  if (!hydrated || !plan) return <Screen testID="screen-plan-devices" withTabBarInset={false} />;

  function heartSubtitle(entry: DeviceEntry): string {
    const parts = [t('onboarding.devices.status.connected')];
    if (entry.id === WATCH_DEVICE_ID) parts.push(t('onboarding.devices.status.watchDetail'));
    if (entry.battery !== null) parts.push(t('onboarding.devices.status.battery', { battery: Math.round(entry.battery * 100) }));
    return parts.join(' · ');
  }

  function audioSubtitle(entry: DeviceEntry): string {
    if (entry.battery === null) {
      const parts = [t('onboarding.devices.status.connected')];
      if (entry.id === HEADPHONES_DEVICE_ID) parts.push(t('onboarding.devices.status.headphonesDetail'));
      return parts.join(' · ');
    }
    const hours = Math.round(entry.battery * AUDIO_HOURS_PER_FULL_CHARGE);
    return t('ready.devices.audio.hours', { battery: Math.round(entry.battery * 100), hours });
  }

  return (
    <Screen
      testID="screen-plan-devices"
      withTabBarInset={false}
      footer={
        devicesOk ? (
          <Button
            label={t('ready.footer.next')}
            tone="pri"
            size="big"
            block
            onPress={() => router.push('/plan/ear-left')}
            testID="ready-devices-next"
          />
        ) : (
          <Button
            label={blockerKey ? t(blockerKey) : t('ready.devices.summary.blocked')}
            tone="dg"
            size="big"
            block
            disabled
            testID="ready-devices-next"
          />
        )
      }
    >
      <StepNav title={t('ready.devices.nav.title')} step={t('ready.devices.step')} onBack={() => router.back()} testID="ready-devices-nav" />

      <View style={styles.summaryRow}>
        <Chip
          label={
            devicesOk
              ? t('ready.devices.summary', { heart: heartSummary.connected, audio: audioSummary.connected })
              : t('ready.devices.summary.blocked')
          }
          tone={devicesOk ? 'rem' : 'dg'}
          testID="ready-devices-summary"
        />
      </View>

      <CategoryCard emoji="💓" title={t('onboarding.devices.heart.title')} badge={t('onboarding.devices.heart.required')} testID="ready-category-heart">
        {heartSummary.connected > 0 ? (
          heartDevices.map((entry, index) => (
            <DeviceRow key={entry.id} name={entry.name} sub={heartSubtitle(entry)} connected first={index === 0} />
          ))
        ) : (
          <DeviceRow name={t('onboarding.devices.heart.empty.title')} sub={t('onboarding.devices.heart.empty.sub')} muted first />
        )}
        <SearchOtherRow label={t('onboarding.devices.searchOther')} onPress={() => setSearchCategory('HEART')} testID="ready-search-heart" />
      </CategoryCard>

      <CategoryCard emoji="🎧" title={t('onboarding.devices.audio.title')} badge={t('onboarding.devices.audio.required')} testID="ready-category-audio">
        {audioSummary.connected > 0 ? (
          audioDevices.map((entry, index) => (
            <DeviceRow key={entry.id} name={entry.name} sub={audioSubtitle(entry)} connected first={index === 0} />
          ))
        ) : (
          <DeviceRow name={t('onboarding.devices.audio.empty.title')} sub={t('onboarding.devices.audio.empty.sub')} muted first />
        )}
        <SearchOtherRow label={t('onboarding.devices.searchOther')} onPress={() => setSearchCategory('AUDIO')} testID="ready-search-audio" />
      </CategoryCard>

      <CategoryCard emoji="👁" title={t('onboarding.devices.eye.title')} badge={t('onboarding.devices.eye.optional')} dimmed testID="ready-category-eye">
        <DeviceRow name={t('onboarding.devices.eye.empty.title')} sub={t('onboarding.devices.eye.empty.sub')} muted first last />
      </CategoryCard>

      <GlassCard noPadding testID="ready-phone-card">
        <View style={styles.phoneHeader}>
          <Text style={styles.phoneEmoji}>📱</Text>
          <Text style={styles.phoneTitle}>{t('ready.devices.phone.title')}</Text>
        </View>
        <PhoneLine
          ok={phone !== null && (phone.charging || phone.battery >= 0.5)}
          text={
            phone !== null
              ? phone.charging
                ? t('ready.devices.phone.charging', { battery: Math.round(phone.battery * 100) })
                : t('ready.devices.phone.onBattery', { battery: Math.round(phone.battery * 100) })
              : t('common.unknown')
          }
          first
        />
        <PhoneLine ok={dndOk} text={t('ready.devices.phone.dnd')} last />
      </GlassCard>

      <DeviceSearchSheet category={searchCategory} onClose={() => setSearchCategory(null)} />
    </Screen>
  );
}

interface CategoryCardProps {
  emoji: string;
  title: string;
  badge: string;
  dimmed?: boolean;
  children: ReactNode;
  testID?: string;
}

/** Same shape as `onboarding/devices.tsx`'s `CategoryCard` (WO L1.3) — duplicated rather
 * than imported since that file is a screen component, not a shared module; a follow-up
 * WO could hoist both into one `src/devices/CategoryCard.tsx` (noted in wo-notes). */
function CategoryCard({ emoji, title, badge, dimmed = false, children, testID }: CategoryCardProps) {
  return (
    <GlassCard noPadding style={dimmed ? { opacity: 0.5 } : undefined} testID={testID}>
      <View style={styles.categoryHeader}>
        <Text style={styles.categoryEmoji}>{emoji}</Text>
        <Text style={styles.categoryTitle}>{title}</Text>
        <Text style={styles.categoryBadge}>{badge}</Text>
      </View>
      {children}
    </GlassCard>
  );
}

interface DeviceRowProps {
  name: string;
  sub?: string;
  muted?: boolean;
  connected?: boolean;
  first?: boolean;
  last?: boolean;
}

function DeviceRow({ name, sub, muted = false, connected = false, first = false, last = false }: DeviceRowProps) {
  return (
    <View style={[styles.deviceRow, { paddingBottom: last ? spacing.md : 0, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.deviceName, { color: muted ? colors.mut : colors.ink }]}>{name}</Text>
        {sub ? <Text style={styles.deviceSub}>{sub}</Text> : null}
      </View>
      <View style={[styles.dot, { backgroundColor: connected ? colors.rem : colors.mut }, connected ? styles.dotOn : styles.dotOff]} />
    </View>
  );
}

interface SearchOtherRowProps {
  label: string;
  onPress: () => void;
  testID?: string;
}

function SearchOtherRow({ label, onPress, testID }: SearchOtherRowProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID}>
      <View style={styles.searchRow}>
        <Icon name="plus" size={15} color={colors.acc} strokeWidth={2.2} />
        <Text style={[styles.deviceName, { flex: 1 }]}>{label}</Text>
        <Icon name="chevronRight" size={14} color={colors.mut} />
      </View>
    </Pressable>
  );
}

interface PhoneLineProps {
  ok: boolean;
  text: string;
  first?: boolean;
  last?: boolean;
}

function PhoneLine({ ok, text, first = false, last = false }: PhoneLineProps) {
  return (
    <View
      style={[
        styles.phoneLine,
        { borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, paddingBottom: last ? spacing.md : spacing.xs },
      ]}
    >
      <Icon name={ok ? 'check' : 'x'} size={13} color={ok ? colors.rem : colors.dg} />
      <Text style={styles.phoneLineText}>{text}</Text>
    </View>
  );
}

interface DeviceSearchSheetProps {
  category: SearchableCategory | null;
  onClose: () => void;
}

/** Same "coming soon" placeholder as `onboarding/devices.tsx` — BLE scanning is L2.3. */
function DeviceSearchSheet({ category, onClose }: DeviceSearchSheetProps) {
  const { t } = useT();
  if (!category) return null;
  const keys = category === 'HEART' ? HEART_SEARCH_KEYS : AUDIO_SEARCH_KEYS;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="ready-device-search-sheet">
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityRole="button">
        <Pressable onPress={() => undefined}>
          <GlassCard style={{ margin: spacing.lg, borderRadius: radius.card }} title={t('onboarding.devices.search.title')}>
            {keys.map((key) => (
              <View key={key} style={styles.sheetRow}>
                <Text style={{ fontSize: 14, color: colors.ink }}>{t(key)}</Text>
                <Chip label={t('onboarding.devices.search.comingSoon')} size="sm" disabled />
              </View>
            ))}
            <Button tone="gh" block label={t('common.close')} onPress={onClose} testID="ready-device-search-close" />
          </GlassCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row' },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  categoryEmoji: { fontSize: 17, width: 22, textAlign: 'center' },
  categoryTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  categoryBadge: { fontSize: 11.5, fontWeight: '500', color: colors.mut },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderTopColor: colors.hairline,
  },
  deviceName: { fontSize: 13.5, fontWeight: '600' },
  deviceSub: { fontSize: 11.5, lineHeight: 15, marginTop: 1, color: colors.mut },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotOn: { shadowColor: colors.rem, shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
  dotOff: { opacity: 0.6 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  phoneHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  phoneEmoji: { fontSize: 15 },
  phoneTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  phoneLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    borderTopColor: colors.hairline,
  },
  phoneLineText: { fontSize: 12.5, color: colors.ink2, flex: 1 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(17,19,24,0.35)', justifyContent: 'flex-end' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
});

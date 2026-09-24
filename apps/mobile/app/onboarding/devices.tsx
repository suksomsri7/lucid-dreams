import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { summarizeDevices, type DeviceCategory, type DeviceEntry } from '@lucid/engine';

import { applyDeviceFoundFixture } from '../../src/dev/fixtures';
import { useT, type TranslationKey } from '../../src/i18n';
import {
  HEADPHONES_DEVICE_ID,
  WATCH_DEVICE_ID,
  deviceRegistry,
  refreshDevicesFromPlatform,
} from '../../src/devices/registry';
import { completeOnboarding } from '../../src/store/onboarding';
import { Button, Chip, GlassCard, Icon, Screen, Sub, Title, colors, radius, spacing } from '../../src/ui';

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

/**
 * Onboarding screen (b) — 3 device categories (DESIGN §4-01(b) · §3.2 step 3 · mockup
 * `01-onboarding.png` right frame / `01-onboarding.body.html`). Ear testing is
 * deliberately **not** here — the mockup's own caption says it moved to happen before
 * every night (L1.6), and the WO deliverables list for this file matches that, not the
 * stale ear-test-with-a-volume-slider line still sitting in `APP-RUN.md` §2's L1.3
 * one-line summary (see the disagreement note in `ledger/wo-notes/L1.3.md`).
 *
 * The "ready" button (`t('onboarding.devices.ready')`) is never blocked on device
 * counts here: pairing itself does not exist yet in Phase 1 (Watch link is L2.2, BLE is
 * L2.3), so a hard gate on this screen would make onboarding impossible to finish on a
 * fresh install. The real per-night gate (`readiness.ts`, `DeviceRegistry`-shaped) is
 * APP-RUN §2 L1.7's job.
 */
export default function OnboardingDevicesScreen() {
  const { t } = useT();
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceEntry[]>(() => deviceRegistry.list());
  const [searchCategory, setSearchCategory] = useState<SearchableCategory | null>(null);

  useEffect(() => {
    refreshDevicesFromPlatform();
    // Web-only QC fixture (`?fixture=devices`, Fable parity review) — no-op everywhere
    // else, see `src/dev/fixtures.ts`. Runs after the real platform read so it wins.
    applyDeviceFoundFixture();
    setDevices(deviceRegistry.list());
    return deviceRegistry.subscribe(setDevices);
  }, []);

  // `summarizeDevices` (packages/engine/src/devices.ts) is the one place that decides
  // "does this category count as found" — the screen reads its `connected` count rather
  // than re-deriving the same thing from `devices.filter(...)`, so the engine stays the
  // single source of truth (same reasoning `readiness.ts`, L1.7, will reuse this for).
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

  function deviceSubtitle(entry: DeviceEntry): string {
    const parts = [t('onboarding.devices.status.connected')];
    if (entry.id === WATCH_DEVICE_ID) parts.push(t('onboarding.devices.status.watchDetail'));
    if (entry.id === HEADPHONES_DEVICE_ID) parts.push(t('onboarding.devices.status.headphonesDetail'));
    if (entry.battery !== null) parts.push(t('onboarding.devices.status.battery', { battery: Math.round(entry.battery * 100) }));
    return parts.join(' · ');
  }

  const handleReady = () => {
    completeOnboarding();
    router.replace('/');
  };

  return (
    <Screen
      testID="screen-onboarding-devices"
      withTabBarInset={false}
      footer={
        <Button
          testID="onboarding-devices-ready"
          tone="pri"
          block
          size="big"
          label={t('onboarding.devices.ready')}
          onPress={handleReady}
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Title style={{ flex: 1 }}>{t('onboarding.devices.title')}</Title>
        <Text style={{ fontSize: 11.5, fontWeight: '500', color: colors.mut }}>{t('onboarding.devices.step')}</Text>
      </View>
      <Sub style={{ marginTop: -6, lineHeight: 19 }}>{t('onboarding.devices.subtitle')}</Sub>

      <CategoryCard
        emoji="💓"
        title={t('onboarding.devices.heart.title')}
        badge={t('onboarding.devices.heart.required')}
        testID="onboarding-category-heart"
      >
        {heartSummary.connected > 0 ? (
          heartDevices.map((entry, index) => (
            <DeviceRow key={entry.id} name={entry.name} sub={deviceSubtitle(entry)} connected first={index === 0} />
          ))
        ) : (
          <DeviceRow
            name={t('onboarding.devices.heart.empty.title')}
            sub={t('onboarding.devices.heart.empty.sub')}
            muted
            first
          />
        )}
        <SearchOtherRow
          label={t('onboarding.devices.searchOther')}
          sub={t('onboarding.devices.searchOther.heartHint')}
          onPress={() => setSearchCategory('HEART')}
          testID="onboarding-search-heart"
        />
      </CategoryCard>

      <CategoryCard
        emoji="🎧"
        title={t('onboarding.devices.audio.title')}
        badge={t('onboarding.devices.audio.required')}
        testID="onboarding-category-audio"
      >
        {audioSummary.connected > 0 ? (
          audioDevices.map((entry, index) => (
            <DeviceRow key={entry.id} name={entry.name} sub={deviceSubtitle(entry)} connected first={index === 0} />
          ))
        ) : (
          <DeviceRow
            name={t('onboarding.devices.audio.empty.title')}
            sub={t('onboarding.devices.audio.empty.sub')}
            muted
            first
          />
        )}
        <SearchOtherRow
          label={t('onboarding.devices.searchOther')}
          onPress={() => setSearchCategory('AUDIO')}
          testID="onboarding-search-audio"
        />
      </CategoryCard>

      <CategoryCard
        emoji="👁"
        title={t('onboarding.devices.eye.title')}
        badge={t('onboarding.devices.eye.optional')}
        dimmed
        testID="onboarding-category-eye"
      >
        <DeviceRow name={t('onboarding.devices.eye.empty.title')} sub={t('onboarding.devices.eye.empty.sub')} muted first last />
      </CategoryCard>

      <GlassCard variant="soft" contentStyle={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
        <View style={{ marginTop: 2 }}>
          <Icon name="info" size={15} color={colors.mut} />
        </View>
        <Sub style={{ flex: 1, lineHeight: 17 }}>{t('onboarding.devices.info')}</Sub>
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

/** `.card.p0.cat` — emoji + title + badge header, then a list of `.li` rows (mockup 01(b)). */
function CategoryCard({ emoji, title, badge, dimmed = false, children, testID }: CategoryCardProps) {
  return (
    <GlassCard noPadding style={dimmed ? { opacity: 0.5 } : undefined} testID={testID}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Text style={{ fontSize: 17, width: 22, textAlign: 'center' }}>{emoji}</Text>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink }}>{title}</Text>
        <Text style={{ fontSize: 11.5, fontWeight: '500', color: colors.mut }}>{badge}</Text>
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

/** `.cat .li` + `.dot9` — one found (or empty-state) device row. */
function DeviceRow({ name, sub, muted = false, connected = false, first = false, last = false }: DeviceRowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 48,
        paddingHorizontal: spacing.lg,
        paddingBottom: last ? spacing.md : 0,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.hairline,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '600', color: muted ? colors.mut : colors.ink }}>{name}</Text>
        {sub ? (
          <Text style={{ fontSize: 11.5, lineHeight: 15, marginTop: 1, color: colors.mut }}>{sub}</Text>
        ) : null}
      </View>
      <View
        style={[
          { width: 9, height: 9, borderRadius: 5, backgroundColor: connected ? colors.rem : colors.mut },
          connected
            ? { shadowColor: colors.rem, shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } }
            : { opacity: 0.6 },
        ]}
      />
    </View>
  );
}

interface SearchOtherRowProps {
  label: string;
  sub?: string;
  onPress: () => void;
  testID?: string;
}

/** `.cat .li` with `.pl` plus icon + `.cv` chevron — opens the "not built yet" sheet. */
function SearchOtherRow({ label, sub, onPress, testID }: SearchOtherRowProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: 48,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
        }}
      >
        <Icon name="plus" size={15} color={colors.acc} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink }}>{label}</Text>
          {sub ? <Text style={{ fontSize: 11.5, lineHeight: 15, marginTop: 1, color: colors.mut }}>{sub}</Text> : null}
        </View>
        <Icon name="chevronRight" size={14} color={colors.mut} />
      </View>
    </Pressable>
  );
}

interface DeviceSearchSheetProps {
  category: SearchableCategory | null;
  onClose: () => void;
}

/**
 * The "find another device" row opens this — not in the mockup (which only shows the
 * happy path), but the WO asks for it and BLE scanning does not exist until L2.3, so
 * every option is shown with a "coming soon" chip instead of being a dead tap.
 */
function DeviceSearchSheet({ category, onClose }: DeviceSearchSheetProps) {
  const { t } = useT();
  if (!category) return null;
  const keys = category === 'HEART' ? HEART_SEARCH_KEYS : AUDIO_SEARCH_KEYS;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="onboarding-device-search-sheet">
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(17,19,24,0.35)', justifyContent: 'flex-end' }}
        onPress={onClose}
        accessibilityRole="button"
      >
        {/* A no-op `onPress` claims the touch responder for taps inside the panel, so they
            never bubble to the backdrop `Pressable` above and close the sheet by accident. */}
        <Pressable onPress={() => undefined}>
          <GlassCard style={{ margin: spacing.lg, borderRadius: radius.card }} title={t('onboarding.devices.search.title')}>
            {keys.map((key) => (
              <View
                key={key}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm }}
              >
                <Text style={{ fontSize: 14, color: colors.ink }}>{t(key)}</Text>
                <Chip label={t('onboarding.devices.search.comingSoon')} size="sm" disabled />
              </View>
            ))}
            <Button tone="gh" block label={t('common.close')} onPress={onClose} testID="onboarding-device-search-close" />
          </GlassCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * "Find another device" — the page behind the `+` row on both devices screens (WO L2.3, replacing
 * the "coming soon" sheet L1.3 left as debt D-4).
 *
 * What it does, in the order the user experiences it:
 *   1. asks the radio whether it can scan at all (off / not allowed / no BLE → one honest line,
 *      and it keeps re-checking, so turning Bluetooth on makes the list appear by itself);
 *   2. scans for `0x180D` (heart rate) + `0x180F` (battery) advertisers and lists what it hears,
 *      strongest signal first, with a guess at what kind of device each one is;
 *   3. on a tap, and **only** on a tap, bonds to that one device (APP-RUN §0.5 S8) and starts
 *      streaming from it — after which it shows up in the 💓 category of the devices page with a
 *      live heart rate;
 *   4. offers "phone on the mattress" as the no-device fallback, with the one instruction that makes it
 *      work (on the mattress, not under the pillow).
 *
 * **Parity**: there is no mockup for this page. It follows the device-card language of
 * `04-dream-plan.png` frame b exactly — glass card, emoji + title + right-aligned badge header,
 * rows of `name` over a muted detail line with a state dot on the right — so it reads as the
 * same screen the `+` row came from. QC shot: `/plan/find-devices?fixture=ble` (TH).
 *
 * It lives under `app/plan/` because that is where the `+` row is, but it deliberately does
 * **not** require tonight's plan (unlike its siblings): the same page is reachable from the
 * onboarding devices screen, which runs before any plan exists.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { applyBleSelectFixture, bleFixtureRequested, fixtureBleScanResults } from '../../src/dev/fixtures';
import { setPhoneOnMattress, useSensorPrefs } from '../../src/devices/prefs';
import { refreshDevicesFromPlatform } from '../../src/devices/registry';
import { useT, type TranslationKey } from '../../src/i18n';
import { getPlatform } from '../../src/platform';
import type { BleAvailability, BleScanResult, Unsubscribe } from '../../src/platform';
import {
  Button,
  GlassCard,
  Icon,
  Screen,
  StepNav,
  Switch,
  colors,
  spacing,
} from '../../src/ui';

/** How often the page re-asks the radio while it is off/unauthorised, so the user never has to come back. */
const RECHECK_MS = 4000;

const AVAILABILITY_KEY: Record<Exclude<BleAvailability, 'READY'>, TranslationKey> = {
  OFF: 'find.bluetooth.off',
  UNAUTHORIZED: 'find.bluetooth.unauthorized',
  UNSUPPORTED: 'find.bluetooth.unsupported',
};

/**
 * Which kind of device this is, guessed from the advertised name — the profile itself does not
 * say. Only used for the grey sub-line: the guess being wrong costs the user nothing, while
 * showing a bare MAC-like id would cost them the ability to tell two straps apart.
 */
function guessKindKey(name: string | null): TranslationKey {
  const lower = (name ?? '').toLowerCase();
  if (/verity|oh1|sense|armband|rhythm|band/.test(lower)) return 'find.kind.armband';
  if (/h10|h9|h7|hrm|strap|tickr|dual|chest/.test(lower)) return 'find.kind.chestStrap';
  return 'find.kind.unknown';
}

export default function FindDevicesScreen() {
  const { t } = useT();
  const router = useRouter();
  const prefs = useSensorPrefs();

  const [availability, setAvailability] = useState<BleAvailability | null>(null);
  const [results, setResults] = useState<BleScanResult[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  // Scan. Re-runs on `attempt`, which the re-check timer below bumps while the radio is not
  // usable — so "Bluetooth was off and the user turned it on" needs no tap to recover.
  useEffect(() => {
    if (bleFixtureRequested()) {
      setAvailability('READY');
      setResults(fixtureBleScanResults());
      return;
    }

    let cancelled = false;
    let stopScan: Unsubscribe | null = null;

    void (async () => {
      const ble = getPlatform().bleHeartRate;
      let state: BleAvailability;
      try {
        state = await ble.availability();
      } catch {
        state = 'UNSUPPORTED';
      }
      if (cancelled) return;
      setAvailability(state);
      if (state !== 'READY') return;
      try {
        stopScan = await ble.scan((found) => {
          if (!cancelled) setResults(found);
        });
      } catch {
        if (!cancelled) setAvailability('UNSUPPORTED');
      }
    })();

    return () => {
      cancelled = true;
      stopScan?.();
    };
  }, [attempt]);

  useEffect(() => {
    if (availability === 'READY' || availability === 'UNSUPPORTED') return undefined;
    const interval = setInterval(() => setAttempt((value) => value + 1), RECHECK_MS);
    return () => clearInterval(interval);
  }, [availability]);

  const pick = useCallback(async (device: BleScanResult) => {
    setFailedId(null);
    setBusyId(device.id);
    try {
      // The web QC bundle has no radio: `select()` would throw `NotImplementedError` there, so
      // the fixture records the same bond the real call would have recorded and stops here.
      if (!applyBleSelectFixture({ id: device.id, name: device.name })) {
        await getPlatform().bleHeartRate.select({ id: device.id, name: device.name });
      }
      refreshDevicesFromPlatform();
    } catch {
      setFailedId(device.id);
    } finally {
      setBusyId(null);
    }
  }, []);

  const forget = useCallback(async () => {
    try {
      await getPlatform().bleHeartRate.forget();
    } catch {
      // No radio (web) — the stored bond is what matters and `forget()` clears it either way.
    }
    refreshDevicesFromPlatform();
  }, []);

  const toggleMattress = useCallback((enabled: boolean) => {
    setPhoneOnMattress(enabled);
    refreshDevicesFromPlatform();
  }, []);

  function rowSubtitle(device: BleScanResult): string {
    const kind = t(guessKindKey(device.name));
    if (prefs.ble?.id === device.id) return t('find.connected');
    if (busyId === device.id) return t('find.connecting');
    if (failedId === device.id) return t('find.failed');
    return device.rssi === null
      ? t('find.signal.unknown', { kind })
      : t('find.signal', { kind, rssi: device.rssi });
  }

  const blockerKey = availability !== null && availability !== 'READY' ? AVAILABILITY_KEY[availability] : null;

  return (
    <Screen
      testID="screen-find-devices"
      withTabBarInset={false}
      footer={
        <Button
          label={t('find.done')}
          tone="pri"
          size="big"
          block
          onPress={() => router.back()}
          testID="find-done"
        />
      }
    >
      <StepNav
        title={t('find.nav.title')}
        step={t('find.nav.step')}
        onBack={() => router.back()}
        testID="find-nav"
      />

      <SectionCard
        emoji="💓"
        title={t('find.found.title')}
        badge={blockerKey ? '' : t('find.scanning')}
        testID="find-results"
      >
        {blockerKey ? (
          <DeviceRow name={t(blockerKey)} muted first last />
        ) : results.length === 0 ? (
          <DeviceRow name={t('find.empty.title')} sub={t('find.empty.sub')} muted first last />
        ) : (
          results.map((device, index) => (
            <Pressable
              key={device.id}
              accessibilityRole="button"
              onPress={() => void pick(device)}
              testID={`find-device-${index}`}
            >
              <DeviceRow
                name={device.name ?? t('find.kind.unknown')}
                sub={rowSubtitle(device)}
                connected={prefs.ble?.id === device.id}
                first={index === 0}
                last={index === results.length - 1 && prefs.ble === null}
                chevron={prefs.ble?.id !== device.id}
              />
            </Pressable>
          ))
        )}
        {prefs.ble !== null ? (
          <Pressable accessibilityRole="button" onPress={() => void forget()} testID="find-forget">
            <View style={styles.forgetRow}>
              <Icon name="x" size={13} color={colors.mut} />
              <Text style={styles.forgetText}>{t('find.forget')}</Text>
            </View>
          </Pressable>
        ) : null}
      </SectionCard>

      {blockerKey === null ? <Text style={styles.hint}>{t('find.scan.hint')}</Text> : null}

      <SectionCard emoji="📱" title={t('find.mattress.title')} badge={t('find.mattress.note')} testID="find-mattress">
        <View style={styles.mattressRow}>
          <Text style={styles.mattressText}>{t('find.mattress.sub')}</Text>
          <Switch value={prefs.phoneOnMattress} onValueChange={toggleMattress} testID="find-mattress-switch" />
        </View>
      </SectionCard>
    </Screen>
  );
}

interface SectionCardProps {
  emoji: string;
  title: string;
  badge: string;
  children: ReactNode;
  testID?: string;
}

/** The card header of mockup `04-dream-plan.png` frame b: emoji · title · right-aligned badge. */
function SectionCard({ emoji, title, badge, children, testID }: SectionCardProps) {
  return (
    <GlassCard noPadding testID={testID}>
      <View style={styles.header}>
        <Text style={styles.headerEmoji}>{emoji}</Text>
        <Text style={styles.headerTitle}>{title}</Text>
        {badge ? <Text style={styles.headerBadge}>{badge}</Text> : null}
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
  chevron?: boolean;
  first?: boolean;
  last?: boolean;
}

/** Same row shape as `app/plan/devices.tsx`, so a device looks the same before and after bonding. */
function DeviceRow({
  name,
  sub,
  muted = false,
  connected = false,
  chevron = false,
  first = false,
  last = false,
}: DeviceRowProps) {
  return (
    <View
      style={[
        styles.deviceRow,
        { paddingBottom: last ? spacing.md : 0, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.deviceName, { color: muted ? colors.mut : colors.ink }]}>{name}</Text>
        {sub ? <Text style={styles.deviceSub}>{sub}</Text> : null}
      </View>
      {connected ? (
        <View style={[styles.dot, { backgroundColor: colors.rem }, styles.dotOn]} />
      ) : chevron ? (
        <Icon name="chevronRight" size={14} color={colors.mut} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerEmoji: { fontSize: 17, width: 22, textAlign: 'center' },
  headerTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  headerBadge: { fontSize: 11.5, fontWeight: '500', color: colors.mut },
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
  forgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  forgetText: { fontSize: 12.5, color: colors.mut, flex: 1 },
  hint: { fontSize: 12, lineHeight: 17, color: colors.mut, paddingHorizontal: spacing.xs },
  mattressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  mattressText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: colors.ink2 },
});

/**
 * "Find another device" — the one sheet behind every `+`/"find a device" row in the app
 * (WO L3.9 §C + §F, R1 hotfix #1).
 *
 * It replaces three near-copies that had drifted apart: the 🎧-only sheet in
 * `app/onboarding/devices.tsx`, its twin in `app/plan/devices.tsx`, and the five-row
 * "Coming soon" placeholder still sitting in Settings from L1.x — which is what the owner tapped
 * on TestFlight 0.1.0 (1) and found completely inert. Every row here **does** something:
 *
 * | row | what tapping it does |
 * |---|---|
 * | chest strap / armband | opens the real BLE scanner (`FindDevicesScreen`) |
 * | phone on the mattress | toggles `prefs.phoneOnMattress` — the no-device 💓 fallback |
 * | Bluetooth headphones | opens iOS Settings, where pairing actually happens |
 * | speaker | toggles `prefs.audioSpeaker` — the iPhone's own speaker as tonight's 🎧 device |
 *
 * ## Why the headphone row opens Settings instead of scanning
 *
 * Sleep headphones and speakers are **classic** Bluetooth (A2DP). `react-native-ble-plx` cannot
 * see them, and no iOS app may pair them on the user's behalf — so a scanner here would be a
 * spinner that can never find anything. `Linking.openSettings()` opens this app's own Settings page,
 * which is the only documented way in: the private Settings URL scheme that would jump straight to
 * the Bluetooth pane is an App Store rejection (APP-RUN §0.5) and is deliberately not used. Coming
 * back is enough — the devices screens refresh themselves on `AppState` 'active'
 * (`registry.ts#watchPlatformDevices`).
 */

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useT, type TranslationKey } from '../i18n';
import { Button, GlassCard, Icon, Switch, colors, radius, spacing } from '../ui';
import { setAudioSpeaker, setPhoneOnMattress, useSensorPrefs } from './prefs';
import { refreshDevicesFromPlatform } from './registry';

export interface DeviceSearchSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Which screen opened the sheet. Only used to pick the scanner route: during onboarding the
   * only reachable one is `/onboarding/find-devices`, because `app/_layout.tsx` bounces every
   * other path back to `/onboarding` (WO L3.9 §A).
   */
  origin: 'onboarding' | 'settings' | 'plan';
  testID?: string;
}

export function DeviceSearchSheet({ visible, onClose, origin, testID }: DeviceSearchSheetProps) {
  const { t } = useT();
  const router = useRouter();
  const prefs = useSensorPrefs();

  const openScanner = useCallback(() => {
    onClose();
    if (origin === 'onboarding') router.push('/onboarding/find-devices');
    else router.push('/plan/find-devices');
  }, [onClose, origin, router]);

  const openBluetoothSettings = useCallback(() => {
    // `openSettings()` does not exist on react-native-web (the QC bundle), and iOS can refuse to
    // open it — neither may take a sheet down with it, so both failure shapes are swallowed.
    try {
      void Linking.openSettings().catch(() => undefined);
    } catch {
      // no Settings app to open (web QC build)
    }
  }, []);

  const toggleMattress = useCallback((enabled: boolean) => {
    setPhoneOnMattress(enabled);
    refreshDevicesFromPlatform();
  }, []);

  const toggleSpeaker = useCallback((enabled: boolean) => {
    setAudioSpeaker(enabled);
    refreshDevicesFromPlatform();
  }, []);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID={testID ?? 'device-search-sheet'}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        {/* A no-op `onPress` claims the touch responder for taps inside the panel, so they never
            bubble to the backdrop above and close the sheet by accident. */}
        <Pressable onPress={() => undefined}>
          <GlassCard style={styles.card} title={t('onboarding.devices.search.title')}>
            <SheetRow
              label="devices.search.strap"
              hint="devices.search.strap.hint"
              onPress={openScanner}
              testID="device-search-strap"
            />
            <SheetRow
              label="devices.search.armband"
              hint="devices.search.armband.hint"
              onPress={openScanner}
              testID="device-search-armband"
            />
            <SheetRow
              label="devices.search.mattress"
              hint="devices.search.mattress.hint"
              value={prefs.phoneOnMattress}
              onValueChange={toggleMattress}
              testID="device-search-mattress"
            />
            <SheetRow
              label="devices.search.bluetooth"
              hint="onboarding.devices.search.audio.openSettings"
              onPress={openBluetoothSettings}
              testID="device-search-bluetooth"
            />
            <SheetRow
              label="devices.search.speaker"
              hint={
                prefs.audioSpeaker
                  ? 'onboarding.devices.search.audio.speakerOn'
                  : 'onboarding.devices.search.audio.speakerHint'
              }
              value={prefs.audioSpeaker}
              onValueChange={toggleSpeaker}
              testID="device-search-speaker"
              last
            />
            <Button tone="gh" block label={t('common.close')} onPress={onClose} testID="device-search-close" />
          </GlassCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface SheetRowProps {
  label: TranslationKey;
  hint: TranslationKey;
  /** A switch row: the preference's current value. Omitted ⇒ a tappable row with a chevron. */
  value?: boolean;
  onValueChange?: (next: boolean) => void;
  onPress?: () => void;
  last?: boolean;
  testID?: string;
}

/** One row: name over a muted one-line hint, with either a switch or a chevron on the right. */
function SheetRow({ label, hint, value, onValueChange, onPress, last = false, testID }: SheetRowProps) {
  const { t } = useT();
  const body = (
    <View style={[styles.row, last ? styles.rowLast : null]}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{t(label)}</Text>
        <Text style={styles.rowHint}>{t(hint)}</Text>
      </View>
      {value === undefined || onValueChange === undefined ? (
        <Icon name="chevronRight" size={14} color={colors.mut} />
      ) : (
        <Switch value={value} onValueChange={onValueChange} testID={testID ? `${testID}-switch` : undefined} />
      )}
    </View>
  );

  if (onPress === undefined) return <View testID={testID}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17,19,24,0.35)', justifyContent: 'flex-end' },
  card: { margin: spacing.lg, borderRadius: radius.card },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  rowHint: { fontSize: 11.5, lineHeight: 15, marginTop: 1, color: colors.mut },
});

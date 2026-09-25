import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DeviceCategory, DeviceEntry } from '@lucid/engine';
import { AUDIO_HOURS_PER_FULL_CHARGE, summarizeDevices } from '@lucid/engine';

import { applyDeviceFoundFixture } from '../../src/dev/fixtures';
import { getAnchorSeed, playAnchorOnce, resetAnchorSeed, buildAnchorSignature } from '../../src/audio/player';
import { deleteDevice } from '../../src/api/client';
import { DeviceSearchSheet } from '../../src/devices/DeviceSearchSheet';
import { deviceRegistry, refreshDevicesFromPlatform, watchPlatformDevices } from '../../src/devices/registry';
import { useLocale, useT } from '../../src/i18n';
import { scheduleDailyReminders } from '../../src/notifications';
import {
  DEFAULT_GUARD_HOURS,
  MAX_CUES_PER_NIGHT_SETTING,
  MAX_GUARD_HOURS,
  MAX_REALITY_CHECKS_PER_DAY,
  MIN_CUES_PER_NIGHT,
  MIN_GUARD_HOURS,
  MIN_REALITY_CHECKS_PER_DAY,
  setBoostNight,
  setControlNightsEnabled,
  setGuardHours,
  setMaxCuesPerNight,
  setRealityChecksPerDay,
  setStopAfterTwoWakes,
  setVolumeStart,
  useSettings,
  MAX_VOLUME_START,
  MIN_VOLUME_START,
} from '../../src/settings/store';
import { resetSettingsAfterDeleteAll } from '../../src/settings/store';
import { deleteEverythingLocal, exportAllData } from '../../src/settings/data';
import { resetOnboardingAfterDeleteAll, setConsentAi, useOnboardingState } from '../../src/store/onboarding';
import { clearNightPlan } from '../../src/store/night';
import { Button, GlassCard, Icon, Row, Screen, SectionLabel, Seg, Sub, Switch, Title, colors, radius, spacing, typeScale } from '../../src/ui';

/** Re-checked whenever the screen mounts — cheap, side-effect-free reads (same policy `plan/devices.tsx` uses). */
const REFRESH_MS = 4000;

/**
 * Tab 3 — one page for everything (DESIGN §3.1 · mockup `09-settings.png`, WO L3.6).
 * Four groups exactly as drawn: Devices · Sound · Sleep · Data — `settings.sleep.boostNight`
 * is the one row the mockup itself does not draw (it predates the WBTB decision,
 * APP-RUN §2 "L3.6"); it is placed at the end of "Sleep" rather than as a fifth group,
 * per DESIGN §4-09's own "no extra group" rule — see `ledger/wo-notes/L3ui.md` for the
 * parity note.
 */
export default function SettingsScreen() {
  const { t } = useT();
  const { locale, setLocale } = useLocale();
  const router = useRouter();
  const settings = useSettings();
  const { consentAi } = useOnboardingState();

  const [devices, setDevices] = useState<DeviceEntry[]>(() => deviceRegistry.list());
  const [sheet, setSheet] = useState<'guard' | 'realityChecks' | 'resetAnchor' | 'deleteAll1' | 'deleteAll2' | 'deviceSearch' | null>(null);
  const [deleteWord, setDeleteWord] = useState('');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [anchorPlaying, setAnchorPlaying] = useState(false);

  useEffect(() => {
    function tick(): void {
      refreshDevicesFromPlatform();
      applyDeviceFoundFixture();
      setDevices(deviceRegistry.list());
    }
    tick();
    const unsubscribe = deviceRegistry.subscribe(setDevices);
    const interval = setInterval(tick, REFRESH_MS);
    // WO L3.9: the device rows here are the same registry the two devices screens show, so they get
    // the same instant refresh on a route change / on coming back from iOS Settings.
    const unsubscribePlatform = watchPlatformDevices();
    return () => {
      unsubscribe();
      clearInterval(interval);
      unsubscribePlatform();
    };
  }, []);

  // Reschedule reality-check notifications whenever the count actually changes (also
  // covers the very first mount — this is the one screen that owns the "how many times
  // a day" setting, so it is the natural place to (re)ask for permission too).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void scheduleDailyReminders(settings.realityChecksPerDay, locale).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the count or the language of the text changes
  }, [settings.realityChecksPerDay, locale]);

  const summary = useMemo(() => summarizeDevices(devices), [devices]);
  const heartDevice = devices.find((entry) => entry.category === 'HEART' && entry.connected) ?? null;
  const audioDevice = devices.find((entry) => entry.category === 'AUDIO' && entry.connected) ?? null;

  async function handlePlayAnchor(): Promise<void> {
    if (anchorPlaying) return;
    setAnchorPlaying(true);
    try {
      const seed = await getAnchorSeed();
      const signature = buildAnchorSignature(seed, locale);
      await playAnchorOnce(signature, { volume: settings.volumeStart });
    } catch {
      // Best-effort, same as every other anchor preview call in this app.
    } finally {
      setAnchorPlaying(false);
    }
  }

  async function handleResetAnchor(): Promise<void> {
    setSheet(null);
    try {
      await resetAnchorSeed();
      setBusyMessage(t('settings.sound.reset.done'));
    } catch {
      // Nothing more to do — the seed helper already best-effort persists.
    }
  }

  async function handleExportAll(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      const bundle = await exportAllData();
      const directory = new Directory(Paths.cache, 'settings-export');
      if (!directory.exists) directory.create({ intermediates: true });
      const target = new File(directory, `dreaming-export-${Date.now()}.json`);
      target.create({ intermediates: true, overwrite: true });
      target.write(JSON.stringify(bundle, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target.uri, { mimeType: 'application/json', dialogTitle: t('settings.data.export'), UTI: 'public.json' });
      }
      setBusyMessage(t('settings.data.export.done'));
    } catch {
      setBusyMessage(t('settings.data.export.failed'));
    }
  }

  async function handleDeleteAllConfirmed(): Promise<void> {
    setSheet(null);
    setDeleteWord('');
    if (Platform.OS === 'web') return;
    try {
      await deleteEverythingLocal();
      // §0.5 S4: local storage (Keychain-equivalent device token + every AsyncStorage key
      // this app writes — onboarding, night plan, settings, locale, anchor seed) and the
      // server record, in that order; the server call is itself best-effort
      // (`api/client.ts#deleteDevice`'s own doc comment).
      await deleteDevice();
      clearNightPlan();
      resetSettingsAfterDeleteAll();
      resetOnboardingAfterDeleteAll();
      router.replace('/onboarding');
    } catch {
      setBusyMessage(t('settings.deleteAll.failed'));
    }
  }

  return (
    <Screen testID="screen-settings">
      <Title>{t('settings.title')}</Title>
      <Sub>{t('settings.subtitle')}</Sub>

      {/* Devices */}
      <SectionLabel style={styles.sectionLabel}>{t('settings.section.devices')}</SectionLabel>
      <GlassCard style={styles.cardTight} noPadding testID="settings-devices-card">
        <DeviceRow
          icon="heart"
          label={t('onboarding.devices.heart.title')}
          value={
            heartDevice
              ? t('settings.devices.row.value', { name: heartDevice.name, battery: Math.round((heartDevice.battery ?? 0) * 100) })
              : t('settings.devices.notConnected')
          }
          testID="settings-device-heart"
        />
        <DeviceRow
          icon="phones"
          label={t('onboarding.devices.audio.title')}
          value={
            audioDevice
              ? t('settings.devices.row.value', {
                  name: audioDevice.name,
                  battery: Math.round((audioDevice.battery ?? AUDIO_HOURS_PER_FULL_CHARGE) * 100),
                })
              : t('settings.devices.notConnected')
          }
          testID="settings-device-audio"
        />
        <DeviceRow icon="eye" label={t('onboarding.devices.eye.title')} value={t('settings.devices.eye.value')} dimmed testID="settings-device-eye" />
        <Pressable accessibilityRole="button" onPress={() => setSheet('deviceSearch')} testID="settings-device-search">
          <View style={styles.searchRow}>
            <Icon name="plus" size={15} color={colors.acc} strokeWidth={2.2} />
            <Text style={[typeScale.body, styles.searchLabel]}>{t('settings.devices.searchOther')}</Text>
            <Icon name="chevronRight" size={14} color={colors.mut} />
          </View>
        </Pressable>
      </GlassCard>

      {/* Sound */}
      <SectionLabel style={styles.sectionLabel}>{t('settings.section.sound')}</SectionLabel>
      <GlassCard style={styles.cardTight} noPadding testID="settings-sound-card">
        <Row label={t('settings.sound.anchor')} value={t('settings.sound.anchor.listen')} onPress={() => void handlePlayAnchor()} testID="settings-anchor-listen" />
        <Row label={t('settings.sound.reset')} value={t('settings.sound.reset.sub')} onPress={() => setSheet('resetAnchor')} testID="settings-anchor-reset" />
        <View style={styles.volumeRow} testID="settings-volume-row">
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.body, styles.rowLabel]}>{t('settings.sound.volume')}</Text>
            <Sub>{t('settings.sound.volume.sub')}</Sub>
          </View>
          <VolumeStepper value={settings.volumeStart} onChange={setVolumeStart} />
        </View>
        <View style={[styles.switchRow, styles.lastRow]}>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.body, styles.rowLabel]}>{t('settings.sound.autoAdjust')}</Text>
            <Sub>{t('settings.sound.autoAdjust.sub')}</Sub>
          </View>
          {/* Always on in normal mode (mockup `09-settings.png`: full-brightness green, not
              faded) — the lock is conveyed by the sub line above, not by a disabled-looking
              control (Fable parity review); `onValueChange` stays a no-op. */}
          <Switch value onValueChange={() => undefined} testID="settings-auto-adjust" />
        </View>
      </GlassCard>

      {/* Sleep */}
      <SectionLabel style={styles.sectionLabel}>{t('settings.section.sleep')}</SectionLabel>
      <GlassCard style={styles.cardTight} noPadding testID="settings-sleep-card">
        <Row
          label={t('settings.sleep.guard', { hours: settings.guardHours })}
          value={t('settings.sleep.guard.value', { maxCues: settings.maxCuesPerNight })}
          onPress={() => setSheet('guard')}
          testID="settings-guard-row"
        />
        <View style={styles.switchRow}>
          <Text style={[typeScale.body, styles.rowLabel, { flex: 1 }]}>{t('settings.sleep.stopAfterTwoWakes')}</Text>
          <Switch value={settings.stopAfterTwoWakes} onValueChange={setStopAfterTwoWakes} testID="settings-stop-two-wakes" />
        </View>
        <View style={styles.switchRow}>
          <Text style={[typeScale.body, styles.rowLabel, { flex: 1 }]}>{t('settings.sleep.controlNights')}</Text>
          <Switch value={settings.controlNightsEnabled} onValueChange={setControlNightsEnabled} testID="settings-control-nights" />
        </View>
        <Row
          label={t('settings.sleep.realityChecks')}
          value={t('settings.sleep.realityChecks.value', { n: settings.realityChecksPerDay })}
          onPress={() => setSheet('realityChecks')}
          testID="settings-reality-checks-row"
        />
        <View style={[styles.switchRow, styles.lastRow]}>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.body, styles.rowLabel]}>{t('settings.sleep.boostNight')}</Text>
            <Sub>{t('settings.sleep.boostNight.sub')}</Sub>
          </View>
          <Switch value={settings.boostNight} onValueChange={setBoostNight} testID="settings-boost-night" />
        </View>
      </GlassCard>

      {/* Data */}
      <SectionLabel style={styles.sectionLabel}>{t('settings.section.data')}</SectionLabel>
      <GlassCard style={styles.cardTight} noPadding testID="settings-data-card">
        <View style={styles.switchRow}>
          <Text style={[typeScale.body, styles.rowLabel, { flex: 1 }]}>{t('settings.data.consentAi')}</Text>
          <Switch value={consentAi} onValueChange={setConsentAi} testID="settings-consent-ai" />
        </View>
        <Row
          label={t('settings.data.local')}
          right={
            <View style={styles.dataButtons}>
              <Button label={t('settings.data.export')} tone="gh" size="sm" onPress={() => void handleExportAll()} testID="settings-export" />
              <Button label={t('settings.data.deleteAll')} tone="dg" size="sm" onPress={() => setSheet('deleteAll1')} testID="settings-delete-all" />
            </View>
          }
          testID="settings-data-local-row"
        />
        <Row
          label={t('settings.language')}
          right={
            <View style={{ minWidth: 160 }}>
              <Seg
                testID="locale-seg"
                options={[
                  { value: 'th', label: t('settings.language.th') },
                  { value: 'en', label: t('settings.language.en') },
                ]}
                value={locale}
                onChange={(next) => setLocale(next === 'th' ? 'th' : 'en')}
              />
            </View>
          }
          testID="settings-language-row"
        />
        <View style={styles.aboutBlock}>
          <Sub>{t('settings.about.notMedical')}</Sub>
          <Sub>{t('settings.about.research')}</Sub>
        </View>
        <View style={styles.diagnosticsBlock}>
          <Sub>{t('settings.openDiagnostics.hint')}</Sub>
          <Button testID="open-diagnostics" tone="gh" block label={t('settings.openDiagnostics')} onPress={() => router.push('/diagnostics')} />
        </View>
      </GlassCard>

      {busyMessage ? <Sub testID="settings-busy-message">{busyMessage}</Sub> : null}

      <PickerSheet
        visible={sheet === 'guard'}
        title={t('settings.sleep.guard.sheet.title')}
        onClose={() => setSheet(null)}
      >
        <NumberField
          label={t('settings.sleep.guard.sheet.guardLabel')}
          value={settings.guardHours}
          min={MIN_GUARD_HOURS}
          max={MAX_GUARD_HOURS}
          step={1}
          suffix={t('settings.sleep.guard', { hours: '' }).trim()}
          onChange={setGuardHours}
          testID="settings-guard-hours-field"
        />
        <NumberField
          label={t('settings.sleep.guard.sheet.cuesLabel')}
          value={settings.maxCuesPerNight}
          min={MIN_CUES_PER_NIGHT}
          max={MAX_CUES_PER_NIGHT_SETTING}
          step={1}
          onChange={setMaxCuesPerNight}
          testID="settings-max-cues-field"
        />
      </PickerSheet>

      <PickerSheet
        visible={sheet === 'realityChecks'}
        title={t('settings.sleep.realityChecks.sheet.title')}
        onClose={() => setSheet(null)}
      >
        <NumberField
          label={t('settings.sleep.realityChecks')}
          value={settings.realityChecksPerDay}
          min={MIN_REALITY_CHECKS_PER_DAY}
          max={MAX_REALITY_CHECKS_PER_DAY}
          step={1}
          onChange={setRealityChecksPerDay}
          testID="settings-reality-checks-field"
        />
      </PickerSheet>

      <ConfirmSheet
        visible={sheet === 'resetAnchor'}
        title={t('settings.sound.reset.confirm.title')}
        body={t('settings.sound.reset.confirm.body')}
        cta={t('settings.sound.reset.confirm.cta')}
        tone="dg"
        onCancel={() => setSheet(null)}
        onConfirm={() => void handleResetAnchor()}
        testID="settings-reset-anchor-confirm"
      />

      <ConfirmSheet
        visible={sheet === 'deleteAll1'}
        title={t('settings.deleteAll.step1.title')}
        body={t('settings.deleteAll.step1.body')}
        cta={t('settings.deleteAll.step1.cta')}
        tone="dg"
        onCancel={() => setSheet(null)}
        onConfirm={() => setSheet('deleteAll2')}
        testID="settings-delete-all-step1"
      />

      <TypeConfirmSheet
        visible={sheet === 'deleteAll2'}
        title={t('settings.deleteAll.step2.title')}
        placeholder={t('settings.deleteAll.step2.placeholder')}
        cta={t('settings.deleteAll.step2.cta')}
        mismatchLabel={t('settings.deleteAll.step2.mismatch')}
        confirmWord={t('settings.deleteAll.confirmWord')}
        value={deleteWord}
        onChangeText={setDeleteWord}
        onCancel={() => {
          setSheet(null);
          setDeleteWord('');
        }}
        onConfirm={() => void handleDeleteAllConfirmed()}
        testID="settings-delete-all-step2"
      />

      <DeviceSearchSheet
        visible={sheet === 'deviceSearch'}
        onClose={() => setSheet(null)}
        origin="settings"
        testID="settings-device-search-sheet"
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Small local pieces — none of these are shared elsewhere, kept inline the same way
// `app/plan/devices.tsx`'s own `CategoryCard`/`DeviceRow`/`SearchOtherRow` are.
// ---------------------------------------------------------------------------

interface DeviceRowProps {
  icon: 'heart' | 'phones' | 'eye';
  label: string;
  value: string;
  dimmed?: boolean;
  testID?: string;
}

function DeviceRow({ icon, label, value, dimmed = false, testID }: DeviceRowProps) {
  return (
    <View style={dimmed ? { opacity: 0.5 } : undefined}>
      <Row
        label={label}
        value={value}
        right={<Icon name={icon} size={16} color={colors.mut} />}
        testID={testID}
      />
    </View>
  );
}

interface VolumeStepperProps {
  value: number;
  onChange: (next: number) => void;
}

/** "slider (clamped 8–35%)" (WO L3.6 spec) rendered as a stepped track — a real drag
 * slider needs either `@react-native-community/slider` (an unjustified new native
 * dependency for one row, §0.5 S9) or a hand-rolled `PanResponder` this WO chose not to
 * risk shipping untested on a real device; 3-point-per-tap stepping over the same
 * 8–35% rails the engine enforces regardless gets the same outcome for a value nobody
 * fine-tunes more than once. Documented as a parity note, not silently substituted. */
function VolumeStepper({ value, onChange }: VolumeStepperProps) {
  const percent = Math.round(value * 100);
  const step = 0.03;
  return (
    <View style={styles.stepper} testID="settings-volume-stepper">
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange(Math.max(MIN_VOLUME_START, value - step))}
        style={styles.stepperButton}
        testID="settings-volume-down"
      >
        <Text style={typeScale.button}>−</Text>
      </Pressable>
      <Text style={[typeScale.h2, styles.stepperValue]}>{percent}%</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange(Math.min(MAX_VOLUME_START, value + step))}
        style={styles.stepperButton}
        testID="settings-volume-up"
      >
        <Text style={typeScale.button}>+</Text>
      </Pressable>
    </View>
  );
}

interface SheetShellProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  testID?: string;
}

function SheetShell({ visible, onClose, title, children, testID }: SheetShellProps) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID={testID}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityRole="button">
        <Pressable onPress={() => undefined}>
          <GlassCard style={{ margin: spacing.lg, borderRadius: radius.card }} title={title}>
            {children}
          </GlassCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface PickerSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function PickerSheet({ visible, title, onClose, children }: PickerSheetProps) {
  return (
    <SheetShell visible={visible} onClose={onClose} title={title} testID="settings-picker-sheet">
      {children}
    </SheetShell>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (next: number) => void;
  testID?: string;
}

function NumberField({ label, value, min, max, step, onChange, testID }: NumberFieldProps) {
  return (
    <View style={styles.numberField} testID={testID}>
      <Text style={[typeScale.body, styles.rowLabel]}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable accessibilityRole="button" onPress={() => onChange(Math.max(min, value - step))} style={styles.stepperButton} testID={testID ? `${testID}-down` : undefined}>
          <Text style={typeScale.button}>−</Text>
        </Pressable>
        <Text style={[typeScale.h2, styles.stepperValue]}>{value}</Text>
        <Pressable accessibilityRole="button" onPress={() => onChange(Math.min(max, value + step))} style={styles.stepperButton} testID={testID ? `${testID}-up` : undefined}>
          <Text style={typeScale.button}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  cta: string;
  tone: 'pri' | 'dg';
  onCancel: () => void;
  onConfirm: () => void;
  testID?: string;
}

function ConfirmSheet({ visible, title, body, cta, tone, onCancel, onConfirm, testID }: ConfirmSheetProps) {
  return (
    <SheetShell visible={visible} onClose={onCancel} title={title} testID={testID}>
      <Sub>{body}</Sub>
      <View style={styles.sheetButtons}>
        <Button label={cta} tone={tone} block onPress={onConfirm} testID={testID ? `${testID}-confirm` : undefined} />
      </View>
    </SheetShell>
  );
}

interface TypeConfirmSheetProps {
  visible: boolean;
  title: string;
  placeholder: string;
  cta: string;
  mismatchLabel: string;
  /** The word the user must type verbatim — a real "typeToConfirm" gate (oracle M6.6). */
  confirmWord: string;
  value: string;
  onChangeText: (text: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  testID?: string;
}

function TypeConfirmSheet({
  visible,
  title,
  placeholder,
  cta,
  mismatchLabel,
  confirmWord,
  value,
  onChangeText,
  onCancel,
  onConfirm,
  testID,
}: TypeConfirmSheetProps) {
  const typedCorrectly = value.trim().length > 0 && value.trim() === confirmWord;
  return (
    <SheetShell visible={visible} onClose={onCancel} title={title} testID={testID}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mut}
        autoCapitalize="none"
        autoCorrect={false}
        style={[typeScale.body, styles.typeInput]}
        testID={testID ? `${testID}-input` : undefined}
      />
      {value.length > 0 && !typedCorrectly ? <Sub>{mismatchLabel}</Sub> : null}
      <View style={styles.sheetButtons}>
        <Button label={cta} tone="dg" block disabled={!typedCorrectly} onPress={onConfirm} testID={testID ? `${testID}-confirm` : undefined} />
      </View>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  // Section captions sit OUTSIDE/above their card (mockup `09-settings.png`: Devices /
  // Sound / Sleep / Data are plain muted text in the page background, not drawn
  // inside the white/tinted card) — `GlassCard`'s own `title` prop draws the label
  // *inside* the surface instead, which is right for every other screen that uses it but
  // wrong here, so these 4 sections render `SectionLabel` as a normal sibling and pull
  // the card up underneath it with `cardTight` instead of passing `title`.
  sectionLabel: { marginLeft: spacing.xs },
  cardTight: { marginTop: -(spacing.lg - spacing.xs) },
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
  searchLabel: { flex: 1, fontWeight: '600', color: colors.acc },
  rowLabel: { fontWeight: '600', color: colors.ink },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  lastRow: { paddingBottom: spacing.md },
  dataButtons: { flexDirection: 'row', gap: spacing.sm },
  aboutBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  diagnosticsBlock: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,19,24,0.06)',
  },
  stepperValue: { minWidth: 48, textAlign: 'center', color: colors.ink },
  numberField: { gap: spacing.sm, paddingVertical: spacing.sm },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(17,19,24,0.35)', justifyContent: 'flex-end' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  sheetButtons: { marginTop: spacing.sm },
  typeInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
  },
});

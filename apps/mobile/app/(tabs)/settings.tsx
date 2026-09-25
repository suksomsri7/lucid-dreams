import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { Button, GlassCard, Icon, Screen, SectionLabel, Seg, Sub, Switch, Title, colors, radius, spacing, typeScale } from '../../src/ui';

/** Re-checked whenever the screen mounts — cheap, side-effect-free reads (same policy `plan/devices.tsx` uses). */
const REFRESH_MS = 4000;

/** WO L3.11 — every row's shared geometry (mockup `09-settings.png` v2: "row height 52 ·
 * 16px inset on both edges, the same on every row"). */
const SETTINGS_ROW_MIN_HEIGHT = 52;
const SETTINGS_INSET = 16;

/** How long the reset/export/delete toast holds at full opacity before it starts fading. */
const TOAST_VISIBLE_MS = 2500;
const TOAST_FADE_MS = 320;

/**
 * Tab 3 — one page for everything (DESIGN §3.1 · mockup `09-settings.png` v2, WO L3.11).
 * Five groups exactly as drawn: Devices · Sound · Sleep · Data · Test — every row goes
 * through the local `SettingRow` below so height/inset/right-edge alignment stay a single
 * source of truth (WO L3.11 point 1), replacing the mixed hand-rolled rows the v1 layout
 * had (WO L3.6/L3.9). `settings.sleep.boostNight` is still the one row mockup `09` itself
 * does not draw (predates the WBTB decision, APP-RUN §2 "L3.6"); kept at the end of
 * "Sleep" per the v1 parity note in `ledger/wo-notes/L3ui.md`.
 */
export default function SettingsScreen() {
  const { t } = useT();
  const { locale, setLocale } = useLocale();
  const router = useRouter();
  const settings = useSettings();
  const { consentAi } = useOnboardingState();
  /** `?scrolled=1` (visual-all.js `settings-scrolled` route, WO L3.11 point 7) renders the
   * page starting from "Sleep" instead of "Devices" so a fixed-height screenshot lands on
   * the same content mockup frame B ("scrolled to the bottom") shows — a real scroll
   * gesture needs a ref the shared `Screen` scaffold does not expose, and `Screen.tsx` is
   * outside this WO's file list, so this is the in-scope way to get that second frame. */
  const { scrolled } = useLocalSearchParams<{ scrolled?: string }>();
  const showTop = scrolled !== '1';

  const [devices, setDevices] = useState<DeviceEntry[]>(() => deviceRegistry.list());
  const [sheet, setSheet] = useState<'guard' | 'realityChecks' | 'resetAnchor' | 'deleteAll1' | 'deleteAll2' | 'deviceSearch' | null>(null);
  const [deleteWord, setDeleteWord] = useState('');
  const [anchorPlaying, setAnchorPlaying] = useState(false);

  // WO L3.11 point 5: "Watermark reset" (and the other best-effort local messages this
  // screen used to leave sitting on the page forever via `busyMessage`) is now a real
  // toast — appears, holds ~2.5s, fades via `Animated` opacity, then unmounts.
  const [resetToastMessage, setResetToastMessage] = useState<string | null>(null);
  const resetToastOpacity = useRef(new Animated.Value(0)).current;
  const resetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetToastTimer.current) clearTimeout(resetToastTimer.current);
    };
  }, []);

  function showResetToast(message: string): void {
    if (resetToastTimer.current) clearTimeout(resetToastTimer.current);
    resetToastOpacity.stopAnimation();
    resetToastOpacity.setValue(1);
    setResetToastMessage(message);
    resetToastTimer.current = setTimeout(() => {
      Animated.timing(resetToastOpacity, { toValue: 0, duration: TOAST_FADE_MS, useNativeDriver: false }).start(({ finished }) => {
        if (finished) setResetToastMessage(null);
      });
    }, TOAST_VISIBLE_MS);
  }

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
      showResetToast(t('settings.sound.reset.done'));
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
      showResetToast(t('settings.data.export.done'));
    } catch {
      showResetToast(t('settings.data.export.failed'));
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
      showResetToast(t('settings.deleteAll.failed'));
    }
  }

  return (
    <Screen testID="screen-settings">
      <Title>{t('settings.title')}</Title>
      <Sub>{t('settings.subtitle')}</Sub>

      <View style={styles.groups}>
        {showTop ? (
          <>
            {/* Devices */}
            <View style={styles.group}>
              <SectionLabel style={styles.groupHeader}>{t('settings.group.devices')}</SectionLabel>
              <GlassCard noPadding testID="settings-devices-card">
                <SettingRow
                  icon="💓"
                  label={t('onboarding.devices.heart.title')}
                  value={
                    heartDevice
                      ? t('settings.devices.row.value', { name: heartDevice.name, battery: Math.round((heartDevice.battery ?? 0) * 100) })
                      : t('settings.devices.notConnected')
                  }
                  chevron
                  testID="settings-device-heart"
                />
                <SettingRow
                  icon="🎧"
                  label={t('onboarding.devices.audio.title')}
                  value={
                    audioDevice
                      ? t('settings.devices.row.value', {
                          name: audioDevice.name,
                          battery: Math.round((audioDevice.battery ?? AUDIO_HOURS_PER_FULL_CHARGE) * 100),
                        })
                      : t('settings.devices.notConnected')
                  }
                  chevron
                  testID="settings-device-audio"
                />
                <SettingRow
                  icon="👁"
                  label={t('onboarding.devices.eye.title')}
                  value={t('settings.devices.eye.value')}
                  chevron
                  dimmed
                  testID="settings-device-eye"
                />
                <SettingRow
                  icon={<Icon name="plus" size={15} color={colors.acc} strokeWidth={2.2} />}
                  label={t('settings.devices.searchOther')}
                  accent
                  chevron
                  last
                  onPress={() => setSheet('deviceSearch')}
                  testID="settings-device-search"
                />
              </GlassCard>
            </View>

            {/* Sound */}
            <View style={styles.group}>
              <SectionLabel style={styles.groupHeader}>{t('settings.group.sound')}</SectionLabel>
              <GlassCard noPadding testID="settings-sound-card">
                <SettingRow
                  label={t('settings.sound.anchor')}
                  value={t('settings.sound.anchor.listen')}
                  onPress={() => void handlePlayAnchor()}
                  chevron
                  testID="settings-anchor-listen"
                />
                <SettingRow
                  label={t('settings.sound.reset')}
                  sub={t('settings.sound.reset.sub')}
                  onPress={() => setSheet('resetAnchor')}
                  chevron
                  testID="settings-anchor-reset"
                />
                <SettingRow
                  label={t('settings.sound.volume')}
                  sub={t('settings.sound.volume.sub')}
                  right={<VolumeStepper value={settings.volumeStart} onChange={setVolumeStart} />}
                  testID="settings-volume-row"
                />
                <SettingRow
                  label={t('settings.sound.autoAdjust')}
                  sub={t('settings.sound.auto.sub')}
                  right={
                    // Always on in normal mode (mockup `09-settings.png`: full-brightness green,
                    // not faded) — the lock is conveyed by the sub line, not a disabled-looking
                    // control (Fable parity review); `onValueChange` stays a no-op.
                    <Switch value onValueChange={() => undefined} testID="settings-auto-adjust" />
                  }
                  last
                  testID="settings-auto-adjust-row"
                />
              </GlassCard>
            </View>
          </>
        ) : null}

        {/* Sleep */}
        <View style={styles.group}>
          <SectionLabel style={styles.groupHeader}>{t('settings.group.sleep')}</SectionLabel>
          <GlassCard noPadding testID="settings-sleep-card">
            <SettingRow
              label={t('settings.sleep.guard', { hours: settings.guardHours })}
              value={t('settings.sleep.guard.value', { maxCues: settings.maxCuesPerNight })}
              onPress={() => setSheet('guard')}
              chevron
              testID="settings-guard-row"
            />
            <SettingRow
              label={t('settings.sleep.stopAfterTwoWakes')}
              right={<Switch value={settings.stopAfterTwoWakes} onValueChange={setStopAfterTwoWakes} testID="settings-stop-two-wakes" />}
              testID="settings-stop-two-wakes-row"
            />
            <SettingRow
              label={t('settings.sleep.controlNights')}
              right={<Switch value={settings.controlNightsEnabled} onValueChange={setControlNightsEnabled} testID="settings-control-nights" />}
              testID="settings-control-nights-row"
            />
            <SettingRow
              label={t('settings.sleep.realityChecks')}
              value={t('settings.sleep.realityChecks.value', { n: settings.realityChecksPerDay })}
              onPress={() => setSheet('realityChecks')}
              chevron
              testID="settings-reality-checks-row"
            />
            <SettingRow
              label={t('settings.sleep.boostNight')}
              sub={t('settings.sleep.boostNight.sub')}
              right={<Switch value={settings.boostNight} onValueChange={setBoostNight} testID="settings-boost-night" />}
              last
              testID="settings-boost-night-row"
            />
          </GlassCard>
        </View>

        {/* Data */}
        <View style={styles.group}>
          <SectionLabel style={styles.groupHeader}>{t('settings.group.data')}</SectionLabel>
          <GlassCard noPadding testID="settings-data-card">
            <SettingRow
              label={t('settings.data.consentAi')}
              right={<Switch value={consentAi} onValueChange={setConsentAi} testID="settings-consent-ai" />}
              testID="settings-consent-ai-row"
            />
            <SettingRow
              label={t('settings.data.local')}
              right={
                <View style={styles.dataButtons}>
                  <Button label={t('settings.data.export')} tone="gh" size="sm" onPress={() => void handleExportAll()} testID="settings-export" />
                  <Button label={t('settings.data.deleteAll')} tone="dg" size="sm" onPress={() => setSheet('deleteAll1')} testID="settings-delete-all" />
                </View>
              }
              testID="settings-data-local-row"
            />
            <SettingRow
              label={t('settings.language')}
              right={
                <View style={styles.languageSeg}>
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
              last
              testID="settings-language-row"
            />
          </GlassCard>
        </View>

        {/* Test */}
        <View style={styles.group}>
          <SectionLabel style={styles.groupHeader}>{t('settings.group.test')}</SectionLabel>
          <GlassCard noPadding testID="settings-test-card">
            <SettingRow
              label={t('settings.openDiagnostics')}
              sub={t('settings.diagnostics.sub')}
              onPress={() => router.push('/diagnostics')}
              chevron
              last
              testID="open-diagnostics"
            />
          </GlassCard>
          <Sub style={styles.legalNote} testID="settings-legal-note">
            {t('settings.about.notMedical')} · {t('settings.about.research')}
          </Sub>
        </View>
      </View>

      {resetToastMessage ? (
        <Animated.View style={[styles.toast, { opacity: resetToastOpacity }]} testID="settings-toast">
          <Sub style={styles.toastText}>{resetToastMessage}</Sub>
        </Animated.View>
      ) : null}

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

interface SettingRowProps {
  /** Leading glyph — a category emoji (matches `plan/devices.tsx`'s own `CategoryCard`
   * convention) or an `Icon` element (the accent "+" on the search row). */
  icon?: ReactNode;
  label: string;
  sub?: string;
  value?: string;
  /** Switch | Seg | buttons | stepper — whatever sits right of `value`, still inside the
   * same right-aligned edge as `value` and the chevron (WO L3.11 point 1). */
  right?: ReactNode;
  onPress?: () => void;
  /** Decorative — drawn independently of `onPress` so rows that mirror the mockup's
   * chevron (mockup `09-settings.png`: every device row) can show one without this WO
   * inventing new navigation behaviour for them (hard rule: layout only). */
  chevron?: boolean;
  accent?: boolean;
  dimmed?: boolean;
  /** No bottom hairline — the last row in a card. */
  last?: boolean;
  testID?: string;
}

/** `.li` (mockup `09-settings.png` v2) — the one row shape every group on this screen uses:
 * `SETTINGS_ROW_MIN_HEIGHT` tall, `SETTINGS_INSET` on both edges, label+sub on the left,
 * value/switch/seg/buttons/stepper/chevron right-aligned on the same edge. */
function SettingRow({ icon, label, sub, value, right, onPress, chevron = false, accent = false, dimmed = false, last = false, testID }: SettingRowProps) {
  const content = (
    <View style={[styles.settingRow, !last && styles.settingRowDivider, dimmed && styles.settingRowDimmed]} testID={testID}>
      {icon ? (
        <View style={styles.settingRowIcon}>{typeof icon === 'string' ? <Text style={styles.settingRowEmoji}>{icon}</Text> : icon}</View>
      ) : null}
      <View style={styles.settingRowText}>
        <Text numberOfLines={2} style={[styles.settingRowLabel, accent && styles.settingRowLabelAccent]}>
          {label}
        </Text>
        {sub ? <Sub style={styles.settingRowSub}>{sub}</Sub> : null}
      </View>
      <View style={styles.settingRowRight}>
        {value ? (
          <Text numberOfLines={1} style={styles.settingRowValue}>
            {value}
          </Text>
        ) : null}
        {right}
        {chevron ? <Icon name="chevronRight" size={16} color={colors.mut} /> : null}
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
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
  // WO L3.11: groups (header + card [+ note]) sit in their own wrapper so the 18px gap
  // between groups and the 8px gap between a header and its card are each set once here,
  // independent of `Screen`'s own top-level gap (Title/Subtitle keep that default).
  groups: { gap: 18 },
  group: { gap: 8 },
  groupHeader: { fontSize: 12, letterSpacing: 0.48, paddingLeft: SETTINGS_INSET },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SETTINGS_ROW_MIN_HEIGHT,
    paddingHorizontal: SETTINGS_INSET,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  settingRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  settingRowDimmed: { opacity: 0.55 },
  settingRowIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  settingRowEmoji: { fontSize: 18, lineHeight: 21 },
  settingRowText: { flex: 1, minWidth: 0, gap: 2 },
  settingRowLabel: { fontSize: 15, fontWeight: '600', color: colors.ink, lineHeight: 19 },
  settingRowLabelAccent: { color: colors.acc },
  settingRowSub: { fontSize: 12.5 },
  settingRowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
  settingRowValue: { fontSize: 14, color: colors.ink2, textAlign: 'right' },
  // WO L3.11 point 4: the language Seg stays inside the card's right inset instead of
  // overflowing it — `flexShrink` lets it give way to the label first, `maxWidth` caps it
  // at the mockup's 150px track width.
  languageSeg: { maxWidth: 150, flexShrink: 1 },
  dataButtons: { flexDirection: 'row', gap: spacing.sm, flexShrink: 0 },
  legalNote: { paddingHorizontal: SETTINGS_INSET, paddingTop: 6 },
  // WO L3.11 point 5 — the fade-out toast itself.
  toast: {
    alignSelf: 'center',
    maxWidth: '86%',
    backgroundColor: 'rgba(17,19,24,0.88)',
    borderRadius: radius.chip,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toastText: { color: colors.white, textAlign: 'center' },
  rowLabel: { fontWeight: '600', color: colors.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,19,24,0.06)',
  },
  stepperValue: { minWidth: 48, textAlign: 'center', color: colors.ink },
  numberField: { gap: spacing.sm, paddingVertical: spacing.sm },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(17,19,24,0.35)', justifyContent: 'flex-end' },
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

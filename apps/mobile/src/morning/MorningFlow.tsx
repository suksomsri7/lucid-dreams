/**
 * The morning flow (WO L3.1 · DESIGN §3.2 "ตอนเช้า 2 ขั้น" · §3.3's last bullet · mockup
 * `06-morning.png`) — rendered by `app/(tabs)/index.tsx` **in place of** `AdvisorRoom`
 * whenever a session ended and nobody has told the morning room about it yet
 * (`useMorning.ts#isMorningPending`). Same tab shell (nav row, `AppBackground`, the
 * floating tab bar's clearance) as `AdvisorRoom.tsx` on purpose — DESIGN's own words are
 * "เช้าในห้องเดียวกัน" (morning, in the same room): the sleeper should not be able to tell
 * this is a different screen from the one they talked to before bed.
 *
 * All state lives in `useMorning.ts`; this file only turns `state`/`messages` into
 * frame a (`GREET`/`RECORD` — mic or the composer, plus the "▶ เปิดเสียงเมื่อคืนช่วยนึก"
 * replay pill) or frame b (`QUESTIONS`/`RESULT` — the transcript bubble, one question at a
 * time, the result bubble) exactly like `AdvisorRoom.tsx` turns `useAdvisor()`'s state
 * into the advisor's own two frames.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../i18n';
import { AppBackground, Bubble, Chip, Composer, GlassSurface, Icon, Scale, colors, radius, spacing, typeScale } from '../ui';
import { useMorning, type MorningMessage } from './useMorning';

/** `AdvisorRoom.tsx`'s exact formula — the composer/list have to clear the same floating tab bar. */
function tabBarTopClearance(safeAreaBottom: number): number {
  return Math.max(safeAreaBottom, 12) + 14 + 64 + spacing.sm;
}

/** `AdvisorRoom.tsx`'s own bubble-width note applies here unchanged — see that file. */
const BUBBLE_MAX_WIDTH = Math.round((390 - spacing.xl * 2) * 0.92);

const WAVE_BARS = [10, 18, 28, 14, 22, 32, 20, 12, 26, 30, 16, 24, 30, 18, 10, 22, 28, 14, 20, 32, 24, 12, 18, 9];

export interface MorningFlowProps {
  /** `null` only for the instant before `app/(tabs)/index.tsx` has resolved which
   * session is pending — `useMorning` still renders (a fixture doesn't need one). */
  sessionId: string | null;
  testID?: string;
}

export function MorningFlow({ sessionId, testID }: MorningFlowProps) {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const morning = useMorning({ sessionId });
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<MorningMessage>>(null);
  const scrolledThrough = useRef(morning.messages.length);

  // Same auto-scroll rule as `AdvisorRoom.tsx`: only when a message is appended during
  // this screen's own lifetime, never on the very first render of a resumed conversation.
  useEffect(() => {
    if (morning.messages.length <= scrolledThrough.current) return;
    scrolledThrough.current = morning.messages.length;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [morning.messages.length]);

  if (!morning.ready) {
    return <AppBackground style={styles.fill} testID={testID} />;
  }

  const showRecordPane = morning.state === 'GREET' || morning.state === 'RECORD';

  return (
    <AppBackground style={styles.fill} testID={testID}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.nav}>
          <Text style={[typeScale.h2, styles.navTitle, { color: colors.ink }]} numberOfLines={1}>
            {t('tabs.tonight')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/history')} testID="morning-history-link">
            <Text style={[typeScale.body, styles.navLink]}>{t('advisor.history')}</Text>
          </Pressable>
        </View>

        {showRecordPane ? (
          <View style={styles.recordPane}>
            <View style={styles.aiHeader}>
              <View style={styles.aiHeaderAvatar}>
                <Icon name="spark" size={13} color={colors.acc} />
              </View>
              <Text style={[typeScale.sub, { color: colors.mut }]}>{t('advisor.aiName')}</Text>
            </View>
            <Bubble role="ai" text={morning.greetText} maxWidth={BUBBLE_MAX_WIDTH} testID="morning-greet-bubble" />
            <View style={styles.chipsRow}>
              <Chip label={morning.cantRememberLabel} onPress={morning.onCantRemember} testID="morning-chip-cant-remember" />
            </View>

            <View style={styles.sp} />

            <View style={styles.micArea}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={morning.micLabel}
                onPress={morning.onMicPress}
                style={[styles.micButton, morning.listening && styles.micButtonActive]}
                testID="morning-mic-button"
              >
                <Icon name="mic" size={30} color={colors.acc} />
              </Pressable>
              {morning.listening ? (
                <View style={styles.micPill} testID="morning-mic-pill">
                  <View style={styles.micDot} />
                  <Text style={[typeScale.sub, styles.micPillText]}>{morning.micLabel}</Text>
                </View>
              ) : (
                <Text style={[typeScale.sub, styles.micIdleLabel]}>{morning.micLabel}</Text>
              )}
              <Waveform active={morning.listening} />

              {morning.listening && morning.liveText !== '' ? (
                <View style={styles.liveBubbleWrap}>
                  <Bubble role="me" text={morning.liveText} voice maxWidth={BUBBLE_MAX_WIDTH} testID="morning-live-bubble" />
                  <Text style={[typeScale.sub, styles.transcribingLabel]}>{morning.transcribingLabel}</Text>
                </View>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => inputRef.current?.focus()} testID="morning-type-instead">
                  <Text style={[typeScale.sub, styles.typeInsteadLabel]}>{morning.typeInsteadLabel}</Text>
                </Pressable>
              )}
            </View>

            <Pressable accessibilityRole="button" onPress={morning.onToggleReplay} testID="morning-replay-pill" style={styles.replayWrap}>
              <GlassSurface tint="soft" radius={radius.chip} contentStyle={styles.replayPill}>
                <Icon name={morning.ambiencePlaying ? 'pause' : 'play'} size={13} color={colors.ink2} />
                <Text style={[typeScale.chipSm, { color: colors.ink2 }]}>{morning.replayLabel}</Text>
              </GlassSurface>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={morning.messages}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={[styles.listContent, { paddingBottom: tabBarTopClearance(insets.bottom) }]}
            renderItem={({ item }) => <MessageRow message={item} />}
          />
        )}
      </View>

      {showRecordPane ? (
        <View style={[styles.footer, { paddingBottom: tabBarTopClearance(insets.bottom) }]}>
          {morning.micUnavailable ? (
            <Text style={[typeScale.sub, styles.micWarning]}>{t('common.notAvailableOnThisDevice')}</Text>
          ) : null}
          <Composer
            value={morning.draft}
            onChangeText={morning.setDraft}
            placeholder={morning.composerPlaceholder}
            onMicPress={morning.onMicPress}
            onSend={morning.onSend}
            micActive={morning.listening}
            inputRef={inputRef}
            testID="morning-composer"
          />
        </View>
      ) : null}
    </AppBackground>
  );
}

function MessageRow({ message }: { message: MorningMessage }) {
  const rowLocked = message.chips?.some((chip) => chip.selected) ?? false;
  return (
    <View style={styles.messageBlock}>
      <Bubble role={message.kind} text={message.text} voice={message.voice} maxWidth={BUBBLE_MAX_WIDTH} testID={`morning-bubble-${message.id}`} />
      {message.scale ? (
        <Scale
          value={message.scale.value}
          onChange={message.scale.onAnswer}
          disabled={message.scale.value !== null}
          testID={message.scale.testID}
        />
      ) : null}
      {message.chips ? (
        <View style={styles.chipsRow}>
          {message.chips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              tone={chip.selected ? 'on' : 'default'}
              onPress={rowLocked && !chip.selected ? undefined : chip.onPress}
              testID={`morning-chip-${message.id}-${chip.key}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Waveform({ active }: { active: boolean }) {
  return (
    <View style={styles.wave} testID="morning-waveform">
      {WAVE_BARS.map((height, index) => (
        // eslint-disable-next-line react/no-array-index-key -- fixed-length, evenly spaced, never reordered
        <View key={index} style={[styles.waveBar, { height, backgroundColor: active ? colors.acc : colors.glassLine }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flex: 1, paddingHorizontal: spacing.xl },
  nav: { flexDirection: 'row', alignItems: 'center', height: 30, marginBottom: spacing.sm },
  navTitle: { flex: 1 },
  navLink: { color: colors.acc, fontWeight: '500' },
  list: { flex: 1 },
  listContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  messageBlock: { gap: spacing.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignSelf: 'flex-start' },

  recordPane: { flex: 1, gap: spacing.sm },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xs },
  aiHeaderAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accSurfaceSoft },
  sp: { flex: 1 },

  micArea: { alignItems: 'center', gap: spacing.sm },
  micButton: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accSurfaceSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassLine,
  },
  micButtonActive: { backgroundColor: colors.accSurface },
  micPill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  micDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.rem },
  micPillText: { color: colors.ink2 },
  micIdleLabel: { color: colors.mut },
  wave: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 32 },
  waveBar: { width: 3, borderRadius: 1.5 },
  liveBubbleWrap: { alignSelf: 'stretch', alignItems: 'center', gap: 2 },
  transcribingLabel: { color: colors.mut },
  typeInsteadLabel: { color: colors.acc, fontWeight: '500' },
  replayWrap: { alignSelf: 'center' },
  replayPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 32 },

  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.xs },
  micWarning: { textAlign: 'center', color: colors.mut },
});

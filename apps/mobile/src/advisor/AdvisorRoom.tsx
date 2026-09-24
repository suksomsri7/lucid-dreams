/**
 * The dream advisor room (WO L1.4 · DESIGN §3.3 · mockups `02-advisor-start.png` /
 * `03-advisor-chat.png`) — tab 1's whole screen. Talks only to `useAdvisor()`; knows
 * nothing about whether that hook is backed by the mock adapter (this WO) or the real
 * engine (wired at the L1.5 merge, per the WO header comment in `adapter.ts`).
 */

import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getPlatform } from '../platform';
import { useT, type Locale, type TranslateParams, type TranslationKey } from '../i18n';
import {
  AppBackground,
  Bubble,
  Button,
  Chip,
  Composer,
  Icon,
  NightBackground,
  colors,
  night,
  spacing,
  typeScale,
} from '../ui';
import { PlanCardCompact } from './PlanCardCompact';
import { useAdvisor } from './useAdvisor';
import type { DreamPlan, Message } from './types';

/** `Math.max(insets.bottom, 12) + 14 + 64` — the exact geometry `FloatingTabBar` positions itself with. */
function tabBarTopClearance(safeAreaBottom: number): number {
  return Math.max(safeAreaBottom, 12) + 14 + 64 + spacing.sm;
}

export interface AdvisorRoomProps {
  night?: boolean;
  testID?: string;
}

export function AdvisorRoom({ night: isNight = false, testID }: AdvisorRoomProps) {
  const { t, locale } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const platform = getPlatform();
  const advisor = useAdvisor(locale);

  const [draft, setDraft] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [micUnavailable, setMicUnavailable] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const unsubscribers = useRef<Array<() => void>>([]);

  const editing = advisor.state === 'PLAN' || advisor.state === 'STARTED';
  const composerPlaceholder = editing ? t('advisor.composer.editPlaceholder') : t('advisor.composer.placeholder');

  function stopListeners(): void {
    for (const unsubscribe of unsubscribers.current) unsubscribe();
    unsubscribers.current = [];
  }

  async function handleMicPress(): Promise<void> {
    if (micActive) {
      stopListeners();
      setMicActive(false);
      await platform.speechToText.stop().catch(() => undefined);
      return;
    }

    setMicUnavailable(false);
    try {
      const available = await platform.speechToText.isAvailable();
      if (!available) throw new Error('speech-to-text not available on this device');
      const granted = await platform.speechToText.requestPermissions();
      if (!granted) throw new Error('speech-to-text permission denied');

      const unsubscribeResult = platform.speechToText.onResult((result) => {
        // Live partial text lands straight in the composer (DESIGN §2.6 · mockup 06 frame a).
        setDraft(result.text);
        if (result.isFinal) {
          const finalText = result.text.trim();
          stopListeners();
          setMicActive(false);
          void platform.speechToText.stop().catch(() => undefined);
          if (finalText.length > 0) {
            setDraft('');
            void advisor.say(finalText, { fromVoice: true });
          }
        }
      });
      const unsubscribeError = platform.speechToText.onError(() => {
        stopListeners();
        setMicActive(false);
        setMicUnavailable(true);
      });
      unsubscribers.current = [unsubscribeResult, unsubscribeError];

      await platform.speechToText.start({ locale: locale === 'th' ? 'th-TH' : 'en-US' });
      setMicActive(true);
    } catch {
      // Web's stub (and any device without speech recognition) throws here — the WO's
      // required fallback: show `common.notAvailableOnThisDevice`, never a native crash.
      stopListeners();
      setMicActive(false);
      setMicUnavailable(true);
    }
  }

  function handleSend(): void {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');
    setMicUnavailable(false);
    void advisor.say(text);
  }

  function handleChipPress(key: string): void {
    setMicUnavailable(false);
    if (key === 'other') {
      // DESIGN §4-02: the "other" (✍️) theme chip never sends a message — it just opens the keyboard.
      inputRef.current?.focus();
      return;
    }
    void advisor.pickChip(key);
  }

  function handleStart(): void {
    advisor.start();
    router.push('/plan');
  }

  const Background = isNight ? NightBackground : AppBackground;
  // Newest-first: with `inverted`, index 0 renders at the bottom of the screen (RN's
  // standard chat-list ordering — see `ledger/wo-notes/L1.4.md` for why over `flatlist-swipeable`
  // or a manually-scrolled `ScrollView`, both considered and rejected).
  const data = [...advisor.messages].reverse();

  return (
    <Background style={styles.fill} testID={testID}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.nav}>
          <Text style={[typeScale.h2, styles.navTitle, { color: isNight ? night.text : colors.ink }]} numberOfLines={1}>
            {t('tabs.tonight')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/history')} testID="advisor-history-link">
            <Text style={[typeScale.body, styles.navLink]}>{t('advisor.history')}</Text>
          </Pressable>
        </View>

        <FlatList
          data={data}
          inverted
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.flip}>
              <MessageRow
                message={item}
                plan={advisor.plan}
                night={isNight}
                locale={locale}
                t={t}
                onChipPress={handleChipPress}
                onStart={handleStart}
              />
            </View>
          )}
          ListFooterComponent={
            // Inverted lists swap header/footer visually — the footer is what renders at
            // the *top* of the screen, which is where the "AI header pill" belongs
            // (mockup 02: it sits above the very first message, and scrolls off the top
            // as the conversation grows, same as any other item above it would).
            <View style={[styles.flip, styles.aiHeader]}>
              <View style={styles.aiHeaderAvatar}>
                <Icon name="spark" size={13} color={colors.acc} />
              </View>
              <Text style={[typeScale.sub, { color: isNight ? night.mut : colors.mut }]}>{t('advisor.aiName')}</Text>
            </View>
          }
        />
      </View>

      <View style={[styles.footer, { paddingBottom: tabBarTopClearance(insets.bottom) }]}>
        {micUnavailable ? (
          <Text style={[typeScale.sub, styles.micWarning, { color: isNight ? night.mut : colors.mut }]}>
            {t('common.notAvailableOnThisDevice')}
          </Text>
        ) : null}
        <Composer
          value={draft}
          onChangeText={setDraft}
          placeholder={composerPlaceholder}
          onMicPress={handleMicPress}
          onSend={handleSend}
          micActive={micActive}
          night={isNight}
          inputRef={inputRef}
          testID="advisor-composer"
        />
      </View>
    </Background>
  );
}

interface MessageRowProps {
  message: Message;
  plan: DreamPlan | null;
  night: boolean;
  locale: Locale;
  t: (key: TranslationKey, params?: TranslateParams) => string;
  onChipPress: (key: string) => void;
  onStart: () => void;
}

function MessageRow({ message, plan, night: isNight, t, onChipPress, onStart }: MessageRowProps) {
  // Once any chip in the row has been picked, the whole row stops accepting taps — it
  // stays on screen as a record of what was chosen (DESIGN §3.3: each question is
  // answered once, mockup 03's "sea turtle" (🐢) chip stays highlighted, not re-selectable).
  const rowLocked = message.chips?.some((chip) => chip.selected) ?? false;

  return (
    <View style={styles.messageBlock}>
      <Bubble role={message.kind} text={message.text} voice={message.fromVoice} night={isNight} />
      {message.chips ? (
        <View style={styles.chipsRow}>
          {message.chips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              tone={chip.selected ? 'on' : 'default'}
              night={isNight}
              onPress={rowLocked ? undefined : () => onChipPress(chip.key)}
              testID={`advisor-chip-${chip.key}`}
            />
          ))}
        </View>
      ) : null}
      {message.planCompact && plan ? (
        <View style={styles.planBlock}>
          <PlanCardCompact plan={plan} night={isNight} testID="advisor-plan-card" />
          <Button label={t('advisor.startTonight')} tone="pri" block onPress={onStart} testID="advisor-start-button" />
        </View>
      ) : null}
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
  listContent: { gap: spacing.sm, paddingVertical: spacing.sm },
  // Undoes the `inverted` FlatList's whole-list `scaleY(-1)` per row/header so bubbles
  // and text render right-side-up while the list still scrolls newest-at-bottom.
  flip: { transform: [{ scaleY: -1 }] },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm },
  aiHeaderAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accSurfaceSoft,
  },
  messageBlock: { gap: spacing.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignSelf: 'flex-start', maxWidth: 320 },
  planBlock: { gap: spacing.sm, alignSelf: 'stretch' },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.xs },
  micWarning: { textAlign: 'center' },
});

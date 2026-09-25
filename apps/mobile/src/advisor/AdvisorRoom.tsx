/**
 * The dream advisor room (WO L1.4 · DESIGN §3.3 · mockups `02-advisor-start.png` /
 * `03-advisor-chat.png`) — tab 1's whole screen. Talks only to `useAdvisor()`; knows
 * nothing about whether that hook is backed by the mock adapter (this WO) or the real
 * engine (wired at the L1.5 merge, per the WO header comment in `adapter.ts`).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prefetchFullAnchor } from '../audio/anchorRemote';
import { playBrandAnchor } from '../audio/brand';
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

/**
 * `styles.top`'s content width (390 frame − `spacing.xl` on each side) × 92% (Fable
 * parity review round 3 — mockup 03's user voice bubble stays on one line at this
 * width; narrower and the fixture's whale-shark sentence wraps to a second line).
 */
const BUBBLE_MAX_WIDTH = Math.round((390 - spacing.xl * 2) * 0.92);

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
  const listRef = useRef<FlatList<Message>>(null);
  const unsubscribers = useRef<Array<() => void>>([]);
  // Tracks the message count this screen has already scrolled for — starts at whatever
  // the room opens with (0 for a brand-new room, several for a resumed/seeded
  // conversation), so the very first render never auto-scrolls away from the top.
  const scrolledThrough = useRef(advisor.messages.length);

  // Fable parity review round 2: top-anchored per mockup 02 (AI pill + first bubble +
  // theme chips start right under the nav, empty space below, composer pinned at the
  // bottom) — a plain top-anchored list, not `inverted`. Scroll to the newest content
  // ourselves, but only when a message is actually *appended during this screen's
  // lifetime* — a room that opens already carrying a conversation (mockup 03's
  // `?fixture=advisor-plan`, or a real resumed session) should still show from the top
  // first, same as opening any chat app to unread history, not jump straight to the
  // newest message and hide where the conversation started.
  useEffect(() => {
    if (advisor.messages.length <= scrolledThrough.current) return;
    scrolledThrough.current = advisor.messages.length;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [advisor.messages.length]);

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      listRef.current?.scrollToEnd({ animated: true });
    });
    return () => subscription.remove();
  }, []);

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
    // WO L3.7: the anchor tone, once, the moment "Start tonight" is tapped — one more
    // repetition of the melody tonight's whisper will use. Fired *before* the navigation and
    // never awaited, so the sound starts under the screen transition instead of after it;
    // `playBrandAnchor` swallows its own errors, so there is nothing here that can fail.
    void playBrandAnchor();
    // WO L3.8: the last cheap moment to download the bell+whisper file — the user is awake, the
    // phone is in their hand and the network is probably up. Fire-and-forget: the plan screen
    // opens immediately either way (`prefetchFullAnchor` never throws and never blocks).
    void prefetchFullAnchor();
    router.push('/plan');
  }

  const Background = isNight ? NightBackground : AppBackground;

  return (
    <Background style={styles.fill} testID={testID}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.nav}>
          <Text style={[typeScale.h2, styles.navTitle, { color: isNight ? night.text : colors.ink }]} numberOfLines={1}>
            {t('tabs.tonight')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/history')} testID="advisor-history-link">
            <Text style={[typeScale.body, styles.navLink]}>{t('advisor.history')}</Text>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={advisor.messages}
          // inverted: false — top-anchored per mockup 02 (Fable parity review round 2):
          // the conversation starts right under the nav and grows downward, same as any
          // normal top-anchored chat list; `useEffect` above calls `scrollToEnd` on every
          // new message and when the keyboard opens, so the newest content is still what
          // the user sees without needing an inverted list at all.
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <MessageRow
              message={item}
              plan={advisor.plan}
              night={isNight}
              locale={locale}
              t={t}
              onChipPress={handleChipPress}
              onStart={handleStart}
            />
          )}
          ListHeaderComponent={
            // Fable parity review round 3: mockup 03 (conversation already started) has
            // no "AI header pill" at all — it only appears on the empty room (mockup 02).
            // Also recovers ~30px toward the mockup-03 fitting target.
            advisor.state === 'ASK' ? (
              <View style={styles.aiHeader}>
                <View style={styles.aiHeaderAvatar}>
                  <Icon name="spark" size={13} color={colors.acc} />
                </View>
                <Text style={[typeScale.sub, { color: isNight ? night.mut : colors.mut }]}>{t('advisor.aiName')}</Text>
              </View>
            ) : null
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
      <Bubble role={message.kind} text={message.text} voice={message.fromVoice} night={isNight} maxWidth={BUBBLE_MAX_WIDTH} />
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
  // 8px between items (Fable parity review round 3 — tighter than round 2's 10). Top/
  // bottom padding kept minimal (chrome, not one of the asked density values) so the
  // mockup-03 state has as much room as possible.
  listContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.xs },
  aiHeaderAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accSurfaceSoft,
  },
  messageBlock: { gap: spacing.sm },
  // No `maxWidth` cap: the row already lives inside `styles.top`'s `paddingHorizontal`,
  // so it naturally can't exceed the frame width — capping it further than that made the
  // 6 theme chips wrap 2-per-row instead of 3-per-row like mockup 02's `.opts.wide`.
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignSelf: 'flex-start' },
  planBlock: { gap: spacing.sm, alignSelf: 'stretch' },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.xs },
  micWarning: { textAlign: 'center' },
});

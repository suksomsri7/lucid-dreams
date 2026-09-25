/**
 * The dream advisor room (WO L1.4 · DESIGN §3.3 · mockups `02-advisor-start.png` /
 * `03-advisor-chat.png`) — tab 1's whole screen. Talks only to `useAdvisor()`; knows
 * nothing about whether that hook is backed by the mock adapter (this WO) or the real
 * engine (wired at the L1.5 merge, per the WO header comment in `adapter.ts`).
 */

import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AnchorSignature } from '@lucid/engine';

import { prefetchFullAnchor } from '../audio/anchorRemote';
import { playBrandAnchor } from '../audio/brand';
import { prefetchSeedLines } from '../audio/seedRemote';
import { buildAnchorSignature, getAnchorSeed, playAnchorPreview } from '../audio/player';
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
import { TypingBubble } from '../ui/TypingBubble';
import { PlanCardCompact } from './PlanCardCompact';
import { useAdvisor } from './useAdvisor';
import type { DreamPlan, Message } from './types';

/**
 * WO L3.10 (R1 hotfix #2): first tap has to download the full anchor file (`ensureFullAnchorUri`,
 * ~1–4 s per the WO) inside the single `playAnchorPreview` promise below — there is no
 * intermediate signal between "downloading" and "now playing", so the loading spinner is shown
 * for this long before the row switches to the "playing" glyph. Generous on purpose: better to
 * show "still loading" a little past the real download than flip to "playing" before sound has
 * actually started.
 */
const ANCHOR_LOADING_TO_PLAYING_MS = 900;

/** Safety net only — `playOneShot` (`platform/ios/IosAudioPlayer.ts`) already resolves on its own
 * once the clip finishes (or after its own internal timeout), so this should never actually fire;
 * it exists so a future platform/player bug can't leave the ▶ row stuck disabled forever. */
const ANCHOR_SAFETY_TIMEOUT_MS = 11000;

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

/**
 * Why the microphone is not listening (WO L3.13) — `null` while nothing is wrong.
 *
 * `denied` and `unavailable` are deliberately different states: the first is one tap in Settings
 * away from working, the second is a fact about the phone, and telling a user to open Settings
 * for a problem Settings cannot fix is worse than saying nothing.
 */
type MicNotice = 'denied' | 'unavailable' | null;

/**
 * `SpeechToText.onError` codes (`platform/ios/IosSpeechToText.ts`) → what the user is told.
 *
 * Silence is not a broken device: a session that ended without hearing anything (`NO_SPEECH`,
 * `SPEECH_TIMEOUT`) or that this screen itself cancelled (`ABORTED`) just puts the microphone
 * back to idle with no message at all, so the user can simply try again.
 */
function micNoticeForError(error: string): MicNotice {
  if (error === 'NOT_ALLOWED') return 'denied';
  if (error === 'NO_SPEECH' || error === 'SPEECH_TIMEOUT' || error === 'ABORTED') return null;
  return 'unavailable';
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
  // WO L3.13: why the microphone is not listening — the two cases have different ways out
  // (`denied` can be fixed in Settings, `unavailable` cannot), so they are not one boolean.
  const [micNotice, setMicNotice] = useState<MicNotice>(null);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const unsubscribers = useRef<Array<() => void>>([]);
  // Tracks the message count this screen has already scrolled for — starts at whatever
  // the room opens with (0 for a brand-new room, several for a resumed/seeded
  // conversation), so the very first render never auto-scrolls away from the top.
  const scrolledThrough = useRef(advisor.messages.length);

  // WO L3.10 (R1 hotfix #2 bug 1): the plan card's "▶" row. `signature` is built once
  // (seed + `locale`) and reused for every tap — the same signature `app/plan/index.tsx`
  // builds, so the first tap here can already be a cache hit if the plan screen (or a
  // previous tap in this room) already downloaded the file.
  const [anchorSignature, setAnchorSignature] = useState<AnchorSignature | null>(null);
  const [anchorStatus, setAnchorStatus] = useState<'idle' | 'loading' | 'playing'>('idle');
  const anchorTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seed = await getAnchorSeed();
      if (!cancelled) setAnchorSignature(buildAnchorSignature(seed, locale));
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(
    () => () => {
      for (const timer of anchorTimers.current) clearTimeout(timer);
    },
    [],
  );

  function handlePlayAnchor(): void {
    if (!anchorSignature || anchorStatus !== 'idle') return;
    setAnchorStatus('loading');
    const toPlaying = setTimeout(
      () => setAnchorStatus((prev) => (prev === 'loading' ? 'playing' : prev)),
      ANCHOR_LOADING_TO_PLAYING_MS,
    );
    const safety = setTimeout(() => setAnchorStatus('idle'), ANCHOR_SAFETY_TIMEOUT_MS);
    anchorTimers.current.push(toPlaying, safety);
    void playAnchorPreview(anchorSignature, locale)
      .catch((error) => {
        // WO: never alert on a preview failure (no headphones, system volume 0, …) — log only.
        // eslint-disable-next-line no-console -- intentional, WO-mandated fallback (no alert)
        console.warn('[advisor] anchor preview failed', error);
      })
      .finally(() => {
        clearTimeout(toPlaying);
        clearTimeout(safety);
        setAnchorStatus('idle');
      });
  }

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

  // WO L3.10: the typing bubble is appended below the message list (`ListFooterComponent`),
  // not as a `Message` in `advisor.messages` — scroll to it the same way a new message
  // scrolls into view, since it appears the instant a chip/send is tapped, before any
  // reply has actually landed in `advisor.messages`.
  useEffect(() => {
    if (!advisor.busy) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [advisor.busy]);

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      listRef.current?.scrollToEnd({ animated: true });
    });
    return () => subscription.remove();
  }, []);

  // WO L3.13: leaving the room must switch the microphone off. Without this, walking away mid
  // sentence leaves a live recognition session running behind a screen that no longer shows it
  // (APP-RUN §0.5 S4 — the audio is the most private thing this app touches).
  useEffect(
    () => () => {
      for (const unsubscribe of unsubscribers.current) unsubscribe();
      unsubscribers.current = [];
      void platform.speechToText.stop().catch(() => undefined);
    },
    [platform],
  );

  const editing = advisor.state === 'PLAN' || advisor.state === 'STARTED';
  const composerPlaceholder = editing ? t('advisor.composer.editPlaceholder') : t('advisor.composer.placeholder');

  function stopListeners(): void {
    for (const unsubscribe of unsubscribers.current) unsubscribe();
    unsubscribers.current = [];
  }

  async function handleMicPress(): Promise<void> {
    // Second tap = stop, which is what `advisor.mic.listening` promises in words.
    if (micActive) {
      stopListeners();
      setMicActive(false);
      await platform.speechToText.stop().catch(() => undefined);
      return;
    }

    setMicNotice(null);

    // WO L3.13: the three failure modes are kept apart on purpose — "this phone cannot" and
    // "you said no" used to collapse into the same "This device cannot do that yet" line, which
    // was the wrong sentence in both cases and offered no way forward.
    const available = await platform.speechToText.isAvailable().catch(() => false);
    if (!available) {
      setMicNotice('unavailable');
      return;
    }

    // First tap is also the permission prompt (microphone + speech recognition, one dialog).
    const granted = await platform.speechToText.requestPermissions().catch(() => false);
    if (!granted) {
      setMicNotice('denied');
      return;
    }

    try {
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
      const unsubscribeError = platform.speechToText.onError((error) => {
        stopListeners();
        setMicActive(false);
        setMicNotice(micNoticeForError(error));
      });
      unsubscribers.current = [unsubscribeResult, unsubscribeError];

      await platform.speechToText.start({ locale: locale === 'th' ? 'th-TH' : 'en-US' });
      setMicActive(true);
    } catch {
      // Web's stub (and any build whose native module is missing) throws here — never a crash.
      stopListeners();
      setMicActive(false);
      setMicNotice('unavailable');
    }
  }

  /** Settings is the only route back from a refused microphone (iOS never asks twice). */
  function handleOpenSettings(): void {
    void Linking.openSettings().catch(() => undefined);
  }

  function handleSend(): void {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');
    setMicNotice(null);
    void advisor.say(text);
  }

  function handleChipPress(key: string): void {
    setMicNotice(null);
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
    // WO L3.14: same moment, same reasoning, for the two *spoken* seed lines minute 3 and minute 8
    // will need (`src/audio/seedRemote.ts`). `useAdvisor.start()` above already asked for them —
    // this call joins that one in-flight promise rather than duplicating the requests, and exists
    // because `start()` only fires the prefetch when the adapter has a plan.
    if (advisor.plan) void prefetchSeedLines(advisor.plan, locale);
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
              busy={advisor.busy}
              onChipPress={handleChipPress}
              onStart={handleStart}
              onPlayAnchor={anchorSignature ? handlePlayAnchor : undefined}
              anchorStatus={anchorStatus}
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
          ListFooterComponent={
            // WO L3.10 (R1 hotfix #2 bug 2): the "AI is thinking" signal — rendered in the
            // same slot a real AI `Bubble` would occupy, for exactly as long as `useAdvisor()`
            // is waiting on a reply. `?fixture=advisor-thinking` (`src/dev/fixtures.ts`'s
            // `readFixtureParam() === 'advisor-thinking'`, read by `useAdvisor.ts`) freezes
            // this true for QC.
            advisor.busy ? (
              <View style={styles.messageBlock}>
                <TypingBubble night={isNight} testID="advisor-typing" />
              </View>
            ) : null
          }
        />
      </View>

      <View style={[styles.footer, { paddingBottom: tabBarTopClearance(insets.bottom) }]}>
        {micActive ? (
          <Text style={[typeScale.sub, styles.micWarning, styles.micListening]} testID="advisor-mic-listening">
            {t('advisor.mic.listening')}
          </Text>
        ) : null}
        {micNotice !== null ? (
          <View style={styles.micNotice} testID="advisor-mic-notice">
            <Text style={[typeScale.sub, styles.micWarning, { color: isNight ? night.mut : colors.mut }]}>
              {t(micNotice === 'denied' ? 'advisor.mic.denied' : 'advisor.mic.unavailable')}
            </Text>
            {micNotice === 'denied' ? (
              <Pressable accessibilityRole="button" onPress={handleOpenSettings} testID="advisor-mic-settings">
                <Text style={[typeScale.sub, styles.micSettingsLink]}>{t('advisor.mic.openSettings')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Composer
          value={draft}
          onChangeText={setDraft}
          placeholder={composerPlaceholder}
          // WO L3.10: send + mic are unavailable while `busy` — omitting the handler (rather
          // than `Composer`'s own `disabled` prop, which also stops the text input from being
          // editable) is what keeps typing allowed while a reply is in flight, per the WO.
          onMicPress={advisor.busy ? undefined : handleMicPress}
          onSend={advisor.busy ? undefined : handleSend}
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
  /** WO L3.10: true while `useAdvisor()` is waiting on a reply — every chip row locks, not just the one tapped. */
  busy: boolean;
  onChipPress: (key: string) => void;
  onStart: () => void;
  onPlayAnchor?: () => void;
  anchorStatus: 'idle' | 'loading' | 'playing';
}

function MessageRow({
  message,
  plan,
  night: isNight,
  t,
  busy,
  onChipPress,
  onStart,
  onPlayAnchor,
  anchorStatus,
}: MessageRowProps) {
  // Once any chip in the row has been picked, the whole row stops accepting taps — it
  // stays on screen as a record of what was chosen (DESIGN §3.3: each question is
  // answered once, mockup 03's "sea turtle" (🐢) chip stays highlighted, not re-selectable).
  // WO L3.10: `|| busy` locks *every* chip row (not just the tapped one) the instant a
  // reply is in flight — this is the fix for the R1 report of 9 duplicate user bubbles
  // from repeated taps during the ~4 s wait.
  const rowLocked = (message.chips?.some((chip) => chip.selected) ?? false) || busy;

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
              disabled={rowLocked || busy}
              onPress={rowLocked || busy ? undefined : () => onChipPress(chip.key)}
              testID={`advisor-chip-${chip.key}`}
            />
          ))}
        </View>
      ) : null}
      {message.planCompact && plan ? (
        <View style={styles.planBlock}>
          <PlanCardCompact
            plan={plan}
            night={isNight}
            onPlayAnchor={onPlayAnchor}
            anchorStatus={anchorStatus}
            testID="advisor-plan-card"
          />
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
  // WO L3.13: the live "listening…" line, in the accent colour the pulsing mic button uses.
  micListening: { color: colors.acc },
  micNotice: { gap: spacing.xs / 2, alignItems: 'center' },
  micSettingsLink: { color: colors.acc, fontWeight: '500' },
});

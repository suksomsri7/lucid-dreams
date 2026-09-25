/**
 * WO L3.10 (R1 hotfix #2) — the advisor room's "AI is thinking" signal. R1 report: a chip
 * tap takes ~4 s to get a reply and, until this WO, showed nothing at all in that gap —
 * the owner tapped again (up to 9 times), producing 9 user bubbles and 2 duplicate plan
 * cards. `AdvisorRoom.tsx` renders this as the last item in the message list while
 * `useAdvisor()`'s `busy` is true, same slot a real AI `Bubble` would take.
 *
 * Same shell as `Bubble`'s `role="ai"` case (`.bub.ai`: `GlassSurface tint="regular"`,
 * `radius.bubble`, the tail corner) so it reads as "the AI bubble, not typed yet" rather
 * than a new visual element — no new colour, per the WO.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { colors, night, radius } from './tokens';
import { useT } from '../i18n';

export interface TypingBubbleProps {
  night?: boolean;
  testID?: string;
}

const DOT_COUNT = 3;
const DOT_SIZE = 6;
const LOOP_MS = 1200;

export function TypingBubble({ night: isNight = false, testID }: TypingBubbleProps) {
  const { t } = useT();
  // One shared clock (`0 → 1`, looping) rather than 3 separate `Animated.loop`s — each
  // dot reads its own phase off the same driver via `interpolate`'s `inputRange`, so all
  // three stay perfectly in sync with each other across re-renders/remounts.
  const clock = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: LOOP_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [clock]);

  return (
    <View style={styles.aiWrap} testID={testID}>
      <GlassSurface
        tint="regular"
        night={isNight}
        radius={radius.bubble}
        style={styles.aiSurface}
        contentStyle={styles.aiContent}
      >
        <View style={styles.dotsRow} accessibilityLabel={t('advisor.thinking')} accessibilityRole="text">
          {Array.from({ length: DOT_COUNT }).map((_, index) => (
            <Dot key={index} clock={clock} index={index} night={isNight} />
          ))}
        </View>
      </GlassSurface>
    </View>
  );
}

interface DotProps {
  clock: Animated.Value;
  index: number;
  night: boolean;
}

/** Each dot's phase is offset by a third of the loop, so the three bounce in sequence, not in unison. */
function Dot({ clock, index, night: isNight }: DotProps) {
  const phase = index / DOT_COUNT;
  // A per-dot phase shift of the same shared `0 → 1` clock, wrapped with `modulo` so
  // every dot still starts and ends its own cycle at the resting position (opacity 0.35,
  // no vertical offset) no matter which third of the loop it was offset into.
  const shifted = Animated.modulo(Animated.add(clock, phase), 1);
  const opacity = shifted.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.35, 1, 0.35],
  });
  const translateY = shifted.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, -3, 0],
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: isNight ? night.text : colors.ink, opacity, transform: [{ translateY }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  aiWrap: { alignSelf: 'flex-start' },
  aiSurface: { borderBottomLeftRadius: radius.bubbleTail },
  aiContent: { paddingHorizontal: 14, paddingVertical: 13 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
});

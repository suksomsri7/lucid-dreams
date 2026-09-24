/** `.bub.ai` / `.bub.me` / `.bub.me.voice` — one line of the advisor conversation. */

import { StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { Icon } from './icons';
import { colors, night, radius, spacing, typeScale } from './tokens';

export type BubbleRole = 'ai' | 'me';

export interface BubbleProps {
  role: BubbleRole;
  text: string;
  /** User bubble built from a transcribed voice message (DESIGN §3.3) — shows a mic glyph. */
  voice?: boolean;
  time?: string;
  night?: boolean;
  /**
   * Overrides the default 300 (`AdvisorRoom.tsx` passes ~92% of its own content width,
   * Fable parity review round 3, so the fixture's one-sentence voice bubble stays on one
   * line like mockup 03 instead of wrapping) — a prop rather than a hardcoded value here
   * because the right number depends on the *consuming screen's* padding, which this
   * generic component doesn't know.
   */
  maxWidth?: number;
  testID?: string;
}

export function Bubble({ role, text, voice = false, time, night: isNight = false, maxWidth = 300, testID }: BubbleProps) {
  if (role === 'me') {
    return (
      <View style={[styles.meWrap, { maxWidth }]} testID={testID}>
        <GlassSurface
          tint="clear"
          background="rgba(107,92,255,0.82)"
          night={isNight}
          radius={radius.bubble}
          style={styles.meSurface}
          contentStyle={styles.meContent}
        >
          <View style={voice ? styles.voiceRow : undefined}>
            {voice ? <Icon name="mic" size={14} color={colors.white} /> : null}
            <Text style={[styles.bubbleText, styles.meText]}>{text}</Text>
          </View>
        </GlassSurface>
        {time ? <Text style={[typeScale.sub, styles.time, { color: isNight ? night.mut : colors.mut }]}>{time}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.aiWrap, { maxWidth }]} testID={testID}>
      <GlassSurface
        tint="regular"
        night={isNight}
        radius={radius.bubble}
        style={styles.aiSurface}
        contentStyle={styles.aiContent}
      >
        <Text style={[styles.bubbleText, { color: isNight ? night.text : colors.ink }]}>{text}</Text>
      </GlassSurface>
      {time ? <Text style={[typeScale.sub, styles.time, { color: isNight ? night.mut : colors.mut }]}>{time}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  aiWrap: { alignSelf: 'flex-start' },
  meWrap: { alignSelf: 'flex-end' },
  // Shape only (outer — affects the real clip mask, see GlassSurface.tsx's note on style vs contentStyle).
  aiSurface: { borderBottomLeftRadius: radius.bubbleTail },
  meSurface: { borderBottomRightRadius: radius.bubbleTail, borderColor: 'rgba(255,255,255,0.4)' },
  // Padding only (inner — insets the actual text/icon).
  aiContent: { paddingHorizontal: 14, paddingVertical: 11 },
  meContent: { paddingHorizontal: 14, paddingVertical: 11 },
  // 14 / 20 (Fable parity review round 3 — `_base.part`'s `.bub` is 14.5/auto; this is a
  // deliberate step tighter than `typeScale.body` so mockup 03's full plan state fits).
  bubbleText: { fontSize: 14, lineHeight: 20, fontWeight: typeScale.body.fontWeight },
  meText: { color: '#ffffff' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { marginTop: 4 },
});

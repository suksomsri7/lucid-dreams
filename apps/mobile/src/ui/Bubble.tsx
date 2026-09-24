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
  testID?: string;
}

export function Bubble({ role, text, voice = false, time, night: isNight = false, testID }: BubbleProps) {
  if (role === 'me') {
    return (
      <View style={styles.meWrap} testID={testID}>
        <GlassSurface
          tint="clear"
          background="rgba(107,92,255,0.82)"
          night={isNight}
          radius={radius.bubble}
          style={styles.meSurface}
        >
          <View style={voice ? styles.voiceRow : undefined}>
            {voice ? <Icon name="mic" size={14} color={colors.white} /> : null}
            <Text style={[typeScale.body, styles.meText]}>{text}</Text>
          </View>
        </GlassSurface>
        {time ? <Text style={[typeScale.sub, styles.time, { color: isNight ? night.mut : colors.mut }]}>{time}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.aiWrap} testID={testID}>
      <GlassSurface tint="regular" night={isNight} radius={radius.bubble} style={styles.aiSurface}>
        <Text style={[typeScale.body, { color: isNight ? night.text : colors.ink }]}>{text}</Text>
      </GlassSurface>
      {time ? <Text style={[typeScale.sub, styles.time, { color: isNight ? night.mut : colors.mut }]}>{time}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  aiWrap: { alignSelf: 'flex-start', maxWidth: 300 },
  meWrap: { alignSelf: 'flex-end', maxWidth: 300 },
  aiSurface: { paddingHorizontal: 14, paddingVertical: 11, borderBottomLeftRadius: radius.bubbleTail },
  meSurface: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomRightRadius: radius.bubbleTail,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  meText: { color: '#ffffff' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { marginTop: 4 },
});

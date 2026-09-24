/** `.btn` / `.btn.pri` / `.btn.acc` / `.btn.gh` / `.btn.dg` / `.btn.sm` / `.btn.blk` / `.btn.big`. */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { colors, night, radius, spacing, typeScale } from './tokens';

export type ButtonTone = 'pri' | 'acc' | 'gh' | 'dg';
export type ButtonSize = 'md' | 'sm' | 'big';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  tone?: ButtonTone;
  size?: ButtonSize;
  /** `.btn.blk` — stretches to the width of its container. */
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  night?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TONE_BACKGROUND: Record<ButtonTone, string> = {
  pri: colors.priSurface,
  acc: colors.accSurface,
  gh: colors.glass2,
  dg: colors.dgBg,
};

const TONE_BACKGROUND_NIGHT: Record<ButtonTone, string> = {
  pri: night.btn,
  acc: colors.accSurface,
  gh: night.glassBg,
  dg: night.btnDg,
};

const TONE_TEXT: Record<ButtonTone, string> = {
  pri: colors.white,
  acc: colors.white,
  gh: colors.ink,
  dg: colors.dg,
};

const TONE_TEXT_NIGHT: Record<ButtonTone, string> = {
  pri: night.text,
  acc: colors.white,
  gh: night.text,
  dg: night.btnDgText,
};

const SIZE_HEIGHT: Record<ButtonSize, number> = { md: 50, sm: 34, big: 60 };
const SIZE_RADIUS: Record<ButtonSize, number> = { md: radius.btn, sm: 17, big: 30 };
const SIZE_PADDING: Record<ButtonSize, number> = { md: 18, sm: 12, big: 22 };

export function Button({
  label,
  onPress,
  tone = 'pri',
  size = 'md',
  block = false,
  disabled = false,
  loading = false,
  icon,
  night: isNight = false,
  style,
  testID,
}: ButtonProps) {
  const background = isNight ? TONE_BACKGROUND_NIGHT[tone] : TONE_BACKGROUND[tone];
  const textColor = isNight ? TONE_TEXT_NIGHT[tone] : TONE_TEXT[tone];
  const isFilled = tone === 'pri' || tone === 'acc';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      testID={testID}
      style={[block ? styles.block : undefined, (disabled || loading) && styles.disabled, style]}
    >
      {({ pressed }) => (
        <GlassSurface
          tint={tone === 'gh' ? 'soft' : 'clear'}
          background={tone === 'gh' ? undefined : background}
          night={isNight}
          radius={SIZE_RADIUS[size]}
          style={[
            styles.surface,
            {
              height: SIZE_HEIGHT[size],
              paddingHorizontal: SIZE_PADDING[size],
              borderColor: isFilled ? 'rgba(255,255,255,0.3)' : undefined,
            },
            pressed ? styles.pressed : undefined,
          ]}
        >
          <View style={styles.row}>
            {loading ? (
              <ActivityIndicator color={textColor} size="small" />
            ) : (
              <>
                {icon}
                <Text
                  numberOfLines={1}
                  style={[size === 'big' ? typeScale.buttonBig : typeScale.button, { color: textColor }]}
                >
                  {label}
                </Text>
              </>
            )}
          </View>
        </GlassSurface>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: { justifyContent: 'center', alignItems: 'center' },
  block: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
});

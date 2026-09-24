/** `.chip` / `.chip.on` / `.chip.acc` / `.chip.rem` / `.chip.dg` / `.chip.sm` from `_base.part`. */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { colors, night, radius, spacing, typeScale } from './tokens';

export type ChipTone = 'default' | 'on' | 'acc' | 'rem' | 'dg';
export type ChipSize = 'md' | 'sm';

export interface ChipProps {
  label: string;
  tone?: ChipTone;
  size?: ChipSize;
  icon?: ReactNode;
  disabled?: boolean;
  night?: boolean;
  onPress?: () => void;
  testID?: string;
}

const TONE_BACKGROUND: Record<ChipTone, string> = {
  default: colors.glass,
  on: colors.priSurface,
  acc: colors.accSurfaceSoft,
  rem: colors.remBg,
  dg: colors.dgBg,
};

const TONE_BACKGROUND_NIGHT: Record<ChipTone, string> = {
  default: 'transparent',
  on: colors.priSurface,
  acc: colors.accSurfaceSoft,
  rem: night.chipRemBg,
  dg: colors.dgBg,
};

const TONE_TEXT: Record<ChipTone, string> = {
  default: colors.ink,
  on: colors.white,
  acc: colors.acc,
  rem: colors.rem,
  dg: colors.dg,
};

const TONE_TEXT_NIGHT: Record<ChipTone, string> = {
  default: night.chipText,
  on: colors.white,
  acc: colors.acc,
  rem: night.chipRemText,
  dg: colors.dg,
};

export function Chip({
  label,
  tone = 'default',
  size = 'md',
  icon,
  disabled = false,
  night: isNight = false,
  onPress,
  testID,
}: ChipProps) {
  const background = isNight ? TONE_BACKGROUND_NIGHT[tone] : TONE_BACKGROUND[tone];
  const textColor = isNight ? TONE_TEXT_NIGHT[tone] : TONE_TEXT[tone];
  const isOn = tone === 'on';
  const content = (
    <View style={[styles.row, size === 'sm' ? styles.rowSm : styles.rowMd]}>
      {icon}
      <Text
        numberOfLines={1}
        style={[
          size === 'sm' ? typeScale.chipSm : typeScale.chip,
          { color: textColor, fontWeight: isOn ? '600' : typeScale.chip.fontWeight },
        ]}
      >
        {label}
      </Text>
    </View>
  );

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={disabled || !onPress}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [pressed && onPress ? styles.pressed : undefined, disabled ? styles.disabled : undefined]}
    >
      <GlassSurface
        tint={tone === 'default' && isNight ? 'clear' : 'regular'}
        night={isNight}
        radius={radius.chip}
        style={[
          styles.surface,
          { backgroundColor: background },
          isNight && tone === 'default' ? styles.nightOutline : undefined,
        ]}
      >
        {content}
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: { borderWidth: StyleSheet.hairlineWidth },
  nightOutline: { borderColor: night.chipBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowMd: { height: 36, paddingHorizontal: 15 },
  rowSm: { height: 26, paddingHorizontal: 10 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});

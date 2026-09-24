/** `.card` / `.card.soft` / `.card.acc` from `_base.part`. */

import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { radius, spacing } from './tokens';

export type GlassCardVariant = 'regular' | 'soft' | 'acc';

export interface GlassCardProps {
  children?: ReactNode;
  variant?: GlassCardVariant;
  night?: boolean;
  /** `.card.p0` — no internal padding, for surfaces that lay out their own edges. */
  noPadding?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GlassCard({
  children,
  variant = 'regular',
  night = false,
  noPadding = false,
  style,
  testID,
}: GlassCardProps) {
  return (
    <GlassSurface
      tint={variant}
      night={night}
      radius={radius.card}
      testID={testID}
      style={[noPadding ? undefined : styles.padded, style]}
    >
      {children}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  padded: { padding: spacing.lg, gap: spacing.md },
});

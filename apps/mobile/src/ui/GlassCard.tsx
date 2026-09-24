/** `.card` / `.card.soft` / `.card.acc` from `_base.part` (`.ch .h2` is the optional section title). */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { SectionLabel } from './Type';
import { radius, spacing } from './tokens';

export type GlassCardVariant = 'regular' | 'soft' | 'acc';

export interface GlassCardProps {
  children?: ReactNode;
  variant?: GlassCardVariant;
  /** Optional uppercase section label above the content (`.ch .h2`). */
  title?: string;
  night?: boolean;
  /** `.card.p0` — no internal padding, for surfaces that lay out their own edges. */
  noPadding?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GlassCard({
  children,
  variant = 'regular',
  title,
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
      {title === undefined ? null : (
        <View style={styles.header}>
          <SectionLabel night={night}>{title}</SectionLabel>
        </View>
      )}
      {children}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  padded: { padding: spacing.lg, gap: spacing.md },
  header: { marginBottom: -4 },
});

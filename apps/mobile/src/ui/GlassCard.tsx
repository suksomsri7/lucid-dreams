/**
 * `.card` / `.card.soft` / `.card.acc` from `_base.part` (`.ch .h2` is the optional section title).
 *
 * `style` mirrors `GlassSurface`'s own split: it is how the card sits in *its own*
 * parent (`flexGrow`, `flexBasis`, `marginTop`, self-alignment). `contentStyle`
 * overrides how the card arranges *its own* children — the default is a column with
 * `spacing.md` gap (`.card`'s padding), forwarded straight to `GlassSurface`'s
 * `contentStyle` so it lands on a box that is actually sized that way (see the long
 * comment in `GlassSurface.tsx` for why that distinction exists).
 */

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
  /** How the card sits in *its own* parent (sizing, margin, self-alignment). */
  style?: StyleProp<ViewStyle>;
  /** How the card arranges *its own* children — default is a column with `spacing.md` gap. */
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GlassCard({
  children,
  variant = 'regular',
  title,
  night = false,
  noPadding = false,
  style,
  contentStyle,
  testID,
}: GlassCardProps) {
  return (
    <GlassSurface
      tint={variant}
      night={night}
      radius={radius.card}
      testID={testID}
      style={style}
      contentStyle={[noPadding ? undefined : styles.padded, contentStyle]}
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

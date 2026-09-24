/**
 * `.card` / `.card.soft` / `.card.acc` from `_base.part` (`.ch .h2` is the optional section title).
 *
 * `GlassSurface`'s platform layer (`src/platform/shared/BlurSurface.tsx` /
 * `src/platform/ios/GlassSurface.tsx`) always wraps its children in one extra `View`
 * (needed so `BlurView`/`GlassView` sizes correctly around flexible content) — so a
 * `flexDirection`/`gap` passed on the *outer* `style` never reaches the real children,
 * which still stack in RN's default column with no spacing. `style` on `GlassCard`
 * therefore means "how this card sits in its own parent" (`flexGrow`, `flexBasis`,
 * `marginTop`, …); anything that arranges the card's *own* children goes through the
 * separate `contentStyle` prop, applied to an inner `View` this component owns.
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
    <GlassSurface tint={variant} night={night} radius={radius.card} testID={testID} style={style}>
      <View style={[noPadding ? undefined : styles.padded, contentStyle]}>
        {title === undefined ? null : (
          <View style={styles.header}>
            <SectionLabel night={night}>{title}</SectionLabel>
          </View>
        )}
        {children}
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  padded: { padding: spacing.lg, gap: spacing.md },
  header: { marginBottom: -4 },
});

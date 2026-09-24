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
        <View style={[styles.header, noPadding ? styles.headerPadded : undefined]}>
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
  // `noPadding` leaves the whole content box unpadded on purpose (edge-to-edge row
  // dividers) — but the title label still sits inside `radius.card`'s own top-left
  // curve at x=0/y=0 and gets visually clipped by the surface's `overflow: hidden`
  // mask without its own inset (found via `settings.tsx`'s `?fixture=` screenshot,
  // WO L3ui — every section label in mockup `09-settings.png` was cut to its last
  // few characters before this fix). Padded cards do not need this: their shared
  // `padded` content style already insets everything, header included.
  headerPadded: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, marginBottom: -4 + spacing.xs },
});

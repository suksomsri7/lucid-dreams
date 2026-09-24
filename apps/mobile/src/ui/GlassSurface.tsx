/**
 * The design-system glass wrapper (WO L1.2). This is **not** where the platform
 * decision between real Liquid Glass and the `expo-blur` fallback happens — that is
 * `src/platform/GlassSurface(.ios).tsx`, picked by Metro at bundle time (APP-RUN §0.2
 * rule 8). This file only adds the token-driven look on top: which tint, how strong the
 * blur reads, and the light/night border + shadow, all from `_base.part`'s `.glass`
 * rule and its `.night` override.
 *
 * 🔴 Background color is drawn as an inner overlay `View`, not as `style.backgroundColor`
 * on the surface itself — on the web fallback (`expo-blur`'s `BlurView.web.tsx`), the
 * component always appends its own `tint`/`intensity`-derived color *after* the caller's
 * `style` in the array it hands to the underlying `View`
 * (`style={[style, blurStyle]}`, `blurStyle.backgroundColor = getBackgroundColor(...)`),
 * so any `backgroundColor` this component put in `style` was silently replaced by a flat
 * pale tint no matter what tone was asked for — every solid tone (`Button` pri/acc/dg,
 * `Chip` on/acc/rem/dg, `Bubble` me, `GlassCard` acc) rendered as washed-out grey on the
 * web QC build that oracle U6.3 exports from. A `View` that is a *child* of the surface
 * paints on top of the surface's own background regardless of what color the surface
 * picked, so putting the real color there survives the override. Caught by screenshotting
 * `/dev/ui` during this WO — see `ledger/wo-notes/L1.2.md`.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GlassSurface as PlatformGlassSurface } from '../platform';
import { colors, night, radius, shadow } from './tokens';

export type GlassTint = 'regular' | 'soft' | 'acc' | 'clear';

export interface GlassSurfaceProps {
  children?: ReactNode;
  /** Layout/sizing/border overrides — anything except background (see `background` below). */
  style?: StyleProp<ViewStyle>;
  /** `.glass` (regular) · `.card.soft` (soft) · `.card.acc` (acc) · near-transparent (clear). */
  tint?: GlassTint;
  /**
   * Explicit background override for tones `tint` doesn't cover (`Button.pri`,
   * `Chip.rem`, `Bubble.me`, …). Always wins over `tint`'s default when given.
   */
  background?: string;
  /**
   * Mirrors the CSS `backdrop-filter: blur(24px)` strength, 0–100. Only ever visible on
   * the blur fallback (`BlurView`'s `intensity`) — real Liquid Glass ignores it, same as
   * `expo-glass-effect` has no blur-strength knob.
   */
  intensity?: number;
  /** Night screen only (DESIGN §2.8: the one dark screen) — flips to the `.night` tokens. */
  night?: boolean;
  /** Corner radius; defaults to the card radius (24). */
  radius?: number;
  testID?: string;
}

const TINT_BACKGROUND: Record<GlassTint, string> = {
  regular: colors.glass,
  soft: colors.glass2,
  acc: colors.accSurfaceSoft,
  clear: 'transparent',
};

const TINT_BACKGROUND_NIGHT: Record<GlassTint, string> = {
  regular: night.glassBg,
  soft: night.glassBg,
  acc: colors.accSurfaceSoft,
  clear: 'transparent',
};

export function GlassSurface({
  children,
  style,
  tint = 'regular',
  background,
  intensity = 60,
  night: isNight = false,
  radius: cornerRadius = radius.card,
  testID,
}: GlassSurfaceProps) {
  const variant = tint === 'clear' || intensity < 40 ? 'clear' : 'regular';
  const resolvedBackground = background ?? (isNight ? TINT_BACKGROUND_NIGHT[tint] : TINT_BACKGROUND[tint]);
  const borderColor = isNight ? night.glassBorder : colors.glassLine;

  return (
    <PlatformGlassSurface
      variant={variant}
      scheme={isNight ? 'dark' : 'light'}
      testID={testID}
      style={[
        styles.base,
        isNight ? shadow.night : shadow.glass,
        { borderRadius: cornerRadius, borderColor },
        style,
      ]}
    >
      {resolvedBackground === 'transparent' ? null : (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: resolvedBackground, borderRadius: cornerRadius }]}
        />
      )}
      {children}
    </PlatformGlassSurface>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});

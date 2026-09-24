/**
 * The design-system glass wrapper (WO L1.2). This is **not** where the platform
 * decision between real Liquid Glass and the `expo-blur` fallback happens — that is
 * `src/platform/GlassSurface(.ios).tsx`, picked by Metro at bundle time (APP-RUN §0.2
 * rule 8). This file only adds the token-driven look on top: which tint, how strong the
 * blur reads, and the light/night border + shadow, all from `_base.part`'s `.glass`
 * rule and its `.night` override.
 *
 * Two bugs in the platform layer forced a specific shape here (both found by
 * screenshotting `/dev/ui` during this WO — see `ledger/wo-notes/L1.2.md`):
 *
 * 1. 🔴 **Background is a child `View`, not `style.backgroundColor`.** On the web
 *    fallback, `expo-blur`'s `BlurView.web.tsx` always appends its own
 *    `tint`/`intensity`-derived color *after* the caller's `style`
 *    (`style={[style, blurStyle]}`), so a `backgroundColor` set there is silently
 *    replaced by a flat pale tint no matter what tone was asked for. A `View` that is a
 *    *child* of the surface paints on top of the surface's own background regardless of
 *    what color the surface itself picked, so the real color lives there instead —
 *    exposed via the `background` prop.
 * 2. 🔴 **`style` (outer) and `contentStyle` (inner) are not interchangeable.** Both
 *    `BlurSurface`/`ios/GlassSurface` wrap `children` in one more `View`
 *    (`{flexShrink: 1}`, no `flex: 1` — an auto-height parent with a `flex: 1` child
 *    collapses to 0, so it can't just grow to fill). A `height`/`padding`/`flexDirection`
 *    set on the *outer* surface's `style` therefore never reaches a box that really has
 *    that size — it lands on an element whose only child is the auto-sized wrapper, so
 *    the visible colored box (`background`, above) would hug just the text instead of
 *    the intended button/card size. `contentStyle` is applied to a `View` this component
 *    renders as the *direct* parent of `children`, so sizing/padding/flex-arrangement
 *    set there actually takes effect. `style` stays for what genuinely belongs on the
 *    outer box: how the surface sits in *its own* parent (`flexGrow`, `alignSelf`, …)
 *    and shape overrides that must affect the real clip mask (`Bubble`'s tail corner).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GlassSurface as PlatformGlassSurface } from '../platform';
import { colors, night, radius, shadow } from './tokens';

export type GlassTint = 'regular' | 'soft' | 'acc' | 'clear';

export interface GlassSurfaceProps {
  children?: ReactNode;
  /** How this surface sits in *its own* parent, plus shape overrides (e.g. a bubble tail corner). */
  style?: StyleProp<ViewStyle>;
  /** How this surface's *own* content is sized/padded/arranged — see the note above. */
  contentStyle?: StyleProp<ViewStyle>;
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
  contentStyle,
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
      style={[styles.base, isNight ? shadow.night : shadow.glass, { borderRadius: cornerRadius, borderColor }, style]}
    >
      <View style={[resolvedBackground === 'transparent' ? undefined : { backgroundColor: resolvedBackground }, contentStyle]}>
        {children}
      </View>
    </PlatformGlassSurface>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});

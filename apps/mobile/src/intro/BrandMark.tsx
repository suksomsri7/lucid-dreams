/**
 * The Zzz mark from the app icon, drawn as vectors (WO L3.7 §B3 · mockup
 * `ledger/design-app/11-splash.png`).
 *
 * The three paths, the stroke widths, the gradient and the highlight offset below are
 * copied byte-for-byte from `ledger/design-icon/logo-M-glyphs.svg`, which is the source
 * the 1024² `assets/icon.png` was rendered from — so the launch screen and the home-screen
 * icon are the same drawing, not two drawings that look alike. Drawing it rather than
 * shipping a second PNG keeps it crisp at any size and lets the halo animate behind it.
 *
 * ## Why the shadow is a stack of flat copies instead of a blur
 * The SVG source uses `feDropShadow dy=18 stdDeviation=18`. `react-native-svg` 15.15.5 does
 * ship filter elements, but its iOS/Android native side implements only the primitive set
 * (`FeGaussianBlur`/`FeOffset`/`FeFlood`/`FeComposite`/`FeMerge` — there is no
 * `RNSVGFeDropShadow.mm` in `node_modules/react-native-svg/apple/Filters`), so a
 * `<FeDropShadow>` that renders correctly in the web QC export would be a different (or
 * missing) drawing on the phone, which is the one place nobody can check before R1. The WO
 * calls for offset copies for exactly that reason; this uses a stack of progressively *wider*
 * copies at one offset instead of progressively lower ones — see {@link SHADOW_RINGS}.
 *
 * ## Why the halo is an `<Svg>` and not a `borderRadius` View
 * It is a radial gradient (soft edge, no ring), which React Native's `View` cannot express —
 * same call `src/ui/AppBackground.tsx` and `src/night/Orb.tsx` already made.
 */

import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Drawing box of the mark, in points — the native splash uses the same 200 (`app.config.ts`). */
export const LOGO_SIZE = 200;

/** Halo diameter at rest (WO §B3); the peak state scales it to 300 via {@link HALO_PEAK_SCALE}. */
export const HALO_SIZE = 260;

/** 300 / 260 — the halo's "the tone is playing right now" size (mockup 11, frame b). */
export const HALO_PEAK_SCALE = 300 / HALO_SIZE;

/**
 * Where the ink actually sits inside the 1024 viewBox: the three strokes span
 * x 183…840 and y 173…871 once half of each stroke width is counted, so the optical
 * centre is 0.4995 / 0.5098 of the box — i.e. horizontally centred, a hair below the
 * middle vertically. `IntroOverlay` uses this to hang the halo (and, through it, the
 * whole composition) off the mark's optical centre instead of the box's geometric one.
 */
export const INK_CENTER_Y = Math.round(LOGO_SIZE * 0.5098);

const VIEW_BOX = 1024;

/** The three Zzz strokes — identical to `ledger/design-icon/logo-M-glyphs.svg`. */
const GLYPHS = [
  { d: 'M208 198 H528 L208 518 H528', width: 50, highlight: 14 },
  { d: 'M578 388 H818 L578 628 H818', width: 44, highlight: 12 },
  { d: 'M300 662 H500 L300 852 H500', width: 38, highlight: 10 },
] as const;

/** Stroke gradient, top → bottom (`#gw` in the SVG source). */
const STROKE_TOP = '#ffffff';
const STROKE_BOTTOM = '#f0eeff';

/** `flood-color` of the source's drop shadow. */
const SHADOW_COLOR = '#4b3fb8';

/** The whole shadow sits this far below the mark, matching the source SVG's `dy: 18`. */
const SHADOW_DY = 18;

/**
 * The stand-in for `stdDeviation: 18`: five copies of the same paths at one offset, each a
 * little **wider** than the last and a little fainter. Widening, not offsetting further — a
 * Gaussian blur spreads a stroke in every direction at once, and stacking copies *downwards*
 * instead (the WO's literal suggestion, and the first thing tried here) slides the copy along
 * the Z's 45° diagonals as well as down them, which renders as a solid extruded band beside
 * every diagonal rather than a shade under it.
 *
 * Fitted to mockup 11 by subtracting the halo's own contribution first (at the pixels just
 * below a stroke the halo is already worth ≈ 8 % on its own, so the raw reading over-states the
 * shadow): the shadow itself is ≈ .215 at the stroke's edge, ≈ .10 five points down, ≈ .04
 * seven points down and gone by nine — plus a hair of it (≈ .04) half a point *above* the
 * stroke, which only the two widest rings reach. Each ring covers down to `18 + grow / 2` units
 * from the edge, so the alphas below stack to exactly that profile.
 */
const SHADOW_RINGS = [
  { grow: 0, alpha: 0.065 },
  { grow: 14, alpha: 0.065 },
  { grow: 28, alpha: 0.065 },
  { grow: 42, alpha: 0.028 },
  { grow: 56, alpha: 0.012 },
] as const;

/** Violet of the halo — `colors.acc`, but this file may not import UI tokens for an SVG stop. */
const HALO_COLOR = '#6b5cff';

/**
 * Peak alpha of the halo's centre stop. Deliberately low: the animated opacity on top of it
 * runs .35 → .7 (see `IntroOverlay`), so the strongest the glow ever gets over the pastel
 * background is ≈ .126 — which is what mockup 11 actually measures (the background reads
 * (242,243,250) far from the mark and (230,228,250) beside it, i.e. about 9 % violet).
 * Using the WO's .35 here directly would have been three times the mockup's glow.
 */
const HALO_CORE_ALPHA = 0.18;

export interface BrandMarkProps {
  /**
   * 0 → 1, driven by `IntroOverlay`: 0 is the quietest point of the breathing loop, ~0.72
   * its brightest, 1 the "the tone is playing" peak. Interpolated here rather than in the
   * parent so the halo's look lives with the halo's drawing.
   */
  glow: Animated.Value;
}

export function BrandMark({ glow }: BrandMarkProps) {
  const haloOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  const haloScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, HALO_PEAK_SCALE] });

  return (
    <View style={styles.box}>
      <Animated.View
        style={[styles.halo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
        pointerEvents="none"
      >
        <Svg width={HALO_SIZE} height={HALO_SIZE}>
          <Defs>
            <RadialGradient id="introHalo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={HALO_COLOR} stopOpacity={HALO_CORE_ALPHA} />
              <Stop offset="0.55" stopColor={HALO_COLOR} stopOpacity={HALO_CORE_ALPHA * 0.45} />
              <Stop offset="1" stopColor={HALO_COLOR} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={HALO_SIZE} height={HALO_SIZE} fill="url(#introHalo)" />
        </Svg>
      </Animated.View>

      {/*
        The mark has to be wrapped and given an explicit `zIndex`, not just written after the
        halo: on web the halo is `position: absolute`, and CSS paints positioned elements above
        in-flow content regardless of source order — the halo was tinting the white strokes
        (measured (244,243,255) where mockup 11 has (255,255,255)). Both are flex children here,
        so `zIndex` is honoured on web and on native alike.
      */}
      <View style={styles.mark}>
        <Svg width={LOGO_SIZE} height={LOGO_SIZE} viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`} fill="none">
          <Defs>
            {/*
              `userSpaceOnUse` over the whole 1024 viewBox, not the default per-element bounding
              box: with the default, each of the three strokes runs the full white → `#f0eeff`
              ramp inside its own short height, so every glyph ends noticeably grey and the mark
              reads lavender instead of white (measured: bottom of each stroke (240,238,255),
              against mockup 11's (250,250,255)). One ramp across the mark is also what the
              browser rendering of `logo-M-glyphs.svg` looks like, which is what the mockup is.
            */}
            <LinearGradient
              id="introStroke"
              x1="0"
              y1="0"
              x2="0"
              y2={VIEW_BOX}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={STROKE_TOP} />
              <Stop offset="1" stopColor={STROKE_BOTTOM} />
            </LinearGradient>
          </Defs>

          {/* Widest ring first, so the tighter, darker ones land on top of it. */}
          {[...SHADOW_RINGS].reverse().map((ring) => (
            <G
              key={ring.grow}
              transform={`translate(0,${SHADOW_DY})`}
              stroke={SHADOW_COLOR}
              opacity={ring.alpha}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {GLYPHS.map((glyph) => (
                <Path key={glyph.d} d={glyph.d} strokeWidth={glyph.width + ring.grow} />
              ))}
            </G>
          ))}

          <G stroke="url(#introStroke)" strokeLinecap="round" strokeLinejoin="round">
            {GLYPHS.map((glyph) => (
              <Path key={glyph.d} d={glyph.d} strokeWidth={glyph.width} />
            ))}
          </G>

          {/* Top highlight: the same paths, 7 units up, thin and white — the "glass" read. */}
          <G
            transform="translate(0,-7)"
            stroke={STROKE_TOP}
            opacity={0.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {GLYPHS.map((glyph) => (
              <Path key={glyph.d} d={glyph.d} strokeWidth={glyph.highlight} />
            ))}
          </G>
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: LOGO_SIZE, height: LOGO_SIZE, alignItems: 'center', justifyContent: 'center' },
  mark: { zIndex: 1 },
  halo: {
    zIndex: 0,
    position: 'absolute',
    width: HALO_SIZE,
    height: HALO_SIZE,
    left: (LOGO_SIZE - HALO_SIZE) / 2,
    top: INK_CENTER_Y - HALO_SIZE / 2,
  },
});

/**
 * `AppBackground` / `NightBackground` — the pastel / deep-blue gradients behind every
 * screen (`.frame.m` / `.frame.m.night` in `_base.part`). Rendered with
 * `react-native-svg`'s `RadialGradient` so the three blobs are true radial gradients
 * (not an approximation with blurred Views), matching the mockups closely enough for
 * a pixel comparison and staying resolution-independent (`cx`/`cy`/`r` are percentages
 * of the surface, same as the CSS `at 15% 8%` syntax).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { appBackground, type BackgroundSpec, nightBackground } from './tokens';

interface BackgroundSurfaceProps {
  spec: BackgroundSpec;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function BackgroundSurface({ spec, children, style, testID }: BackgroundSurfaceProps) {
  return (
    <View style={[styles.fill, style]} testID={testID}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="base" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={spec.linearFrom} stopOpacity={1} />
            <Stop offset="1" stopColor={spec.linearTo} stopOpacity={1} />
          </LinearGradient>
          {spec.blobs.map((blob, index) => (
            <RadialGradient
              // eslint-disable-next-line react/no-array-index-key -- blobs are a fixed-length spec, never reordered
              key={index}
              id={`blob-${index}`}
              cx={blob.cx}
              cy={blob.cy}
              r={blob.r}
              gradientUnits="objectBoundingBox"
            >
              <Stop offset="0" stopColor={blob.color} stopOpacity={blob.opacity} />
              <Stop offset="0.7" stopColor={blob.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#base)" />
        {spec.blobs.map((_blob, index) => (
          // eslint-disable-next-line react/no-array-index-key -- blobs are a fixed-length spec, never reordered
          <Rect key={index} x="0" y="0" width="100%" height="100%" fill={`url(#blob-${index})`} />
        ))}
      </Svg>
      {children}
    </View>
  );
}

export interface AppBackgroundProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** DESIGN §2.8 — the pastel background behind every screen except the night screen. */
export function AppBackground({ children, style, testID }: AppBackgroundProps) {
  return (
    <BackgroundSurface spec={appBackground} style={style} testID={testID}>
      {children}
    </BackgroundSurface>
  );
}

/** DESIGN §2.8 — the one dark screen (jo klangkuen / lock screen, L2.8). */
export function NightBackground({ children, style, testID }: AppBackgroundProps) {
  return (
    <BackgroundSurface spec={nightBackground} style={style} testID={testID}>
      {children}
    </BackgroundSurface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

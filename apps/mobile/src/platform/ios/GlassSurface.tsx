/**
 * Real Liquid Glass (iOS 26+) — the only file in the app allowed to import
 * `expo-glass-effect` (APP-RUN §0.2 rule 8 · oracle S3.7).
 *
 * DESIGN §2.8: every surface floats as frosted glass. Where the real effect is not
 * available (iOS 25 and below, Android, and the web build QC screenshots come from)
 * the app falls back to `platform/shared/BlurSurface`. The choice is made by Metro at
 * bundle time through `src/platform/GlassSurface.tsx` / `.ios.tsx`, so this module and
 * `expo-glass-effect` never enter the web or Android bundle at all.
 *
 * The full design-token version of this component (radius, border, highlight) is L1.2;
 * here it only has to exist and prove the native effect renders on device in R1.
 */

import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BlurSurface } from '../shared/BlurSurface';

export interface GlassSurfaceProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `regular` = frosted panel (default) · `clear` = barely-there capsule. */
  variant?: 'regular' | 'clear';
  /** Night screen only (DESIGN §2.8: the one dark screen). */
  scheme?: 'light' | 'dark' | 'auto';
  testID?: string;
}

/** `true` when this build is actually drawing Apple's glass, not our blur fallback. */
export function hasRealGlass(): boolean {
  return isLiquidGlassAvailable();
}

export function GlassSurface({
  children,
  style,
  variant = 'regular',
  scheme = 'auto',
  testID,
}: GlassSurfaceProps) {
  // Some iOS 26 betas ship the class but not the effect — expo-glass-effect tells us,
  // and we must not crash the night screen over a visual nicety.
  if (!isLiquidGlassAvailable()) {
    return (
      <BlurSurface style={style} variant={variant} scheme={scheme} testID={testID}>
        {children}
      </BlurSurface>
    );
  }

  return (
    <GlassView
      style={[styles.surface, style]}
      glassEffectStyle={variant}
      colorScheme={scheme}
      testID={testID}
    >
      <View style={styles.content}>{children}</View>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  content: {
    flexShrink: 1,
  },
});

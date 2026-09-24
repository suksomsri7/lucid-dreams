/**
 * Frosted-glass fallback for everything that is not iOS 26+: Android, older iOS, and
 * the web build the QC screenshots come from (APP-RUN §0.2 rule 2).
 *
 * `expo-blur` is cross-platform, so this file may live outside `platform/ios`.
 * On web `expo-blur` degrades to a translucent panel, which is exactly what the
 * mockup comparison needs.
 */

import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export interface BlurSurfaceProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'regular' | 'clear';
  scheme?: 'light' | 'dark' | 'auto';
  testID?: string;
}

/** Fallback never reports real glass. */
export function hasRealGlass(): boolean {
  return false;
}

export function BlurSurface({
  children,
  style,
  variant = 'regular',
  scheme = 'auto',
  testID,
}: BlurSurfaceProps) {
  return (
    <BlurView
      intensity={variant === 'clear' ? 28 : 55}
      tint={scheme === 'dark' ? 'dark' : 'light'}
      style={[styles.surface, style]}
      testID={testID}
    >
      <View style={styles.content}>{children}</View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: 28,
    overflow: 'hidden',
    // 55-70% white per DESIGN §2.8 — real design tokens arrive in L1.2
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  content: {
    flexShrink: 1,
  },
});

/**
 * The scaffold every tab screen shares: `AppBackground` (or `NightBackground`) behind a
 * safe-area scroll view, room left at the bottom for `FloatingTabBar`. Not one of the 14
 * named components either — see `Type.tsx` for why a small scaffold layer still exists.
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground, NightBackground } from './AppBackground';
import { spacing } from './tokens';

export interface ScreenProps {
  children?: ReactNode;
  night?: boolean;
  /** Leaves room for the floating tab bar (default true — every tab screen has one). */
  withTabBarInset?: boolean;
  /**
   * Extra style merged onto the `ScrollView`'s `contentContainerStyle` (WO L1.3): a
   * screen with a footer button pinned to the bottom (onboarding's welcome screen,
   * mockup 01(a)) passes `{ flexGrow: 1 }` here so short content still pushes the
   * button down instead of leaving it right under the last card. Every existing screen
   * omits this and keeps its old layout untouched.
   */
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  night: isNight = false,
  withTabBarInset = true,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const Background = isNight ? NightBackground : AppBackground;

  return (
    <Background style={styles.fill} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + (withTabBarInset ? 120 : spacing.xxl),
          },
          contentStyle,
        ]}
      >
        {children}
      </ScrollView>
    </Background>
  );
}

/** For screens (dev/ui gallery sections) that need the gradient without a scroll view. */
export function ScreenStatic({ children, night: isNight = false, testID }: Omit<ScreenProps, 'withTabBarInset'>) {
  const Background = isNight ? NightBackground : AppBackground;
  return (
    <Background style={styles.fill} testID={testID}>
      <View style={styles.content}>{children}</View>
    </Background>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
});

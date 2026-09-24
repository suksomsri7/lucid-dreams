/**
 * The smallest possible set of building blocks so L1.1 can render three tab shells
 * and one Diagnostics screen on device *and* on the web.
 *
 * This is **not** the design system. L1.2 replaces all of it with real tokens taken
 * from `ledger/design-app/_base.part` (GlassCard, Chip, Button variants, FloatingTabBar).
 * Nothing here hard-codes a user-visible string: every label comes from `src/i18n`.
 */

import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassSurface } from '../platform';

/** Very light lavender background (DESIGN §2.8). Real tokens land in L1.2. */
export const BACKGROUND = '#F4F1FB';
export const INK = '#15131C';
export const INK_SOFT = '#5C5769';
export const ACCENT = '#6C4CE0';
export const MINT = '#2FBF9A';

export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 48 },
        ]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Card({
  title,
  children,
  style,
  testID,
}: {
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <GlassSurface style={[styles.card, style]} testID={testID}>
      {title === undefined ? null : <Text style={styles.cardTitle}>{title}</Text>}
      {children}
    </GlassSurface>
  );
}

export function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost';
  disabled?: boolean;
  testID?: string;
}) {
  const isPrimary = tone === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonGhost,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.buttonLabel, isPrimary ? styles.buttonLabelPrimary : styles.buttonLabelGhost]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BACKGROUND },
  scroll: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 30, fontWeight: '700', color: INK },
  subtitle: { fontSize: 15, color: INK_SOFT, marginTop: -8 },
  card: { padding: 18, gap: 10 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: INK_SOFT, letterSpacing: 0.6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowLabel: { flexShrink: 1, fontSize: 15, color: INK_SOFT },
  rowValue: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: INK, textAlign: 'right' },
  button: { borderRadius: 999, paddingVertical: 13, paddingHorizontal: 22, alignItems: 'center' },
  buttonPrimary: { backgroundColor: ACCENT },
  buttonGhost: { backgroundColor: 'rgba(255,255,255,0.6)' },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  buttonLabelPrimary: { color: '#FFFFFF' },
  buttonLabelGhost: { color: INK },
  note: { fontSize: 13, color: INK_SOFT, lineHeight: 19 },
});

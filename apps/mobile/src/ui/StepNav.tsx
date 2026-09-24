/**
 * `.nav` — back chevron + screen title + an optional trailing label (a "แก้" link) or
 * step badge ("ขั้น 1/3") on the right. Shared by the four pre-start screens (WO
 * L1.7ui, mockup `04-dream-plan.png`) — every one of them opens with exactly this row.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './icons';
import { colors, night, spacing, typeScale } from './tokens';

export interface StepNavProps {
  title: string;
  /** e.g. "ขั้น 1/3" — mutually fine to combine with `right` (mockup 04(b) has both). */
  step?: string;
  /** e.g. the plan screen's "แก้" link. Rendered instead of `step` when both are given room. */
  right?: ReactNode;
  onBack: () => void;
  night?: boolean;
  testID?: string;
}

export function StepNav({ title, step, right, onBack, night: isNight = false, testID }: StepNavProps) {
  return (
    <View style={styles.row} testID={testID}>
      <Pressable
        accessibilityRole="button"
        hitSlop={10}
        onPress={onBack}
        style={styles.back}
        testID={testID ? `${testID}-back` : undefined}
      >
        <Icon name="chevronLeft" size={18} color={isNight ? night.text : colors.ink} strokeWidth={2} />
      </Pressable>
      <Text
        numberOfLines={1}
        style={[typeScale.h2, styles.title, { color: isNight ? night.text : colors.ink }]}
      >
        {title}
      </Text>
      {step ? (
        <Text style={[typeScale.sub, { color: isNight ? night.mut : colors.mut }]}>{step}</Text>
      ) : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 30 },
  back: { width: 26, height: 26, alignItems: 'flex-start', justifyContent: 'center' },
  title: { flex: 1 },
});

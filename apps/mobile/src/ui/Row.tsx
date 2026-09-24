/** `.li` — a label/value settings or diagnostics row, with an optional right-side chevron. */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './icons';
import { colors, night, spacing, typeScale } from './tokens';

export interface RowProps {
  label: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  night?: boolean;
  testID?: string;
}

export function Row({ label, value, right, onPress, last = false, night: isNight = false, testID }: RowProps) {
  const content = (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isNight ? night.glassBorder : colors.hairline },
      ]}
      testID={testID}
    >
      <Text numberOfLines={2} style={[typeScale.body, styles.label, { color: isNight ? night.text : colors.ink, fontWeight: '600' }]}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={2} style={[typeScale.body, { color: isNight ? night.sub : colors.ink2 }]}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? <Icon name="chevronRight" size={16} color={isNight ? night.mut : colors.mut} /> : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 50, paddingVertical: spacing.sm },
  label: { flex: 1 },
});

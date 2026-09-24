/** `.seg` — a segmented control (used for language th/en, ear-test round counts, …). */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, night, radius, spacing, typeScale } from './tokens';

export interface SegOption {
  value: string;
  label: string;
}

export interface SegProps {
  options: SegOption[];
  value: string;
  onChange: (value: string) => void;
  night?: boolean;
  testID?: string;
}

export function Seg({ options, value, onChange, night: isNight = false, testID }: SegProps) {
  return (
    <View
      style={[
        styles.track,
        { backgroundColor: isNight ? night.glassBg : 'rgba(17,19,24,0.06)', borderColor: isNight ? night.glassBorder : colors.glassLine },
      ]}
      testID={testID}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            testID={testID ? `${testID}-${option.value}` : undefined}
            style={[styles.item, on ? styles.itemOn : undefined]}
          >
            <Text
              numberOfLines={1}
              style={[typeScale.chip, { color: on ? colors.ink : isNight ? night.sub : colors.ink2, fontWeight: on ? '600' : '400' }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.seg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: spacing.xs,
    // Never let a flex:1 sibling (e.g. `Row`'s label) squeeze this below a readable
    // width — each `item` below carries its own `minWidth: 72`, and Yoga folds a
    // child's minWidth into its parent's own minimum, so this is really "2 × 72 + gaps
    // + padding" made explicit for anyone reading the style, not a magic number.
    minWidth: 2 * 72 + spacing.xs + 6,
  },
  item: {
    flex: 1,
    minWidth: 72,
    height: 34,
    borderRadius: radius.segItem,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  itemOn: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: 'rgba(40,40,90,1)',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
});

/** `.scale` — the 0–10 (or 1–5) glass number-chip row used by the morning check-in. */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, night, radius, spacing, typeScale } from './tokens';

export interface ScaleProps {
  /** Inclusive lower bound, e.g. 0 for "did you dream" or 1 for the ear test round count. */
  min?: number;
  /** Inclusive upper bound, e.g. 10 or 5. */
  max?: number;
  value: number | null;
  onChange: (value: number) => void;
  night?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function Scale({ min = 0, max = 10, value, onChange, night: isNight = false, disabled = false, testID }: ScaleProps) {
  const steps: number[] = [];
  for (let n = min; n <= max; n += 1) steps.push(n);

  return (
    <View style={styles.row} testID={testID}>
      {steps.map((step) => {
        const on = value === step;
        return (
          <Pressable
            key={step}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            disabled={disabled}
            onPress={() => onChange(step)}
            testID={testID ? `${testID}-${step}` : undefined}
            style={[
              styles.chip,
              {
                backgroundColor: on ? colors.priSurface : isNight ? night.glassBg : 'rgba(255,255,255,0.62)',
                borderColor: isNight ? night.glassBorder : colors.glassLine,
              },
              disabled && styles.disabled,
            ]}
          >
            <Text style={[typeScale.sub, { color: on ? colors.white : isNight ? night.sub : colors.ink2, fontWeight: on ? '600' : '400' }]}>
              {step}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  chip: {
    flex: 1,
    height: 34,
    borderRadius: radius.scaleChip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
});

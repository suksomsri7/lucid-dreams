/** `.hyp` — the 30-night bar chart on the journal tab (mockup 08). */

import { StyleSheet, View } from 'react-native';

import { colors } from './tokens';

export type HypBarTone = 'default' | 'on' | 'ctl';

export interface HypBar {
  /** 0–1, share of the chart's max height. */
  value: number;
  tone?: HypBarTone;
}

export interface HypProps {
  bars: HypBar[];
  night?: boolean;
  testID?: string;
}

const TONE_COLOR: Record<HypBarTone, string> = {
  default: 'rgba(107,92,255,0.28)',
  on: colors.acc,
  ctl: 'rgba(17,19,24,0.10)',
};

const TONE_COLOR_NIGHT: Record<HypBarTone, string> = {
  default: 'rgba(107,92,255,0.35)',
  on: colors.acc,
  ctl: 'rgba(255,255,255,0.14)',
};

export function Hyp({ bars, night: isNight = false, testID }: HypProps) {
  return (
    <View style={styles.row} testID={testID}>
      {bars.map((bar, index) => (
        <View
          // eslint-disable-next-line react/no-array-index-key -- bars are a fixed-length series, never reordered
          key={index}
          style={[
            styles.bar,
            {
              height: `${Math.round(Math.min(1, Math.max(0, bar.value)) * 100)}%`,
              backgroundColor: (isNight ? TONE_COLOR_NIGHT : TONE_COLOR)[bar.tone ?? 'default'],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 56 },
  bar: { flex: 1, borderRadius: 3, minHeight: 3 },
});

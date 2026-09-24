/**
 * `.band2` — the thin mint line under the main `Band`, showing Apple Watch's own REM
 * stretches for comparison (mockup `07-night-report.png`'s own legend: "เอาไว้เทียบว่า
 * แอป 'ทายตรง' แค่ไหน (ไม่ใช่คำตัดสิน)" — not part of `src/ui/Band.tsx` itself: that
 * component's contract is guard/watch/rem + cue/wake ticks, one lane; this is a second,
 * independent lane that only the report screen (L2.10) needs.
 */

import { StyleSheet, View } from 'react-native';

import { colors } from '../ui/tokens';

export interface AppleRemLineProps {
  segments: { startFraction: number; endFraction: number }[];
  testID?: string;
}

const clampFraction = (value: number): number => Math.min(1, Math.max(0, value));

export function AppleRemLine({ segments, testID }: AppleRemLineProps) {
  return (
    <View style={styles.track} testID={testID}>
      {segments.map((segment, index) => {
        const start = clampFraction(segment.startFraction);
        const end = clampFraction(segment.endFraction);
        return (
          // eslint-disable-next-line react/no-array-index-key -- segments never reorder within one render
          <View key={index} style={[styles.segment, { left: `${start * 100}%`, width: `${Math.max(0, end - start) * 100}%` }]} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, marginTop: 4, borderRadius: 3, position: 'relative' },
  segment: { position: 'absolute', top: 0, height: 6, borderRadius: 3, backgroundColor: colors.rem },
});

/**
 * `.band` — the whole-night timeline strip (mockup 07): a base track split into
 * guard/watch/REM segments, plus thin cue/wake ticks on top. Every position is a
 * **fraction of the night** (0 = lights-out, 1 = wake), not a clock time — the
 * screen that renders this (L2.10/L3.5) is responsible for turning real timestamps
 * into fractions so this component stays free of any date/timezone logic.
 */

import { StyleSheet, View } from 'react-native';

import { colors, night } from './tokens';

export type BandSegmentKind = 'guard' | 'watch' | 'rem';
export type BandTickKind = 'cue' | 'wake';

export interface BandSegment {
  kind: BandSegmentKind;
  /** 0–1, fraction of the total band width. */
  startFraction: number;
  endFraction: number;
}

export interface BandTick {
  kind: BandTickKind;
  /** 0–1, fraction of the total band width. */
  fraction: number;
}

export interface BandProps {
  segments: BandSegment[];
  ticks?: BandTick[];
  night?: boolean;
  testID?: string;
}

const SEGMENT_COLOR: Record<BandSegmentKind, string> = {
  guard: 'rgba(17,19,24,0.10)',
  watch: colors.accBg,
  rem: 'rgba(14,159,122,0.22)',
};

const TICK_COLOR: Record<BandTickKind, string> = {
  cue: colors.acc,
  wake: colors.dg,
};

const clampFraction = (value: number): number => Math.min(1, Math.max(0, value));

export function Band({ segments, ticks = [], night: isNight = false, testID }: BandProps) {
  return (
    <View
      style={[styles.track, { backgroundColor: isNight ? night.glassBg : 'rgba(17,19,24,0.05)' }]}
      testID={testID}
    >
      {segments.map((segment, index) => {
        const start = clampFraction(segment.startFraction);
        const end = clampFraction(segment.endFraction);
        return (
          <View
            // eslint-disable-next-line react/no-array-index-key -- segments never reorder within one render
            key={`${segment.kind}-${index}`}
            style={[
              styles.segment,
              {
                left: `${start * 100}%`,
                width: `${Math.max(0, end - start) * 100}%`,
                backgroundColor: SEGMENT_COLOR[segment.kind],
              },
            ]}
          />
        );
      })}
      {ticks.map((tick, index) => (
        <View
          // eslint-disable-next-line react/no-array-index-key -- ticks never reorder within one render
          key={`${tick.kind}-${index}`}
          style={[styles.tick, { left: `${clampFraction(tick.fraction) * 100}%`, backgroundColor: TICK_COLOR[tick.kind] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 28, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  segment: { position: 'absolute', top: 0, bottom: 0 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 3 },
});

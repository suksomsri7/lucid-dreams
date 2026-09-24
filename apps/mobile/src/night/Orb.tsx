/**
 * `.orb.big` — the mint glow with the `p_REM` percentage inside it (mockup
 * `05-night.png` frame a). Not one of the shared `src/ui` components: it is a single,
 * night-screen-only shape (a radial glow + two lines of text), the same "small enough
 * to stay local" call `src/night/EarTestScreen.tsx`'s `Waveform` already made.
 */

import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { night, typeScale } from '../ui/tokens';

export interface OrbProps {
  /** 0–100, already rounded — the screen decides how to spell "no reading yet". */
  percent: number | null;
  label: string;
  testID?: string;
}

const SIZE = 216;

export function Orb({ percent, label, testID }: OrbProps) {
  return (
    <View style={styles.wrap} testID={testID}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="orbCore" cx="50%" cy="46%" r="55%">
            <Stop offset="0" stopColor={night.orbCore} stopOpacity={1} />
            <Stop offset="1" stopColor={night.orbCore} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="orbMid" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={night.orbMid} stopOpacity={1} />
            <Stop offset="1" stopColor={night.orbMid} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#orbMid)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#orbCore)" />
      </Svg>
      <Text style={[typeScale.num, styles.percent]}>{percent === null ? '—' : `${percent}%`}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  percent: { color: night.text },
  label: { marginTop: 4, fontSize: 13, color: night.sub },
});

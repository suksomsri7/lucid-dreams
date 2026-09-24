/** `.ev` — one line of the night's event list (mockup 07: "23:10 · เริ่มคืนนี้ · เสียงพื้น…"). */

import { StyleSheet, Text, View } from 'react-native';

import { colors, night, spacing, typeScale } from './tokens';

export interface EventRowProps {
  time: string;
  title: string;
  sub?: string;
  last?: boolean;
  night?: boolean;
  testID?: string;
}

export function EventRow({ time, title, sub, last = false, night: isNight = false, testID }: EventRowProps) {
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isNight ? night.glassBorder : colors.hairline },
      ]}
      testID={testID}
    >
      <Text style={[typeScale.eventTime, styles.time, { color: isNight ? night.mut : colors.mut }]}>{time}</Text>
      <View style={styles.body}>
        <Text style={[typeScale.body, { color: isNight ? night.text : colors.ink, fontWeight: '600' }]}>{title}</Text>
        {sub ? <Text style={[typeScale.sub, styles.sub, { color: isNight ? night.sub : colors.ink2 }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: 9 },
  time: { width: 44, paddingTop: 1 },
  body: { flex: 1 },
  sub: { marginTop: 1 },
});

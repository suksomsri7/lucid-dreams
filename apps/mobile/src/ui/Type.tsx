/**
 * Small text helpers built on the type scale — not one of the 14 named components the
 * WO contract requires, but every screen needs *something* to replace `kit.tsx`'s
 * `Title`/`Subtitle`/`Note`, and hand-rolling `<Text style={{ fontSize: 28, … }}>` in
 * every screen would be exactly the kind of hex/number drift `tokens.ts` exists to stop.
 */

import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { colors, night, typeScale } from './tokens';

interface TextProps {
  children?: ReactNode;
  night?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function Title({ children, night: isNight = false, style, testID }: TextProps) {
  return (
    <Text style={[typeScale.h1, { color: isNight ? night.text : colors.ink }, style]} testID={testID}>
      {children}
    </Text>
  );
}

export function Subtitle({ children, night: isNight = false, style, testID }: TextProps) {
  return (
    <Text style={[typeScale.body, { color: isNight ? night.sub : colors.ink2, marginTop: -6 }, style]} testID={testID}>
      {children}
    </Text>
  );
}

export function SectionLabel({ children, night: isNight = false, style, testID }: TextProps) {
  return (
    <Text
      style={[typeScale.label, { color: isNight ? night.mut : colors.mut, textTransform: 'uppercase' }, style]}
      testID={testID}
    >
      {children}
    </Text>
  );
}

export function Sub({ children, night: isNight = false, style, testID }: TextProps) {
  return (
    <Text style={[typeScale.sub, { color: isNight ? night.sub : colors.ink2 }, style]} testID={testID}>
      {children}
    </Text>
  );
}

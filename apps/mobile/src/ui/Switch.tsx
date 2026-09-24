/** `.sw` / `.sw.on` — mint when on (DESIGN §2.8 · `--rem`). */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

import { colors, radius } from './tokens';

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const THUMB_SIZE = 24;
const THUMB_MARGIN = 3;

export function Switch({ value, onValueChange, disabled = false, testID }: SwitchProps) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: value ? 1 : 0, duration: 150, useNativeDriver: false }).start();
  }, [value, progress]);

  const translateX = progress.interpolate({
    outputRange: [0, TRACK_WIDTH - THUMB_SIZE - THUMB_MARGIN * 2],
    inputRange: [0, 1],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      testID={testID}
      style={disabled ? styles.disabled : undefined}
    >
      <Animated.View
        style={[
          styles.track,
          { backgroundColor: value ? colors.rem : 'rgba(17,19,24,0.10)' },
        ]}
      >
        <Animated.View style={[styles.thumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.switchPill,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    marginHorizontal: THUMB_MARGIN,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  disabled: { opacity: 0.4 },
});

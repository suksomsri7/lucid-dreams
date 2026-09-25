/** `.composer` — the text input capsule shared by the advisor room and the morning room. */

import { useEffect, useRef, type RefObject } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { Icon } from './icons';
import { colors, night, radius, typeScale } from './tokens';

export interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  onMicPress?: () => void;
  onSend?: () => void;
  /**
   * The mic button turns accent-filled **and pulses** while recording (DESIGN §3.3 · WO L3.13):
   * the fill alone was not enough of a signal that the phone is listening right now, and the
   * heartbeat is what tells the user the session is alive and that a second tap ends it.
   */
  micActive?: boolean;
  disabled?: boolean;
  night?: boolean;
  /** WO L1.4: lets a screen `.focus()` the field itself (the "other" theme chip opens the keyboard). */
  inputRef?: RefObject<TextInput | null>;
  testID?: string;
}

export function Composer({
  value,
  onChangeText,
  placeholder,
  onMicPress,
  onSend,
  micActive = false,
  disabled = false,
  night: isNight = false,
  inputRef,
  testID,
}: ComposerProps) {
  const canSend = value.trim().length > 0;
  const micPulse = useMicPulse(micActive);

  return (
    <GlassSurface tint="regular" night={isNight} radius={radius.composer} testID={testID}>
      {/*
       * The platform glass/blur wrapper always interposes one more `View` between this
       * `style` and these children (so `BlurView`/`GlassView` sizes correctly around
       * flexible content) — a `flexDirection: 'row'` set on `GlassSurface`'s own `style`
       * would land on that wrapper's *parent*, not on a container these children are
       * direct children of, so it would never actually arrange them. The fix is the same
       * one `GlassCard` uses: an inner `View` this component owns carries the row layout.
       */}
      <View style={styles.row}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={isNight ? night.mut : colors.mut}
          editable={!disabled}
          style={[typeScale.body, styles.input, { color: isNight ? night.text : colors.ink }]}
          testID={testID ? `${testID}-input` : undefined}
        />
        {onMicPress ? (
          <Animated.View style={{ transform: [{ scale: micPulse }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: micActive }}
              onPress={onMicPress}
              disabled={disabled}
              testID={testID ? `${testID}-mic` : undefined}
              style={[styles.iconButton, micActive ? styles.iconButtonAcc : styles.iconButtonNeutral]}
            >
              <Icon name="mic" size={18} color={micActive ? colors.white : isNight ? night.text : colors.ink} />
            </Pressable>
          </Animated.View>
        ) : null}
        {onSend ? (
          <Pressable
            accessibilityRole="button"
            onPress={onSend}
            disabled={disabled || !canSend}
            testID={testID ? `${testID}-send` : undefined}
            style={[styles.iconButton, canSend ? styles.iconButtonAcc : styles.iconButtonNeutral, !canSend && styles.iconButtonDisabled]}
          >
            <Icon name="send" size={18} color={canSend ? colors.white : isNight ? night.text : colors.ink} />
          </Pressable>
        ) : null}
      </View>
    </GlassSurface>
  );
}

/**
 * The listening heartbeat (WO L3.13): 1 → 1.12 → 1 while `micActive`, and exactly `1` — the
 * unanimated resting value — at every other moment, so a screenshot of an idle composer is
 * pixel-identical to the mockup and the visual QC run is unaffected.
 */
function useMicPulse(micActive: boolean): Animated.AnimatedInterpolation<number> {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!micActive) {
      progress.setValue(0);
      return;
    }
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          // react-native-web has no native driver; asking for one only prints a warning into the QC console.
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    breathe.start();
    return () => {
      breathe.stop();
      progress.setValue(0);
    };
  }, [micActive, progress]);

  return progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
}

const styles = StyleSheet.create({
  row: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 18,
    paddingRight: 8,
  },
  input: { flex: 1, paddingVertical: 0 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconButtonNeutral: { backgroundColor: 'rgba(17,19,24,0.06)' },
  iconButtonAcc: { backgroundColor: colors.acc },
  iconButtonDisabled: { opacity: 0.5 },
});

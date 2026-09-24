/** `.composer` — the text input capsule shared by the advisor room and the morning room. */

import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { Icon } from './icons';
import { colors, night, radius, typeScale } from './tokens';

export interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  onMicPress?: () => void;
  onSend?: () => void;
  /** The mic button turns accent-filled while recording (DESIGN §3.3). */
  micActive?: boolean;
  disabled?: boolean;
  night?: boolean;
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
  testID,
}: ComposerProps) {
  const canSend = value.trim().length > 0;

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
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={isNight ? night.mut : colors.mut}
          editable={!disabled}
          style={[typeScale.body, styles.input, { color: isNight ? night.text : colors.ink }]}
          testID={testID ? `${testID}-input` : undefined}
        />
        {onMicPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onMicPress}
            disabled={disabled}
            testID={testID ? `${testID}-mic` : undefined}
            style={[styles.iconButton, micActive ? styles.iconButtonAcc : styles.iconButtonNeutral]}
          >
            <Icon name="mic" size={18} color={micActive ? colors.white : isNight ? night.text : colors.ink} />
          </Pressable>
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

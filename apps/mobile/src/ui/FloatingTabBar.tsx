/**
 * `.tabbar` — the floating glass capsule that replaces the native tab bar
 * (DESIGN §2.8 rule 8, §3.1). Deliberately dumb: it takes an already-resolved list of
 * `{ key, label, icon }` items plus the active key and an `onPress`, so it can be
 * rendered both by `app/(tabs)/_layout.tsx` (wired to real navigation state) and by
 * `app/dev/ui.tsx` (wired to a `useState` for the QC screenshot) without either side
 * needing to know about React Navigation's `tabBar` prop shape.
 */

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { Icon, type IconName } from './icons';
import { colors, night, radius, typeScale } from './tokens';

export interface FloatingTabBarItem {
  key: string;
  label: string;
  icon: IconName;
}

export interface FloatingTabBarProps {
  items: FloatingTabBarItem[];
  activeKey: string;
  onPress: (key: string) => void;
  night?: boolean;
  testID?: string;
}

export function FloatingTabBar({ items, activeKey, onPress, night: isNight = false, testID }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 14 }]} pointerEvents="box-none" testID={testID}>
      <GlassSurface tint="regular" night={isNight} radius={radius.tab} style={styles.surface}>
        {items.map((item) => {
          const active = item.key === activeKey;
          const color = active ? colors.acc : isNight ? night.sub : colors.ink2;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onPress(item.key)}
              testID={testID ? `${testID}-${item.key}` : undefined}
              style={styles.tab}
            >
              <Icon name={item.icon} size={23} color={color} strokeWidth={1.7} />
              <Text style={[typeScale.label, styles.label, { color, fontWeight: active ? '600' : '400' }]} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
  surface: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 10,
    width: '100%',
  },
  tab: { alignItems: 'center', gap: 3, flex: 1 },
  label: { fontSize: 10.5 },
});

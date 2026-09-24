import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { useT } from '../../src/i18n';
import { FloatingTabBar, type FloatingTabBarItem } from '../../src/ui';

/**
 * Three tabs (DESIGN §3.1), rendered as the floating glass capsule from `src/ui`
 * instead of a native tab bar (DESIGN §2.8 rule 8 · oracle U4.1/U4.2). `FloatingTabBar`
 * itself knows nothing about React Navigation — this adapter is the only place that
 * reads `state`/`navigation` off the `tabBar` render prop and turns it into the plain
 * `{ items, activeKey, onPress }` shape the component takes (see `FloatingTabBar.tsx`).
 */
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export default function TabsLayout() {
  const { t } = useT();

  const items: FloatingTabBarItem[] = [
    { key: 'index', label: t('tabs.tonight'), icon: 'moon' },
    { key: 'journal', label: t('tabs.journal'), icon: 'book' },
    { key: 'settings', label: t('tabs.settings'), icon: 'gear' },
  ];

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props: TabBarProps) => {
        const activeRoute = props.state.routes[props.state.index];
        return (
          <FloatingTabBar
            items={items}
            activeKey={activeRoute?.name ?? 'index'}
            onPress={(key) => props.navigation.navigate(key)}
            testID="tab-bar"
          />
        );
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.tonight') }} />
      <Tabs.Screen name="journal" options={{ title: t('tabs.journal') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}

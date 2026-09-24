import { Tabs } from 'expo-router';

import { useT } from '../../src/i18n';
import { ACCENT, INK_SOFT } from '../../src/ui/kit';

/**
 * Three tabs (DESIGN §3.1). The floating glass capsule tab bar is L1.2 — this is the
 * plain native bar so navigation exists and the web export can render every route.
 */
export default function TabsLayout() {
  const { t } = useT();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: INK_SOFT,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.tonight') }} />
      <Tabs.Screen name="journal" options={{ title: t('tabs.journal') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}

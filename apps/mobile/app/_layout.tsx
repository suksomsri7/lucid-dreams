import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useT } from '../src/i18n';
import { colors } from '../src/ui';

/**
 * Every screen paints its own background via `Screen`/`AppBackground` (`src/ui`), so the
 * navigator's `contentStyle` only needs to be transparent — otherwise a flat color would
 * flash between the native screen transition and the gradient mounting underneath it.
 */
export default function RootLayout() {
  const { t } = useT();

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="diagnostics"
          options={{
            headerShown: true,
            headerTransparent: true,
            headerTintColor: colors.ink,
            title: t('diagnostics.title'),
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

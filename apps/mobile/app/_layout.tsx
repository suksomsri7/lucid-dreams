import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useT } from '../src/i18n';
import { BACKGROUND, INK } from '../src/ui/kit';

export default function RootLayout() {
  const { t } = useT();

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BACKGROUND },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="diagnostics"
          options={{
            headerShown: true,
            headerTransparent: true,
            headerTintColor: INK,
            title: t('diagnostics.title'),
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

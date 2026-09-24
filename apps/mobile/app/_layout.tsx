import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useT } from '../src/i18n';
import { useOnboardingState } from '../src/store/onboarding';
import { AppBackground, colors } from '../src/ui';

/**
 * Every screen paints its own background via `Screen`/`AppBackground` (`src/ui`), so the
 * navigator's `contentStyle` only needs to be transparent — otherwise a flat color would
 * flash between the native screen transition and the gradient mounting underneath it.
 *
 * WO L1.3: gates everything behind onboarding (`hasOnboarded`, persisted in
 * `src/store/onboarding.ts`) until it has been completed once. `useSegments()` is
 * checked so the redirect never fires *while already inside* `/onboarding` — without
 * that guard, landing on `/onboarding` itself would immediately redirect to
 * `/onboarding` again on every render (harmless in practice, since expo-router treats a
 * redirect-to-the-current-route as a no-op, but this is the standard, explicit way to
 * write an auth/onboarding gate with expo-router and avoids relying on that).
 */
export default function RootLayout() {
  const { t } = useT();
  const { hasOnboarded, hydrated } = useOnboardingState();
  const segments = useSegments();
  const inOnboarding = segments[0] === 'onboarding';

  if (!hydrated) {
    // AsyncStorage hydration is a handful of milliseconds, but rendering *something* of
    // the right background avoids a flash of white/black before we know which screen to show.
    return <AppBackground style={{ flex: 1 }} />;
  }

  if (!hasOnboarded && !inOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      >
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="history"
          options={{
            headerShown: true,
            headerTransparent: true,
            headerTintColor: colors.ink,
            title: t('history.title'),
          }}
        />
        <Stack.Screen
          name="plan"
          options={{
            headerShown: true,
            headerTransparent: true,
            headerTintColor: colors.ink,
            title: t('plan.stub.title'),
          }}
        />
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

import { useEffect } from 'react';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { applyOnboardingBypassForAdvisorFixture } from '../src/dev/fixtures';
import { useT } from '../src/i18n';
import { IntroOverlay } from '../src/intro';
import { registerNotificationResponseHandler } from '../src/notifications';
import { useOnboardingState } from '../src/store/onboarding';
import { AppBackground, colors } from '../src/ui';

// Module scope, not inside the component: must win the race against `src/store/onboarding.ts`'s
// own async AsyncStorage read (harmless either way on a fresh QC session — see the fixture's
// own doc comment) and must have run before the first render decides whether to redirect.
applyOnboardingBypassForAdvisorFixture();

/**
 * WO L3.7: keep the native splash (`expo-splash-screen`, configured in `app.config.ts`) on
 * screen until `src/intro/IntroOverlay.tsx` has laid out and is about to paint the same mark
 * at the same size — `IntroOverlay` calls `hideAsync()` from its own `onLayout`, and also when
 * it decides not to render at all, so there is no path that leaves the splash stuck.
 *
 * Module scope, like the fixture call above: `preventAutoHideAsync` has to have run before the
 * first frame is ready, which an effect is by definition too late for. It rejects if the splash
 * is already gone (a fast refresh, a warm remount), which is nothing to report.
 */
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** The app's root: the navigator, with the launch screen (WO L3.7) floating above it. */
export default function RootLayout() {
  return (
    <>
      <RootNavigator />
      {/*
        Last child, so it is above everything the navigator draws — the launch screen has to
        cover onboarding *and* the tabs (WO L3.7 §B3). It is `position: absolute` + `pointerEvents:
        'none'` and unmounts itself after one run, so from the second frame on it costs nothing.
        Deliberately a sibling of `RootNavigator` rather than something inside it: the navigator
        returns early while the onboarding store hydrates and again to redirect, and an overlay
        living inside those branches would unmount and restart on every one of them.
      */}
      <IntroOverlay />
    </>
  );
}

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
 *
 * Split out of `RootLayout` in WO L3.7 only so the intro overlay can be a sibling of the
 * whole thing, early returns included — the body below is unchanged.
 */
function RootNavigator() {
  const { t } = useT();
  const { hasOnboarded, hydrated } = useOnboardingState();
  const segments = useSegments();
  const inOnboarding = segments[0] === 'onboarding';

  // One listener for the app's whole lifetime (WO L3.3) — records Done/Later against
  // `RealityCheck` no matter which screen is on top when the notification is tapped.
  useEffect(() => registerNotificationResponseHandler(), []);

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
        {/*
          `plan` (WO L1.7ui) is a directory with no own `_layout.tsx` — same shape as
          `onboarding` above, whose own multi-file screens (`index.tsx`, `devices.tsx`)
          already rely on the Stack's own default `screenOptions` (headerShown: false)
          with no per-route entry needed. Every `app/plan/*` screen paints its own
          `StepNav` header (`src/ui/StepNav.tsx`) to match the mockup's custom nav row,
          not a native stack header, so this route needs no explicit `<Stack.Screen>` —
          declaring one with `headerShown: true` here would draw a second, native header
          bar above that custom one on every screen under `plan/`.
        */}
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

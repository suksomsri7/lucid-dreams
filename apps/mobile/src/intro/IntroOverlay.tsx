/**
 * The launch screen (WO L3.7 §B3 · mockup `ledger/design-app/11-splash.png`).
 *
 * It is an **overlay**, not a route: `app/_layout.tsx` renders it above the whole `Stack`,
 * so the screen underneath — onboarding on a first run, the tabs on every run after — is
 * already mounted and settled by the time it fades away. A route would have had to navigate,
 * which is the one thing that would show the user a transition on top of a transition.
 *
 * ## The handoff from the native splash
 * `expo-splash-screen` shows `assets/splash-icon.png` at `imageWidth: 200` on `#f6f5fb`
 * while the JS bundle loads; this overlay draws the same mark at the same {@link LOGO_SIZE}
 * over the same background gradient (whose top stop *is* `#f6f5fb` — `app.config.ts`'s
 * `backgroundColor` and `src/ui/tokens.ts`' `appBackground.linearFrom` are the same value).
 * `hideAsync()` is called from `onLayout`, i.e. after this overlay has been measured and is
 * about to paint — hiding it any earlier is what produces the white flash between the two.
 *
 * ## The order of events on a cold launch
 *  1. mark fades in (0 → 1) and scales .92 → 1 over {@link FADE_IN_MS};
 *  2. the halo breathes on a {@link HALO_BREATH_MS} loop for as long as we wait;
 *  3. once the onboarding store has hydrated **and** {@link INTRO_MIN_MS} has passed (or
 *     {@link INTRO_MAX_MS} has, if hydration is somehow still not done — the app is never
 *     held hostage by storage), the halo jumps to its peak and `playBrandAnchor()` is
 *     *started*, not awaited;
 *  4. {@link TONE_TO_FADE_MS} later the overlay fades out over {@link FADE_OUT_MS} and
 *     unmounts. The tone keeps playing underneath — "before the home screen" in the owner's
 *     instruction means the tone *starts* first, not that the user stares at a logo until it
 *     finishes.
 *
 * ## Once per launch
 * `playedThisLaunch` is module state on purpose: a component-level flag would reset with the
 * component, and the root layout re-renders (and, on a redirect, re-mounts) freely. Module
 * state dies with the JS context, which is exactly "one cold launch".
 *
 * ## Web
 * The QC export is screenshotted route by route (`scripts/visual-all.js`); an overlay that
 * appeared on every route would cover all of them. So on web it renders **only** for
 * `?fixture=intro`, and then freezes at the peak frame (mark fully in, halo at its widest)
 * so the screenshot is deterministic — no animation, no fade-out, no timers.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { playBrandAnchor } from '../audio/brand';
import { introFixtureRequested } from '../dev/fixtures';
import { useT } from '../i18n';
import { useOnboardingState } from '../store/onboarding';
import { AppBackground, colors } from '../ui';
import { BrandMark, LOGO_SIZE } from './BrandMark';

/** Shortest time the intro is on screen — long enough for the fade-in to be seen, not felt as a wait. */
export const INTRO_MIN_MS = 900;

/** Hard ceiling on waiting for `AsyncStorage`: after this the intro finishes regardless. */
export const INTRO_MAX_MS = 6000;

const FADE_IN_MS = 600;
const HALO_BREATH_MS = 2400;
const HALO_PEAK_MS = 320;
const TONE_TO_FADE_MS = 1400;
const FADE_OUT_MS = 400;

/** Brightest point of the breathing loop: opacity .35 + .72 × .35 ≈ .60, per the WO. */
const BREATH_HIGH = 0.72;

const SCALE_FROM = 0.92;

/** See `styles.stack` — how far below the frame's centre the composition sits, in points. */
const STACK_NUDGE_Y = 26;

/** Set the moment the intro starts; survives re-renders and re-mounts, dies with the JS context. */
let playedThisLaunch = false;

/** Never let a splash-screen call reject into a render effect (it throws if already hidden). */
function hideNativeSplash(): void {
  SplashScreen.hideAsync().catch(() => undefined);
}

export function IntroOverlay() {
  const { t } = useT();
  const { hydrated } = useOnboardingState();

  /** On web the intro is a still life for the screenshot: no timers, no tone, no fade-out. */
  const frozen = Platform.OS === 'web';
  const [visible, setVisible] = useState(() =>
    frozen ? introFixtureRequested() : !playedThisLaunch,
  );

  const fade = useRef(new Animated.Value(frozen ? 1 : 0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(frozen ? 1 : 0)).current;

  const startedAt = useRef(Date.now()).current;
  const sequenceStarted = useRef(false);
  const fadeOutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breathingRef = useRef<Animated.CompositeAnimation | null>(null);

  // The splash has to go even when there is no intro to hand over to — a warm re-mount, or
  // any web route that is not the fixture. Without this the native splash would sit there.
  useEffect(() => {
    if (!visible) hideNativeSplash();
  }, [visible]);

  // Entrance + the breathing halo. Skipped whole on web: `frozen` starts both values at their
  // end state, which is the frame mockup 11(b) shows.
  useEffect(() => {
    if (!visible || frozen) return undefined;
    playedThisLaunch = true;

    Animated.timing(fade, {
      toValue: 1,
      duration: FADE_IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: BREATH_HIGH,
          duration: HALO_BREATH_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: HALO_BREATH_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    breathingRef.current = breathing;
    breathing.start();
    return () => breathing.stop();
  }, [visible, frozen, fade, glow]);

  // Hydration → tone → fade out. Re-runs when `hydrated` flips (that is the point: it
  // replaces the MAX-ceiling timer with the MIN one), but `sequenceStarted` makes it a no-op
  // once the tone has been fired, so a late flip can never cancel a fade-out in flight.
  useEffect(() => {
    if (!visible || frozen || sequenceStarted.current) return undefined;

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, (hydrated ? INTRO_MIN_MS : INTRO_MAX_MS) - elapsed);

    const startTimer = setTimeout(() => {
      if (sequenceStarted.current) return;
      sequenceStarted.current = true;

      // Explicit, rather than relying on the new `timing` below implicitly taking the value
      // over: a loop that is still alive would keep the halo breathing under the peak.
      breathingRef.current?.stop();
      Animated.timing(glow, {
        toValue: 1,
        duration: HALO_PEAK_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();

      // Not awaited on purpose (WO §B4): the tone outlives the overlay.
      void playBrandAnchor();

      fadeOutTimer.current = setTimeout(() => {
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: FADE_OUT_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start(() => setVisible(false));
      }, TONE_TO_FADE_MS);
    }, waitMs);

    return () => clearTimeout(startTimer);
  }, [visible, frozen, hydrated, startedAt, glow, overlayOpacity]);

  // Unmount only — the fade-out timer must survive every re-run of the effect above.
  useEffect(
    () => () => {
      if (fadeOutTimer.current !== null) clearTimeout(fadeOutTimer.current);
    },
    [],
  );

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, { opacity: overlayOpacity }]}
      onLayout={hideNativeSplash}
      pointerEvents="none"
      testID="intro-overlay"
    >
      <AppBackground style={StyleSheet.absoluteFill} />
      <Animated.View
        style={[
          styles.stack,
          {
            opacity: fade,
            // One array: a `transform` in the StyleSheet entry would be replaced wholesale by
            // this one, so the 18 pt nudge (see `styles.stack`'s note) has to live here too.
            transform: [
              { translateY: STACK_NUDGE_Y },
              { scale: fade.interpolate({ inputRange: [0, 1], outputRange: [SCALE_FROM, 1] }) },
            ],
          },
        ]}
      >
        <BrandMark glow={glow} />
        {/* Nothing else on this screen — no button, no status line (mockup 11). */}
        <Text style={styles.wordmark}>{t('intro.wordmark')}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', justifyContent: 'center' },
  /**
   * Centred, then nudged down by {@link STACK_NUDGE_Y}: the mark's optical centre then lands
   * at y ≈ 420 of an 844 pt frame, which is where mockup 11 puts it (measured 428 in frame a,
   * 411 in frame b). The nudge itself is applied inline, with the entrance scale.
   */
  stack: { alignItems: 'center', width: LOGO_SIZE },
  wordmark: {
    // 18, not a round 24: measured against mockup 11 the baseline gap from the mark's ink to
    // the wordmark's cap line is 57 pt, and this is what produces it at this font size.
    marginTop: 18,
    fontSize: 15,
    lineHeight: 18,
    // 0.8, not the WO's 2: at 2 the word measures 91 pt wide against mockup 11's 82 — the
    // mockup's browser font is simply wider per glyph than the one react-native renders, so
    // matching its *tracking number* would not have matched its look (`ledger/wo-notes/L3.7.md`).
    letterSpacing: 0.8,
    fontWeight: '500',
    color: colors.ink2,
  },
});

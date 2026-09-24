/**
 * Shared body of the two ear-test screens (WO L1.7ui, mockup `04-dream-plan.png` c/d ·
 * DESIGN §3.2 step 3, decision round 13 (24 Sep): one screen per ear). `app/plan/ear-left.tsx`
 * and `ear-right.tsx` are thin wrappers around this with `side` fixed — everything about
 * the round-trip (play → ask → answer → replay-on-wrong → passed) is identical between
 * the two sides; only the copy, the volume control and the footer differ, and those are
 * all keyed off `side` below rather than duplicated.
 *
 * Talks to `packages/engine`'s `createMemorizationTest` for the actual state machine
 * (rounds, gaps, pan, redraw-on-wrong) and `src/audio/player.ts` for playback — this
 * file only owns the screen's own UI state (which round is playing, what the user has
 * tapped) and translates engine events into it.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import {
  ANCHOR_VOLUME_MAX,
  ANCHOR_VOLUME_MIN,
  clampAnchorVolume,
  createMemorizationTest,
  mulberry32,
  type AnchorSignature,
  type EarSide,
  type MemorizationTest,
} from '@lucid/engine';

import { buildAnchorSignature, getAnchorSeed, playMemorizationPlan } from '../audio/player';
import { applyPlanFixture, earPassedFixtureRequested } from '../dev/fixtures';
import { useT } from '../i18n';
import { recordEarTest, useNightState } from '../store/night';
import { Button, Chip, GlassSurface, Icon, Screen, Scale, StepNav, Sub, colors, radius, spacing, typeScale } from '../ui';

/** Mockup 04(c)/(d)'s starting level — the ear test's own `volume` clamp rails apply on top. */
const DEFAULT_START_VOLUME = 0.15;

const FIXTURE_RESULT: Record<EarSide, { rounds: number; answer: number }> = {
  L: { rounds: 3, answer: 3 },
  R: { rounds: 4, answer: 4 },
};

function seedRng(): () => number {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const rng = mulberry32(seed);
  return () => rng.next();
}

export interface EarTestScreenProps {
  side: EarSide;
}

export function EarTestScreen({ side }: EarTestScreenProps) {
  const { t, locale } = useT();
  const router = useRouter();
  const { plan, lang, earTests, hydrated } = useNightState();
  const effectiveLang = lang ?? locale;

  const [signature, setSignature] = useState<AnchorSignature | null>(null);
  const [volume, setVolume] = useState(earTests.L?.volume ?? DEFAULT_START_VOLUME);
  const [status, setStatus] = useState<'idle' | 'playing' | 'asking' | 'correct'>('idle');
  const [selected, setSelected] = useState<number | null>(null);
  const [wrongOnce, setWrongOnce] = useState(false);

  // `?fixture=ear-passed` (WO L1.7ui QC parity) — lets this screen be screenshotted
  // directly by URL without visiting `/plan` first. No-op once a real plan exists.
  useEffect(() => {
    applyPlanFixture(locale);
  }, [locale]);

  // A `MemorizationTest`'s `volume` is fixed at creation (`memorization.ts`: `const
  // volume = clampAnchorVolume(options.volume)`, never updated by `start()`/`answer()`)
  // — so dragging the left-ear slider has to build a *new* test object, not mutate the
  // existing one. Only while nothing has played yet (`status === 'idle'`): once a round
  // has actually gone out, changing the object under the user's feet would let a wrong
  // answer's redraw disappear along with it.
  const [test, setTest] = useState<MemorizationTest>(() => createMemorizationTest({ side, rng: seedRng(), volume }));
  useEffect(() => {
    if (side === 'L' && status === 'idle') {
      setTest(createMemorizationTest({ side, rng: seedRng(), volume }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only volume should retrigger this
  }, [volume]);

  const fixture = earPassedFixtureRequested();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seed = await getAnchorSeed();
      if (!cancelled) setSignature(buildAnchorSignature(seed, effectiveLang));
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveLang]);

  // Redirect guards: no plan yet → back to the plan screen · reached the right-ear
  // screen without a passed left ear (real flow only — the fixture represents "both
  // sides already passed" regardless of visit order, see the effect below).
  useEffect(() => {
    if (hydrated && !plan) router.replace('/plan');
    else if (hydrated && plan && side === 'R' && !earTests.L && !fixture) router.replace('/plan/ear-left');
  }, [hydrated, plan, side, earTests.L, fixture, router]);

  // `?fixture=ear-passed` (WO L1.7ui QC parity): seed *both* sides as passed, regardless
  // of which of the two screens is open, so either can be screenshotted on its own.
  useEffect(() => {
    if (!fixture) return;
    if (!earTests.L) recordEarTest({ side: 'L', rounds: FIXTURE_RESULT.L.rounds, answer: FIXTURE_RESULT.L.answer, attempts: 1, volume: DEFAULT_START_VOLUME });
    if (!earTests.R) recordEarTest({ side: 'R', rounds: FIXTURE_RESULT.R.rounds, answer: FIXTURE_RESULT.R.answer, attempts: 1, volume: DEFAULT_START_VOLUME });
    setStatus('correct');
    setSelected(FIXTURE_RESULT[side].answer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixture effect runs once
  }, [fixture]);

  async function handlePlay(): Promise<void> {
    if (!signature || status === 'playing') return;

    setStatus('playing');
    const plan0 = test.start();
    await playMemorizationPlan(signature, plan0, volume);
    test.ask();
    setStatus('asking');
    setSelected(null);
  }

  async function handleAnswer(count: number): Promise<void> {
    if (status !== 'asking' || !signature) return;
    setSelected(count);
    const result = test.answer(count);

    if (result.correct) {
      setStatus('correct');
      recordEarTest(test.result());
      return;
    }

    setWrongOnce(true);
    setStatus('playing');
    await playMemorizationPlan(signature, { rounds: result.rounds, gapsMs: result.gapsMs, pan: side === 'R' ? 1 : -1 }, volume);
    test.ask();
    setStatus('asking');
    setSelected(null);
  }

  const nav =
    side === 'L'
      ? { title: t('earTest.nav.left'), step: t('earTest.step.left'), instruction: t('earTest.instruction.left') }
      : { title: t('earTest.nav.right'), step: t('earTest.step.right'), instruction: t('earTest.instruction.right') };

  if (!hydrated || !plan) return <Screen testID={`screen-ear-${side.toLowerCase()}`} withTabBarInset={false} />;

  const langLabel = t(effectiveLang === 'th' ? 'settings.language.th' : 'settings.language.en');
  const passed = status === 'correct';
  const bothReady = passed && (side === 'R' ? Boolean(earTests.L) || fixture : false);

  return (
    <Screen
      testID={`screen-ear-${side.toLowerCase()}`}
      withTabBarInset={false}
      footer={
        side === 'L' ? (
          <Button
            label={passed ? t('earTest.footer.next') : t('earTest.footer.blocked')}
            tone={passed ? 'pri' : 'dg'}
            size="big"
            block
            disabled={!passed}
            onPress={() => router.push('/plan/ear-right')}
            testID="ear-left-next"
          />
        ) : (
          <View style={styles.footerWrap}>
            <Button
              label={t('earTest.footer.start')}
              tone={passed ? 'pri' : 'dg'}
              size="big"
              block
              disabled={!passed}
              onPress={() => router.replace('/night')}
              testID="ear-right-start"
            />
            <Sub style={styles.footerHint}>{t('earTest.footer.startHint')}</Sub>
          </View>
        )
      }
    >
      <StepNav title={nav.title} step={nav.step} onBack={() => router.back()} testID={`ear-${side.toLowerCase()}-nav`} />

      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{side}</Text>
        </View>
        <Sub style={styles.instruction}>{nav.instruction}</Sub>
      </View>

      {signature ? (
        <GlassSurface tint="regular" radius={radius.card} contentStyle={styles.anchorCard} testID="ear-anchor-card">
          <Text style={[typeScale.sub, { color: colors.ink }]} numberOfLines={1}>
            “{plan.anchorPhrase}”
          </Text>
          <Text style={[typeScale.sub, { color: colors.mut, marginTop: 2 }]}>{t('earTest.card.watermark', { langLabel })}</Text>
        </GlassSurface>
      ) : null}

      {side === 'L' ? (
        <VolumeSlider value={volume} onChange={setVolume} label={t('earTest.volume.hint', { percent: Math.round(volume * 100) })} />
      ) : (
        <Sub testID="ear-right-volume">{t('earTest.volume.fromLeft', { percent: Math.round(volume * 100) })}</Sub>
      )}

      <View style={styles.playWrap}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void handlePlay()}
          disabled={status === 'playing'}
          style={[styles.playButton, status === 'playing' && styles.playButtonActive]}
          testID="ear-play-button"
        >
          <Icon name="play" size={26} color={colors.white} />
        </Pressable>
        <Text style={[typeScale.sub, styles.playLabel]}>{status === 'playing' ? t('earTest.playing') : t('earTest.play')}</Text>
        <Waveform active={status === 'playing'} />
      </View>

      <View style={styles.questionBlock}>
        <Text style={[typeScale.body, styles.questionLabel]}>{t('earTest.question')}</Text>
        <Scale min={1} max={5} value={selected} onChange={(n) => void handleAnswer(n)} disabled={status !== 'asking'} testID="ear-scale" />
        {passed ? <Chip label={t('earTest.correct')} tone="rem" testID="ear-correct-chip" /> : null}
        {wrongOnce && !passed && status === 'asking' ? <Sub>{t('earTest.wrong')}</Sub> : null}
      </View>

      {bothReady ? <Chip label={t('earTest.summary.bothReady')} tone="rem" testID="ear-both-ready" /> : null}
    </Screen>
  );
}

interface VolumeSliderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
}

/**
 * The "too quiet / too loud" slider (mockup 04(c)). No `@react-native-community/slider` dependency
 * added for one tap-to-set control (APP-RUN §0.5 S9: every new dependency justified) —
 * a `Pressable` that reads `locationX` against the track's measured width covers "tap
 * anywhere on the track to set the level", which is the only interaction the mockup
 * shows (there is no drag-thumb close-up in the source image to match pixel-for-pixel).
 */
function VolumeSlider({ value, onChange, label }: VolumeSliderProps) {
  const { t } = useT();
  const [trackWidth, setTrackWidth] = useState(0);
  const fraction = (clampAnchorVolume(value) - ANCHOR_VOLUME_MIN) / (ANCHOR_VOLUME_MAX - ANCHOR_VOLUME_MIN);

  function onLayout(event: LayoutChangeEvent): void {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  function onTrackPress(x: number): void {
    if (trackWidth <= 0) return;
    const pct = Math.max(0, Math.min(1, x / trackWidth));
    onChange(clampAnchorVolume(ANCHOR_VOLUME_MIN + pct * (ANCHOR_VOLUME_MAX - ANCHOR_VOLUME_MIN)));
  }

  return (
    <GlassSurface tint="soft" radius={radius.card} contentStyle={styles.volumeCard} testID="ear-volume-slider">
      <View style={styles.volumeLabels}>
        <Text style={[typeScale.sub, { color: colors.mut }]}>{t('earTest.volume.label')}</Text>
        <Text style={[typeScale.sub, { color: colors.mut }]}>{t('earTest.volume.labelLoud')}</Text>
      </View>
      <Pressable
        onLayout={onLayout}
        onPress={(event) => onTrackPress(event.nativeEvent.locationX)}
        style={styles.track}
        testID="ear-volume-track"
      >
        <View style={[styles.trackFill, { width: `${Math.round(fraction * 100)}%` }]} />
        <View style={[styles.thumb, { left: `${Math.round(fraction * 100)}%` }]} />
      </Pressable>
      <Sub style={styles.volumeHint}>{label}</Sub>
    </GlassSurface>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = [6, 14, 9, 18, 11, 16, 8, 13, 7];
  return (
    <View style={styles.wave} testID="ear-waveform">
      {bars.map((height, index) => (
        <View
          key={index}
          style={[styles.waveBar, { height, backgroundColor: active ? colors.acc : colors.glassLine }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accSurfaceSoft,
  },
  badgeText: { fontSize: 18, fontWeight: '700', color: colors.acc },
  instruction: { flex: 1, lineHeight: 18 },
  anchorCard: { padding: spacing.md },
  volumeCard: { padding: spacing.md, gap: spacing.xs },
  volumeLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 28, justifyContent: 'center' },
  trackFill: { position: 'absolute', left: 0, top: 12, height: 4, borderRadius: 2, backgroundColor: colors.acc },
  thumb: {
    position: 'absolute',
    top: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassLine,
  },
  volumeHint: { textAlign: 'center' },
  playWrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  playButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.priSurface,
  },
  playButtonActive: { opacity: 0.75 },
  playLabel: { color: colors.mut },
  wave: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 20 },
  waveBar: { width: 3, borderRadius: 1.5 },
  questionBlock: { gap: spacing.sm },
  questionLabel: { color: colors.ink, fontWeight: '600' },
  footerWrap: { gap: spacing.xs },
  footerHint: { textAlign: 'center' },
});

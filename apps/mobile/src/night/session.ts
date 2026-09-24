/**
 * The night, running (WO L2.8 deliverable #1 · APP-RUN §2 "L2.8" · DESIGN §5.1/§5.3).
 *
 * `packages/engine`'s own header says the app around `createNightController` is "a
 * sensor feeder, an audio player and a screen, nothing else" — this file is exactly
 * that feeder + player, wired to `packages/engine`'s `createRemEstimator` +
 * `createNightController` pair the same way `nightController.ts`'s own doc comment
 * sketches it:
 *
 * ```ts
 * const c = createNightController({ params: profile, mode: 'CUE', startT: epochs[0].t });
 * for (const e of epochs) for (const action of c.feed(e, pRem(e))) execute(action);
 * ```
 *
 * `startNightSession()` is the real thing: one `platform.watchSensorSource` epoch in,
 * one `NightAction[]` out, every action executed (`playAnchorOnce` gated on
 * `controller.state === 'CUE'` — the engine's own §0.5 S7 invariant, "the player may
 * only make a cue sound while state is CUE" — rather than re-asking `cueGate` a second
 * time with a hand-rebuilt context that could disagree with the engine's real one and
 * silently drop a cue the engine already committed to the database as `played: true`;
 * see `ledger/wo-notes/L2.8ui.md` for the longer version of this call), every epoch/cue/
 * wake persisted to `src/data/night.ts`, the Live Activity and the watch's "stop" button
 * both wired to the same `NightController`.
 *
 * `startNightFixture()` is the `?fixture=night` web QC path: no watch, no SQLite, no
 * audio backend exist there (`src/data/index.ts`'s own rule) — it drives the identical
 * controller/estimator pair from `simulateNight`'s epochs instead, fed synchronously
 * (a night is 960 epochs; feeding them in a tight loop takes milliseconds) up to the
 * first point the screen has something worth screenshotting, then stops. Both paths
 * return the same `NightSessionHandle`, so `app/night.tsx` never has to know which one
 * it got.
 */

import {
  BED_VOLUME_FULL,
  createNightController,
  createRemEstimator,
  epochIndexOf,
  LIVE_TEXT_KEYS,
  simulateNight,
  systemClock,
  WAKE_MOTION_HIGH,
  type AnchorSignature,
  type NightAction,
  type NightController,
  type NightControllerMode,
  type NightState,
  type RemEstimator,
  type SensorEpoch,
} from '@lucid/engine';
import { isoFromEpochSeconds } from '@lucid/data';

import type { DreamPlan } from '../advisor/types';
import { ambienceSource, buildAnchorSignature, getAnchorSeed, playAnchorOnce } from '../audio/player';
import {
  attachArmKeyToSession,
  ensureNightSession,
  fetchNightSessionRecord,
  finishNightSession,
  markNightOnset,
  recordNightCue,
  recordNightEpoch,
  recordNightWake,
} from '../data/night';
import { translate, type Locale, type TranslationKey } from '../i18n';
import { pickTonightPlan } from '../learning';
import { scheduleMorningReminder } from '../notifications';
import { getPlatform, type PlatformBundle } from '../platform';
import { ensureSettingsHydrated } from '../settings/store';
import type { NightState as NightStoreState } from '../store/night';

/** Ambience volume while awake (DESIGN §5.3, `onset.ts`'s `BED_VOLUME_FULL`) — the level `startBed` is called at. */
const NIGHT_DURATION_SEC = 8 * 3600;
/** Ear test screens' own fallback (`EarTestScreen.tsx`'s `DEFAULT_START_VOLUME`) — kept in sync there. */
const DEFAULT_VOLUME_START = 0.15;
/** Dim, but still legible on the already-dark night screen (mockup `05-night.png` frame a). */
const NIGHT_BRIGHTNESS = 0.05;
/** A reasonable "not dark anymore" level for the rare case the phone stays unlocked into the report screen. */
const DAY_BRIGHTNESS = 0.6;

export interface NightLiveStats {
  state: NightState;
  /** ISO of the most recent epoch fed (or the night's start before the first one) — the
   * screen's own clock, so `?fixture=night` renders a self-consistent time, not `Date.now()`. */
  nowIso: string | null;
  pRem: number | null;
  hrBpm: number | null;
  stillMin: number;
  /** Seconds since sleep onset, `null` before onset (`ledger/wo-notes/L2.6-2.7.md` debt 5's twin for display). */
  sleptForSec: number | null;
  cuesPlayed: number;
  cuesPlanned: number;
  anyCueWoke: boolean;
  /** The watch dropped out and the night switched to prior-window scheduling (L2.7). */
  timerFallback: boolean;
}

export interface NightSessionHandle {
  getStats(): NightLiveStats;
  /** Re-renders whenever `getStats()` would return something different. */
  subscribe(listener: () => void): () => void;
  /** Hold-to-stop (mockup `05-night.png`) → `NightController.userStop()`, then teardown. */
  stop(): Promise<void>;
  /** Unmount without stopping the night (screen backgrounded, not ended) — listeners only. */
  dispose(): void;
}

interface RuntimeContext {
  /** `null` in fixture mode — nothing is written to the database. */
  sessionId: string | null;
  plan: DreamPlan;
  locale: Locale;
  controller: NightController;
  estimator: RemEstimator;
  signature: AnchorSignature;
  startT: number;
  expectedEndT: number;
  /** `null` in fixture mode — nothing plays and no Live Activity is touched. */
  platform: PlatformBundle | null;
}

interface Runtime {
  feed(epoch: SensorEpoch): void;
  getStats(): NightLiveStats;
  subscribe(listener: () => void): () => void;
  stop(): Promise<void>;
  dispose(): void;
}

function createRuntime(ctx: RuntimeContext): Runtime {
  const listeners = new Set<() => void>();
  let lastEpoch: SensorEpoch | null = null;
  let lastPRem: number | null = null;
  let lastMoveT = Number.NEGATIVE_INFINITY;
  let onsetPersisted = false;
  let finished = false;
  let persistedWakeCount = 0;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  /** Best-effort: a failed write must never stop the night — the live stats already moved on. */
  function persist(run: (sessionId: string) => Promise<void>): void {
    if (ctx.sessionId === null) return;
    void run(ctx.sessionId).catch(() => undefined);
  }

  /**
   * `Repo.sessions.appendWake` is an insert, not an upsert (`repo.ts` has no "update a
   * wake" call) — so a wake is written exactly once, the moment it stops being the
   * *current* one (state leaves `AWAKE`, or a later wake starts), by which point the
   * engine has already frozen its `durationSec`. `force` (called from `stop()`) flushes
   * a wake that is still open when the night ends.
   */
  function flushClosedWakes(force: boolean): void {
    while (persistedWakeCount < ctx.controller.wakes.length) {
      const isLast = persistedWakeCount === ctx.controller.wakes.length - 1;
      if (isLast && ctx.controller.state === 'AWAKE' && !force) break;
      const wake = ctx.controller.wakes[persistedWakeCount];
      if (wake) {
        persist((sessionId) =>
          recordNightWake(sessionId, {
            atIso: isoFromEpochSeconds(wake.t),
            durationSec: wake.durationSec,
            cause: wake.cause,
          }),
        );
      }
      persistedWakeCount += 1;
    }
  }

  function execute(action: NightAction): void {
    switch (action.type) {
      case 'STATE': {
        flushClosedWakes(false);
        if ((action.to === 'MORNING' || action.to === 'ENDED') && !finished) {
          finished = true;
          persist((sessionId) => finishNightSession(sessionId, systemClock.nowIso()));
          // WO L3.3 "เตือนเช้าถ้าไม่เปิดแอปใน 20 นาทีหลังตื่น" — cancelled by
          // `useMorning.ts` the moment the morning room actually opens.
          if (ctx.platform) void scheduleMorningReminder(ctx.locale).catch(() => undefined);
        }
        break;
      }

      case 'PLAY_CUE':
      case 'LOG_CUE': {
        // The just-pushed cue — `tryCue()` pushes exactly one per PLAY_CUE/LOG_CUE action
        // (`nightController.ts`: "a cue ends the pass"), so this is always the right one.
        const cue = ctx.controller.cues[ctx.controller.cues.length - 1];
        if (!cue) break;
        if (action.type === 'PLAY_CUE' && ctx.controller.state === 'CUE' && ctx.platform) {
          void playAnchorOnce(ctx.signature, { volume: cue.volume, pan: 0 }).catch(() => undefined);
        }
        persist((sessionId) =>
          recordNightCue(sessionId, {
            atIso: isoFromEpochSeconds(cue.t),
            index: cue.index,
            volume: cue.volume,
            type: cue.type,
            pRemAtCue: cue.pRemAtCue,
            played: cue.played,
            response: cue.response,
          }),
        );
        break;
      }

      case 'SET_BED_VOLUME':
        if (ctx.platform) void ctx.platform.audioPlayer.setVolume(action.volume).catch(() => undefined);
        break;

      case 'WHISPER_SEED':
        // No rendered seed-line *audio* yet — the phrase is server-side TTS, still
        // unbuilt (`src/audio/anchor.ts`'s header, carried as a debt since WO L1.7ui) —
        // but the *event* is real and `repo.ts#buildEvents` already special-cases
        // `type: 'SEED'` for exactly this row (mockup `07-night-report.png`'s
        // "planting the image"), so it is still written to the database, `played: true` (a seed always
        // "plays" — the melody tone does, via the signature; only the spoken phrase
        // is the debt).
        if (__DEV__) {
          // eslint-disable-next-line no-console -- intentional dev-only trace (WO L2.8)
          console.log('[night] seed whisper', ctx.plan.seedLines[action.index - 1] ?? '');
        }
        persist((sessionId) =>
          recordNightCue(sessionId, {
            atIso: isoFromEpochSeconds(action.at),
            index: action.index,
            volume: ctx.controller.params.volumeStart,
            type: 'SEED',
            pRemAtCue: null,
            played: true,
            response: null,
          }),
        );
        break;

      case 'STOP_AUDIO':
        if (ctx.platform) void ctx.platform.audioPlayer.stopBed().catch(() => undefined);
        break;

      case 'LIVE':
        if (ctx.platform && ctx.platform.liveStatus.isSupported()) {
          void ctx.platform.liveStatus
            .update({
              emoji: ctx.plan.theme.emoji,
              headline: translate(ctx.locale, action.text as TranslationKey),
              cuesPlayed: ctx.controller.cues.filter((c) => c.played).length,
              cuesPlanned: ctx.controller.maxCuesTonight,
              pRem: lastPRem,
            })
            .catch(() => undefined);
        }
        break;

      default:
        break;
    }
  }

  function feed(epoch: SensorEpoch): void {
    const detailed = ctx.estimator.feedDetailed(epoch, {
      onsetT: ctx.controller.onsetT,
      nightStartT: ctx.startT,
      expectedEndT: ctx.expectedEndT,
    });
    const actions = ctx.controller.feed(epoch, detailed.p);

    lastEpoch = epoch;
    lastPRem = detailed.p;
    if (epoch.motion == null || epoch.motion > WAKE_MOTION_HIGH) lastMoveT = epoch.t;

    for (const action of actions) execute(action);

    if (ctx.controller.onsetT != null && !onsetPersisted) {
      onsetPersisted = true;
      const onsetT = ctx.controller.onsetT;
      const guardIso = Number.isFinite(ctx.controller.guardUntilT)
        ? isoFromEpochSeconds(ctx.controller.guardUntilT)
        : null;
      persist((sessionId) => markNightOnset(sessionId, isoFromEpochSeconds(onsetT), guardIso));
    }

    persist((sessionId) => recordNightEpoch(sessionId, epoch, detailed.p, ctx.controller.state));
    emit();
  }

  function getStats(): NightLiveStats {
    const nowT = lastEpoch?.t ?? ctx.startT;
    const stillSec = Number.isFinite(lastMoveT) ? Math.max(0, nowT - lastMoveT) : 0;
    return {
      state: ctx.controller.state,
      nowIso: lastEpoch ? isoFromEpochSeconds(nowT) : null,
      pRem: lastPRem,
      hrBpm: lastEpoch?.hrMean ?? null,
      stillMin: Math.floor(stillSec / 60),
      sleptForSec: ctx.controller.onsetT == null ? null : Math.max(0, nowT - ctx.controller.onsetT),
      cuesPlayed: ctx.controller.cues.filter((c) => c.played).length,
      cuesPlanned: ctx.controller.maxCuesTonight,
      anyCueWoke: ctx.controller.cues.some((c) => c.response === 'WOKE'),
      timerFallback: ctx.controller.mode === 'TIMER' || ctx.controller.timerFallback,
    };
  }

  async function stop(): Promise<void> {
    for (const action of ctx.controller.userStop()) execute(action);
    flushClosedWakes(true);
    emit();
  }

  function dispose(): void {
    listeners.clear();
  }

  return {
    feed,
    getStats,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop,
    dispose,
  };
}

/** The real thing — watch epochs in, audio/Live Activity/database out. */
export async function startNightSession(state: NightStoreState): Promise<NightSessionHandle> {
  if (state.plan === null) throw new Error('night/session: startNightSession needs a plan');
  const plan = state.plan;
  const locale: Locale = state.lang ?? 'en';
  const platform = getPlatform();

  const dateIso = new Date().toISOString().slice(0, 10);
  const sessionId = await ensureNightSession(state.sessionId, plan, dateIso);
  // Decided once, at creation (`ensureNightSession`, `src/data/night.ts`) — this session
  // may already exist from an earlier ear test screen, so its `mode` is read back rather
  // than re-decided here (WO L3.3: control nights are picked once per night, not once per
  // reader of this function).
  const sessionRecord = await fetchNightSessionRecord(sessionId);
  const mode: NightControllerMode = sessionRecord?.mode ?? 'CUE';

  const settings = await ensureSettingsHydrated();
  const earTestVolume = state.earTests.L?.volume ?? state.earTests.R?.volume ?? DEFAULT_VOLUME_START;
  // WO L3.4 "app side": `nights ≥ 14` → tonight's arm comes from the bandit; otherwise the
  // DEFAULT params + `nextNightVolume` ramp from last night. Control nights still get a
  // plan (the counterfactual cue needs *some* volume/delay/type to log), just never learn
  // from it — `attachArmKeyToSession` below is itself a no-op on a control night.
  const learningPlan = await pickTonightPlan(dateIso, earTestVolume);
  await attachArmKeyToSession(sessionId, learningPlan.armKey);

  const startT = epochIndexOf(Date.now());
  const expectedEndT = startT + NIGHT_DURATION_SEC;

  const controller = createNightController({
    params: {
      volumeStart: learningPlan.volumeStart,
      guardHours: settings.guardHours,
      maxCuesPerNight: settings.maxCuesPerNight,
      cueDelaySec: learningPlan.cueDelaySec,
    },
    mode,
    cueType: learningPlan.cueType,
    startT,
    expectedEndT,
    // §5.1 "awake ≥ 10 min after 05:00 → MORNING", timezone-free stand-in: the engine has
    // no timezone (`ledger/wo-notes/L2.6-2.7.md` debt 1) — a flat "8 h after lights-out"
    // is the WO's own documented placeholder until a real alarm time exists (L3.1/L3.6).
    morningAfterT: expectedEndT,
    clock: systemClock,
  });

  const seed = await getAnchorSeed();
  const signature = buildAnchorSignature(seed, locale);
  const estimator = createRemEstimator();

  const runtime = createRuntime({
    sessionId,
    plan,
    locale,
    controller,
    estimator,
    signature,
    startT,
    expectedEndT,
    platform,
  });

  // Best-effort platform start: none of these failing should stop the night from
  // running data-only (sleep-first default, DESIGN §2.1) — the controller and the
  // database writes above do not depend on any of it succeeding.
  try {
    await platform.audioPlayer.configureSession();
    await platform.audioPlayer.startBed(BED_VOLUME_FULL, ambienceSource(plan.ambienceKey));
  } catch {
    // proceed without ambience
  }
  void platform.display.setBrightness(NIGHT_BRIGHTNESS).catch(() => undefined);

  let liveStarted = false;
  if (platform.liveStatus.isSupported()) {
    try {
      await platform.liveStatus.start({
        emoji: plan.theme.emoji,
        headline: translate(locale, LIVE_TEXT_KEYS[controller.state] as TranslationKey),
        cuesPlayed: 0,
        cuesPlanned: controller.maxCuesTonight,
        pRem: null,
      });
      liveStarted = true;
    } catch {
      // Live Activity native bridge not wired yet — see ledger/wo-notes/L2.8ui.md
    }
  }

  let handle: NightSessionHandle;
  const unsubscribeEpoch = platform.watchSensorSource.onEpoch((epoch) => runtime.feed(epoch));
  const unsubscribeCommand = platform.watchSensorSource.onCommand((command) => {
    if (command === 'stop') void handle.stop();
  });
  try {
    await platform.watchSensorSource.start();
  } catch {
    // No watch reachable tonight — L2.7's timer fallback takes over once the controller
    // notices 10 minutes with nothing readable.
  }

  let stopped = false;
  handle = {
    getStats: runtime.getStats,
    subscribe: runtime.subscribe,
    async stop() {
      if (stopped) return;
      stopped = true;
      await runtime.stop();
      unsubscribeEpoch();
      unsubscribeCommand();
      await platform.watchSensorSource.stop().catch(() => undefined);
      await platform.audioPlayer.stopBed().catch(() => undefined);
      await platform.audioPlayer.dispose().catch(() => undefined);
      if (liveStarted) await platform.liveStatus.stop().catch(() => undefined);
      void platform.display.setBrightness(DAY_BRIGHTNESS).catch(() => undefined);
    },
    dispose() {
      runtime.dispose();
    },
  };

  return handle;
}

/**
 * `?fixture=night` (WO L2.8 QC parity, mockup `05-night.png` frame a): the exact same
 * controller/estimator pair, fed from `simulateNight` instead of a watch, stopped the
 * first time the screen has the 72%-ish orb + a couple of whispers the mockup shows —
 * not the full 8 h (`ledger/wo-notes/L2.8ui.md` explains the stopping rule and why the
 * shown percentage will not be pixel-identical to the mockup's "72%" every run).
 */
export function startNightFixture(locale: Locale): NightSessionHandle {
  const plan: DreamPlan = {
    theme: { emoji: '🐋', titleTh: translate('th', 'advisor.theme.whale'), titleEn: translate('en', 'advisor.theme.whale'), place: translate(locale, 'advisor.theme.whale.place') },
    seedLines: [translate(locale, 'advisor.theme.whale.seed1'), translate(locale, 'advisor.clarify.turtle.detail')],
    anchorPhrase: translate(locale, 'advisor.anchorPhrase'),
    ambienceKey: 'underwater',
    clarify: null,
  };

  const sim = simulateNight({ seed: 20_260_924, sleepAtIso: '2026-09-24T16:10:00.000Z', durationMin: 480, wakeCount: 1 });
  const startT = sim.epochs[0]?.t ?? epochIndexOf(Date.now());
  const expectedEndT = startT + NIGHT_DURATION_SEC;

  const controller = createNightController({
    params: { volumeStart: DEFAULT_VOLUME_START },
    mode: 'CUE',
    startT,
    expectedEndT,
    clock: systemClock,
  });
  const estimator = createRemEstimator();
  const signature = buildAnchorSignature('fixture-night-seed', locale);

  const runtime = createRuntime({
    sessionId: null,
    plan,
    locale,
    controller,
    estimator,
    signature,
    startT,
    expectedEndT,
    platform: null,
  });

  for (const epoch of sim.epochs) {
    runtime.feed(epoch);
    const stats = runtime.getStats();
    if (stats.cuesPlayed >= 2 && stats.pRem != null && stats.pRem >= 0.6) break;
  }

  return {
    getStats: runtime.getStats,
    subscribe: runtime.subscribe,
    stop: () => runtime.stop(),
    dispose: () => runtime.dispose(),
  };
}

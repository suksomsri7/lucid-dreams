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
 * `startNightSession()` is the real thing: one `src/sensors/hub.ts` epoch in (merged from the
 * watch, a BLE heart-rate strap and/or the phone on the mattress — WO L2.3),
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
import { ambienceSource, buildAnchorSignature, getAnchorSeed, playAnchorOnce, prefetchFullAnchor } from '../audio/player';
import { ensureSeedLineUri, prefetchSeedLines } from '../audio/seedRemote';
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
import { buildNightSensorHub } from '../sensors/hub';
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

// ---------------------------------------------------------------------------
// WO L3.14 — the night's mix: how loud each sound is, and how far the bed gets out of its way
// ---------------------------------------------------------------------------

/**
 * The spoken seed lines at minute 3 and minute 8 (`SEED_VOLUME`) are heard by someone who is
 * still **awake**, on headphones, in a quiet room — they have to be understood, not merely
 * noticed, which is why they are louder than anything else the night plays (the REM cue sits at
 * `volumeStart`, ~0.15, and must *not* wake anybody). Owner's release table, WO L3.14.
 */
const SEED_VOLUME = 0.35;

/**
 * Ambience level while a seed line is speaking. Not silence: the bed is what makes the room feel
 * continuous, and a hard gap is itself a thing that wakes people. 0.06 against a 0.35 voice is
 * about -15 dB of separation — enough for every word.
 */
const BED_DUCK_SEED = 0.06;

/**
 * Ambience level while a REM cue plays (~9.8 s). Lower than the seed duck because the cue itself
 * is far quieter than a seed line (0.15 or less), so it needs more room, and because at 3 a.m.
 * the sleeper must hear the bell without the ambience adding to the total loudness.
 */
const BED_DUCK_CUE = 0.03;

/** Fade-in before a seed line, so the duck is a movement in the room rather than a click. */
const SEED_DUCK_LEAD_MS = 500;
/** And a beat of quiet after the sentence before the bed comes back (owner's table: "+1 s"). */
const SEED_RESTORE_DELAY_MS = 1000;
/**
 * How long a seed line may wait for its file. The clip is prefetched three times before
 * lights-out, so this only ever bites when the prefetch failed — and in that case a sentence
 * arriving late is worse than no sentence at all (the sleeper may already be under).
 */
const SEED_URI_WAIT_MS = 3000;
/** The cue's restore is stepped over ~3 s (3 × 1 s) so the ambience does not jump back. */
const CUE_RESTORE_STEPS = 3;
const CUE_RESTORE_STEP_MS = 1000;

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
  /** WO L3.8 — cues that played the full anchor (bell + whisper) … */
  cuesWithFullAnchor: number;
  /** … and cues that fell back to the bell WAV alone (no downloaded file yet, or no network). */
  cuesBellOnly: number;
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

/**
 * The theme title in tonight's language — the same choice `app/plan/index.tsx` and
 * `PlanCardCompact.tsx` make. Needed by the lock-screen card, whose first line is
 * "🐋 <theme title>" (mockup `05-night.png` frame b), not just the emoji (WO L2.2n).
 */
function themeTitle(plan: DreamPlan, locale: Locale): string {
  return locale === 'th' ? plan.theme.titleTh : plan.theme.titleEn;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `promise`, or `null` if it has not settled within `ms` (WO L3.14). The promise itself is left
 * running — `ensureSeedLineUri`'s download still finishes and still writes its cache file, it just
 * no longer has a say in what the sleeper hears tonight.
 */
async function withDeadline<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([promise, sleep(ms).then(() => null)]);
}

function createRuntime(ctx: RuntimeContext): Runtime {
  const listeners = new Set<() => void>();
  let lastEpoch: SensorEpoch | null = null;
  let lastPRem: number | null = null;
  let lastMoveT = Number.NEGATIVE_INFINITY;
  let onsetPersisted = false;
  let finished = false;
  let persistedWakeCount = 0;
  /**
   * WO L3.8 — how many of tonight's cues actually contained the whispered sentence, and how many
   * were the bell alone because the full anchor had never been downloaded (`src/audio/
   * anchorRemote.ts`). The database's cue row has no column for this (`packages/data`'s
   * `appendCue` is off-limits to this WO), so it lives on the live stats the night screen and
   * `stop()` already read — enough for R1 to answer "did the whisper reach the user tonight?"
   * from the app instead of from the server's logs.
   */
  let cuesWithFullAnchor = 0;
  let cuesBellOnly = 0;
  /**
   * WO L3.14 — the level the bed *should* be playing at right now: `BED_VOLUME_FULL` while the
   * user is awake (that is the level `startNightSession` calls `startBed` at), then whatever the
   * engine's last `SET_BED_VOLUME` said (the 0.2 → 0.08 fade after sleep onset, §5.3). Every duck
   * restores to this value rather than to the level it ducked from, so a fade that ran *during* a
   * one-shot is not undone by the restore.
   */
  let currentBedVolume = BED_VOLUME_FULL;
  /** True between a duck and the end of its restore — `SET_BED_VOLUME` defers to it. */
  let bedDucked = false;
  /** One one-shot at a time: a seed line must never be mixed on top of an anchor cue. */
  let oneShotBusy = false;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  /** Bed level, best-effort (audio is never allowed to break a night — DESIGN §2.1). */
  function setBedVolume(volume: number): void {
    if (!ctx.platform) return;
    void ctx.platform.audioPlayer.setVolume(volume).catch(() => undefined);
  }

  /** Pull the ambience down under a one-shot (`BED_DUCK_SEED` / `BED_DUCK_CUE`). */
  function duckBed(level: number): void {
    bedDucked = true;
    setBedVolume(level);
  }

  /**
   * Bring the bed back to `currentBedVolume` in `steps` equal moves, `CUE_RESTORE_STEP_MS` apart
   * (`steps = 1` ⇒ one move after that delay). The target is read inside each step, so a
   * `SET_BED_VOLUME` that arrived while the one-shot was sounding wins.
   */
  function restoreBed(from: number, steps: number, firstDelayMs: number): void {
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      const last = step === steps;
      setTimeout(
        () => {
          setBedVolume(from + (currentBedVolume - from) * fraction);
          if (last) bedDucked = false;
        },
        firstDelayMs + (step - 1) * CUE_RESTORE_STEP_MS,
      );
    }
  }

  /**
   * WO L3.14 — speak seed line `index` (1-based) over a ducked bed; resolves to what actually
   * reached the sleeper, which is what the database row's `played` now records.
   *
   * `false` means the sentence stayed silent: no audio backend (fixture/web), an empty line, an
   * anchor cue already sounding, or no cached clip within {@link SEED_URI_WAIT_MS} — a seed line
   * that arrives late is worse than one that does not arrive (the sleeper may already be under),
   * so the deadline is deliberately shorter than `fetchTtsAudio`'s own 15 s timeout; the download
   * it started still finishes in the background and warms the file for the next night.
   */
  async function speakSeedLine(index: number): Promise<boolean> {
    const platform = ctx.platform;
    const line = ctx.plan.seedLines[index - 1] ?? '';
    if (platform === null || line === '' || oneShotBusy) return false;
    oneShotBusy = true;
    let ducked = false;
    try {
      const uri = await withDeadline(ensureSeedLineUri(line, ctx.locale), SEED_URI_WAIT_MS);
      if (uri === null) return false;
      duckBed(BED_DUCK_SEED);
      ducked = true;
      await sleep(SEED_DUCK_LEAD_MS);
      await platform.audioPlayer.playOneShot({ source: uri, volume: SEED_VOLUME, pan: 0 });
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console -- the only signal R1 gets for a silent minute 3
      console.warn('[night] seed line did not play', error);
      return false;
    } finally {
      if (ducked) restoreBed(BED_DUCK_SEED, 1, SEED_RESTORE_DELAY_MS);
      oneShotBusy = false;
    }
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
          // WO L3.3 "remind in the morning if the app is not opened within 20 min of waking" — cancelled by
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
          const cueIndex = cue.index;
          // WO L3.14: the cue is the one sound that must never be masked — the bed goes down to
          // `BED_DUCK_CUE` for the ~9.8 s of the anchor and comes back stepwise afterwards. The
          // duck happens *before* `playAnchorOnce` resolves the file (a cached-only lookup, so
          // microseconds) rather than after, so the bell never lands on a full-volume bed. Unlike
          // a seed line the cue does not yield to `oneShotBusy`: by the time a cue can happen the
          // guard hours are long over and no seed line exists to collide with.
          oneShotBusy = true;
          duckBed(BED_DUCK_CUE);
          void playAnchorOnce(ctx.signature, { volume: cue.volume, pan: 0, lang: ctx.signature.lang, cachedOnly: true })
            .then((playback) => {
              // WO L3.8: which of the two sounds the user just heard. Counted (not just logged)
              // because "the cue played" and "the cue whispered" are two different claims and
              // only the first one was ever recorded before this.
              if (playback.fullAnchor) cuesWithFullAnchor += 1;
              else cuesBellOnly += 1;
              if (__DEV__) {
                // eslint-disable-next-line no-console -- dev-only trace, same shape as WHISPER_SEED below
                console.log('[night] cue audio', { index: cueIndex, fullAnchor: playback.fullAnchor });
              }
              emit();
            })
            .catch(() => undefined)
            .finally(() => {
              restoreBed(BED_DUCK_CUE, CUE_RESTORE_STEPS, CUE_RESTORE_STEP_MS);
              oneShotBusy = false;
            });
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
        // WO L3.14: remembered even while a duck is in flight, and *not* applied then — the
        // engine's post-onset fade emits one of these every epoch, and letting them through
        // mid-sentence would undo the duck. `restoreBed` reads this value, so the fade still
        // lands, a few seconds later, at the right level.
        currentBedVolume = action.volume;
        if (ctx.platform && !bedDucked) void ctx.platform.audioPlayer.setVolume(action.volume).catch(() => undefined);
        break;

      case 'WHISPER_SEED': {
        // WO L3.14 pays the debt `src/audio/anchor.ts`'s header carried since L1.7ui: the sentence
        // is now *spoken* (George, `/ai/tts`, cached per sentence by `src/audio/seedRemote.ts`)
        // over a ducked bed. `repo.ts#buildEvents` already special-cases `type: 'SEED'` for this
        // row (mockup `07-night-report.png`'s "planting the image"); the row is written after the
        // attempt, because `played` is now a fact about the sleeper's ears rather than the
        // hard-coded `true` it used to be — a night where the clip never downloaded shows up as
        // `played: false` in the morning report instead of lying about it.
        const { index, at } = action;
        if (__DEV__) {
          // eslint-disable-next-line no-console -- intentional dev-only trace (WO L2.8)
          console.log('[night] seed whisper', ctx.plan.seedLines[index - 1] ?? '');
        }
        void speakSeedLine(index).then((seedPlayed) => {
          persist((sessionId) =>
            recordNightCue(sessionId, {
              atIso: isoFromEpochSeconds(at),
              index,
              volume: SEED_VOLUME,
              type: 'SEED',
              pRemAtCue: null,
              played: seedPlayed,
              response: null,
            }),
          );
          emit();
        });
        break;
      }

      case 'STOP_AUDIO':
        if (ctx.platform) void ctx.platform.audioPlayer.stopBed().catch(() => undefined);
        break;

      case 'LIVE':
        if (ctx.platform && ctx.platform.liveStatus.isSupported()) {
          void ctx.platform.liveStatus
            .update({
              emoji: ctx.plan.theme.emoji,
              title: themeTitle(ctx.plan, ctx.locale),
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
      cuesWithFullAnchor,
      cuesBellOnly,
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
  // Last chance to have the bell+whisper file on disk before lights-out (cues are cachedOnly).
  void prefetchFullAnchor().catch(() => undefined);

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
  // WO L3.14, last chance #3: the two spoken seed lines have to be on disk before the phone goes
  // on the nightstand — minute 3 waits 3 s for a file and no longer (`speakSeedLine`). Never
  // awaited (a slow render must not delay lights-out) and never throws.
  void prefetchSeedLines(plan, locale).catch(() => undefined);

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
        title: themeTitle(plan, locale),
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
  // WO L2.3: the night no longer listens to one watch — it listens to the hub that merges every
  // source the sleeper actually has (watch · BLE strap · phone on the mattress) into one epoch
  // every 30 s, and that keeps emitting empty epochs when they all go quiet, which is what lets
  // the controller fall back to timer mode after 10 minutes (`src/sensors/hub.ts`).
  const sensors = buildNightSensorHub(platform);
  const unsubscribeEpoch = sensors.onEpoch((epoch) => runtime.feed(epoch));
  const unsubscribeCommand = sensors.onCommand((command) => {
    if (command === 'stop') void handle.stop();
  });
  // The other "stop from outside the app": the Live Activity's button on the lock screen, which
  // arrives as a deep link (WO L2.2n). Same destination as the watch's button — one
  // `NightController.userStop()`, whichever surface asked.
  const unsubscribeLiveStop = platform.liveStatus.onStopRequested(() => {
    void handle.stop();
  });
  try {
    await sensors.start();
  } catch {
    // No source reachable tonight — L2.7's timer fallback takes over once the controller
    // notices 10 minutes with nothing readable. (`AppSensorHub.start()` already swallows a
    // single source failing; this catch is for the hub itself failing to arm its timer.)
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
      unsubscribeLiveStop();
      await sensors.stop().catch(() => undefined);
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

/**
 * The learning loop, persisted (WO L3.4 "app side" · DESIGN §5.5 · APP-RUN §2 "L3.4").
 * `packages/engine/src/bandit.ts` is the whole model (Thompson sampling over 27 arms,
 * `nightReward`, `personalModelFromBandit`, `explainLearning`) and is off-limits to this
 * WO — everything here is the app wiring: pick tonight's arm, fold last night's result
 * back in, and hand the journal tab something to explain.
 *
 * ## Why every CUE night gets an `armKey`, not just the ones the bandit picked
 *
 * The task spec is "`bandit.pick()` once `nights ≥ 14`, else DEFAULT params + the
 * `nextNightVolume` ramp" — read literally that is a deadlock: `nights` only grows when
 * {@link recordNightOutcome} folds a night in, but a night can only be folded in if it
 * has an `armKey` to fold into, and only the `nights ≥ 14` branch ever wrote one. Nothing
 * would ever reach night 1.
 *
 * The break: **every** CUE night is attributed to the nearest of the 27 arms
 * (`nearestArm` below), even during the ramp phase — the *volume actually played* still
 * follows the smooth ramp (unaffected), only the *bucket the reward trains* is
 * discretised. So the bandit starts learning from night 1, `nights` in the saved
 * `PersonalModel` really does count every scored CUE night, and by night 14 there is
 * real posterior data for {@link personalModelFromBandit} to recommend from — not an
 * empty prior. Control nights are never attributed to any arm (§5.5: "a control night
 * never updates anything") and get no `armKey` at all.
 *
 * ## Why `personalModelFromBandit` is never called on a bandit built just now
 *
 * `personalModelFromBandit` reads `bandit.nights` — a counter the *in-memory* handle
 * increments itself, starting at 0 every time `createBandit()` is called. Every bandit
 * in this file is built fresh from the saved posterior (there is no long-lived instance
 * across app launches), so `bandit.nights` would always read 0/1 here regardless of how
 * many real nights are behind it. That is harmless where only `suggestedVolume`/
 * `volumeCeiling`/`topArm` are read (none of those three depend on `nights`) — but
 * {@link getPersonalModel} needs the *true* `nights`/`confidence`/`learning` for the
 * journal tab, so it builds a tiny read-only stand-in that reports the real, saved
 * night count instead of trusting a fresh handle's own counter (`fakeBanditHandle`).
 */

import {
  ARM_DELAYS_SEC,
  ARM_VOLUMES,
  armFromKey,
  armKey as armKeyOf,
  clamp,
  createBandit,
  explainLearning,
  mulberry32,
  nextNightVolume,
  nightReward,
  personalModelFromBandit,
  playerCueType,
  PERSONAL_MODEL_MIN_NIGHTS,
  VOLUME_MAX,
  VOLUME_MIN,
  type Arm,
  type ArmCueType,
  type BanditHandle,
  type BetaPosterior,
  type CueEvent,
  type CueType,
  type MessageLang,
  type PersonalModel,
} from '@lucid/engine';

import { fetchLastNights } from '../data/history';
import { getAnchorSeed } from '../audio/player';
import { fetchNightSessionRecord } from '../data/night';
import { loadPersonalModel, savePersonalModel } from '../data/personalModel';
import { fetchNightReport } from '../data/report';

const SEED_NAMESPACE = 'lucid-learning';
/** DESIGN §5.3's default delay (`60 s`, `DEFAULT_NIGHT_PARAMS.cueDelaySec`) — the ramp
 * phase's own choice of delay, since only volume actually ramps night to night. */
const DEFAULT_CUE_DELAY_SEC = 60;
const DEFAULT_CUE_TYPE: CueType = 'WHISPER';

function seedFromString(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** The arm closest to whatever the app actually played — see the file header's "why every night gets an armKey". */
function nearestArm(volumeStart: number, cueDelaySec: number, cueType: CueType): Arm {
  const nearestVolume = ARM_VOLUMES.reduce((best, v) => (Math.abs(v - volumeStart) < Math.abs(best - volumeStart) ? v : best));
  const nearestDelay = ARM_DELAYS_SEC.reduce((best, d) => (Math.abs(d - cueDelaySec) < Math.abs(best - cueDelaySec) ? d : best));
  const armCueType: ArmCueType = cueType === 'AMBIENCE_UP' ? 'AMBIENCE_SWELL' : cueType === 'SPOKEN' ? 'WHISPER' : cueType;
  return { volume: nearestVolume, delaySec: nearestDelay, cueType: armCueType };
}

/** A read-only stand-in for `BanditHandle` that reports the *saved* night count instead of a fresh instance's own (always 0/1) counter — see file header. `pick`/`update` are never called on it. */
function readOnlyBanditView(posterior: Record<string, BetaPosterior>, nights: number): BanditHandle {
  return {
    pick(): Arm {
      throw new Error('learning: readOnlyBanditView cannot pick — build a real createBandit() for that');
    },
    update(): void {
      throw new Error('learning: readOnlyBanditView cannot update — build a real createBandit() for that');
    },
    posterior: () => posterior,
    get nights() {
      return nights;
    },
  };
}

async function loadLastCueNightCueEvents(): Promise<{ cueEvents: CueEvent[]; volumeStart: number } | null> {
  try {
    const recent = await fetchLastNights(14);
    const lastCue = recent.find((night) => night.mode === 'CUE' && night.hasReport && night.playedCueCount > 0);
    if (lastCue === undefined) return null;
    const report = await fetchNightReport(lastCue.id);
    const realCues = report.cues.filter((cue) => cue.type !== 'SEED' && cue.played);
    if (realCues.length === 0) return null;
    const cueEvents: CueEvent[] = realCues.map((cue) => ({
      t: Math.floor(Date.parse(cue.at) / 1000),
      index: cue.index,
      volume: cue.volume,
      type: cue.type as CueType,
      pRemAtCue: cue.pRemAtCue ?? 0,
      played: cue.played,
      response: cue.response,
    }));
    const last = cueEvents[cueEvents.length - 1];
    return last === undefined ? null : { cueEvents, volumeStart: last.volume };
  } catch {
    return null;
  }
}

export interface TonightLearningPlan {
  volumeStart: number;
  cueDelaySec: number;
  cueType: CueType;
  /** Stored on `NightSession.params.armKey` (`src/data/night.ts#ensureNightSession`) so {@link recordNightOutcome} can find it again in the morning. */
  armKey: string;
  /** `true` when tonight's numbers came from Thompson sampling (`nights ≥ 14`), `false` during the ramp phase. */
  usingBandit: boolean;
}

/**
 * Tonight's volume/delay/cue-type (WO L3.4's "pass volume/delay/cueType into
 * NightParams"). `dateIso`/`fallbackVolume` mirror `controlNight.ts#isControlNight`'s own
 * inputs — `fallbackVolume` is the ear test's chosen level, used whenever there is no
 * bandit recommendation and no previous CUE night to ramp from.
 */
export async function pickTonightPlan(dateIso: string, fallbackVolume: number): Promise<TonightLearningPlan> {
  const stored = await loadPersonalModel();
  const nights = stored?.nights ?? 0;

  if (stored !== null && nights >= PERSONAL_MODEL_MIN_NIGHTS) {
    const seed = await getAnchorSeed();
    const rng = mulberry32(seedFromString(`${SEED_NAMESPACE}|pick|${seed}|${dateIso}`));
    const bandit = createBandit({ prior: stored.posterior, rng });
    const arm = bandit.pick();
    // `suggestedVolume`/`volumeCeiling` do not read `bandit.nights` (see file header) — a
    // freshly built bandit is fine here.
    const model = personalModelFromBandit(bandit, VOLUME_MAX);
    return {
      volumeStart: model.suggestedVolume,
      cueDelaySec: arm.delaySec,
      cueType: playerCueType(arm),
      armKey: armKeyOf(arm),
      usingBandit: true,
    };
  }

  const last = await loadLastCueNightCueEvents();
  const ramped = last !== null ? nextNightVolume(last.cueEvents, last.volumeStart) : fallbackVolume;
  const volumeStart = clamp(ramped, VOLUME_MIN, VOLUME_MAX);
  const arm = nearestArm(volumeStart, DEFAULT_CUE_DELAY_SEC, DEFAULT_CUE_TYPE);
  return {
    volumeStart,
    cueDelaySec: DEFAULT_CUE_DELAY_SEC,
    cueType: DEFAULT_CUE_TYPE,
    armKey: armKeyOf(arm),
    usingBandit: false,
  };
}

/**
 * Fold last night's outcome into the bandit — called once from `useMorning.ts#finalize`,
 * right after the `MorningReport` is saved (so `report.report`/`report.cues` are already
 * final). No-ops on a control night, a night with no stored `armKey` (should not happen
 * for a CUE night created after this WO, see the file header) and a night with no
 * morning report yet (nothing to score).
 */
export async function recordNightOutcome(sessionId: string): Promise<void> {
  const session = await fetchNightSessionRecord(sessionId);
  if (session === null || session.mode === 'CONTROL') return; // §5.5: a control night never updates anything

  const rawArmKey = session.params?.armKey;
  if (typeof rawArmKey !== 'string') return;
  const arm = armFromKey(rawArmKey);
  if (arm === null) return;

  const report = await fetchNightReport(sessionId);
  const morning = report.report;
  if (morning === null) return;

  const realCues = report.cues.filter((cue) => cue.type !== 'SEED');
  const cueWoke = morning.cueWoke === true || realCues.some((cue) => cue.response === 'WOKE');
  const reward = nightReward({
    lucid: morning.lucid,
    themeMatch: morning.themeMatchUser,
    cueWoke,
    sleepQuality: morning.sleepQuality,
  });

  const stored = await loadPersonalModel();
  const seed = await getAnchorSeed();
  const rng = mulberry32(seedFromString(`${SEED_NAMESPACE}|update|${seed}|${sessionId}`));
  const bandit = createBandit({ prior: stored?.posterior, rng });
  bandit.update(arm, reward); // clamps reward into [0,1] internally (bandit.ts)

  const nights = (stored?.nights ?? 0) + 1;
  // `volumeCeiling`/`topArm.delaySec` do not depend on `bandit.nights` either — see file header.
  const view = personalModelFromBandit(bandit, VOLUME_MAX);
  await savePersonalModel({
    posterior: bandit.posterior(),
    nights,
    volumeCeiling: view.volumeCeiling,
    bestDelay: view.topArm.delaySec,
    updatedAtIso: new Date().toISOString(),
  });
}

/** `null` before the first CUE night has ever been scored — `journal.tsx` shows "กำลังเรียนรู้ 0/14" itself in that case, same as any other `learning: true` model. */
export async function getPersonalModel(): Promise<PersonalModel | null> {
  const stored = await loadPersonalModel();
  if (stored === null || stored.nights === 0) return null;
  const view = readOnlyBanditView(stored.posterior, stored.nights);
  return personalModelFromBandit(view, VOLUME_MAX);
}

/** Re-exported so screens that only need the explanation sentence do not also need to import `@lucid/engine` directly for it. */
export { explainLearning, PERSONAL_MODEL_MIN_NIGHTS };
export type { MessageLang, PersonalModel };

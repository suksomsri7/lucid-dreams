/**
 * Shared types of the night engine (DESIGN-APP §5 · §7).
 *
 * Everything here is data — no behaviour, no I/O, no platform types. The state
 * machine (L2.6), the REM estimator (L2.5), the wake detector (L2.7) and the
 * report screens all speak these shapes, so the simulator in `simulate.ts` can
 * feed the real engine without a phone anywhere near it.
 *
 * `SensorEpoch` is **not** redefined here: it is owned by `diagnostics.ts`
 * (it is the wire format the watch sends and the export file stores) and only
 * re-exported, so there can never be two drifting copies of it.
 */

import { type SensorEpoch } from './diagnostics';

export { type SensorEpoch };

// ---------------------------------------------------------------------------
// Sleep stages
// ---------------------------------------------------------------------------

/**
 * AASM stages as far as a wrist can pretend to know them.
 * `N1`/`N2` = light sleep ("Core" in Apple Health), `N3` = slow-wave/deep,
 * `REM` = rapid eye movement. Apple's own scoring collapses N1+N2 into `CORE`,
 * so L2.9 maps `N1`/`N2` → `CORE` when comparing with HealthKit.
 */
export type SleepStage = 'WAKE' | 'N1' | 'N2' | 'REM' | 'N3';

/** All stages, in hypnogram drawing order (deepest last) — handy for charts and tests. */
export const SLEEP_STAGES: readonly SleepStage[] = ['WAKE', 'REM', 'N1', 'N2', 'N3'];

/** Ground truth for one 30 s epoch: `t` is epoch **seconds** on the 30 s grid (UTC). */
export interface StageSample {
  t: number;
  stage: SleepStage;
}

/** `p` = probability that this epoch is REM, 0..1 (DESIGN §5.2). Same grid as `StageSample`. */
export interface PRemSample {
  t: number;
  p: number;
}

/** Is this stage asleep? `WAKE` is the only awake stage. */
export function isAsleep(stage: SleepStage): boolean {
  return stage !== 'WAKE';
}

// ---------------------------------------------------------------------------
// Night parameters (DESIGN §5.3 · §7 `NightSession.params`)
// ---------------------------------------------------------------------------

/**
 * `CUE` = a real night, audio is played.
 * `CONTROL` = the engine runs identically and records every `CueEvent` it *would*
 * have fired, but `played` stays `false` and the player is never called
 * (DESIGN §5.1 "คืนควบคุม"). This is what makes "does the whisper work?" answerable.
 */
export type NightMode = 'CUE' | 'CONTROL';

/** The kind of sound a cue is made of — the bandit in L3.x picks between these. */
export type CueType = 'WHISPER' | 'SPOKEN' | 'TONE_PHRASE' | 'AMBIENCE_UP';

/**
 * Hard volume rails (DESIGN §5.3). Hard-coded on purpose: a corrupt profile, a
 * bad migration or a fat-fingered setting must never be able to play a cue loud
 * enough to wake the sleeper. The engine owns volume after the first night.
 */
export const VOLUME_MIN = 0.08;
export const VOLUME_MAX = 0.35;

/**
 * Gate rails of the cue controller (DESIGN §5.3 "จังหวะ"). They live here, next to the
 * volume rails, because both `cueGate.ts` and {@link DEFAULT_NIGHT_PARAMS} must read the
 * *same* number — a gate that is stricter than the params (or the other way round)
 * would be invisible until someone counted whispers in a report.
 */

/** No cue unless the sleeper has been still for this long, in seconds. */
export const CUE_MOTION_QUIET_SEC = 120;
/** Minimum seconds between two cues (5 minutes = the COOLDOWN state). */
export const CUE_SPACING_SEC = 300;
/** Cap for the whole night. */
export const MAX_CUES_PER_NIGHT = 8;
/** Cap inside one REM bout. */
export const MAX_CUES_PER_REM = 3;

// ---------------------------------------------------------------------------
// Night state machine (DESIGN §5.1)
// ---------------------------------------------------------------------------

/**
 * The state the night is in. The audio player may only make a cue sound in `CUE`
 * (§0.5 S7), and `cueGate()` only ever says yes in `REM_LIKELY` — everything else,
 * including the two "quiet" states `GUARD` and `COOLDOWN`, is a refusal.
 */
export type NightState =
  | 'IDLE'
  | 'PRE_SLEEP'
  | 'FALLING_ASLEEP'
  | 'GUARD'
  | 'WATCHING'
  | 'REM_LIKELY'
  | 'CUE'
  | 'COOLDOWN'
  | 'AWAKE'
  | 'MORNING'
  | 'ENDED';

/** All states, in the order of the diagram in DESIGN §5.1. */
export const NIGHT_STATES: readonly NightState[] = [
  'IDLE',
  'PRE_SLEEP',
  'FALLING_ASLEEP',
  'GUARD',
  'WATCHING',
  'REM_LIKELY',
  'CUE',
  'COOLDOWN',
  'AWAKE',
  'MORNING',
  'ENDED',
];

/** Everything one night's engine needs to know before it starts. */
export interface NightParams {
  /** Hours after sleep onset during which cues are forbidden (DESIGN §5.3, default 3). */
  guardHours: number;
  /** `p_REM` at or above this counts as REM-likely (default 0.70; 0.75 with no watch). */
  remThreshold: number;
  /** Delay between REM_LIKELY and the cue, in seconds (default 60, tunable 30–180). */
  cueDelaySec: number;
  /** Minimum minutes between two cues — the COOLDOWN (default 5). */
  cueSpacingMin: number;
  /** Cap for the whole night (default 8; 4 in timer mode). */
  maxCuesPerNight: number;
  /** Cap inside one REM bout (default 3). */
  maxCuesPerRem: number;
  /** Volume of the first cue of the night, 0..1 — clamped into [volumeMin, volumeMax]. */
  volumeStart: number;
  /** Lower rail, always {@link VOLUME_MIN}. Present so reports can show the rails. */
  volumeMin: number;
  /** Upper rail, always {@link VOLUME_MAX}. */
  volumeMax: number;
  mode: NightMode;
}

/** Defaults straight from DESIGN §5.1/§5.3 — "sleep first" bias (APP-RUN §0.2 rule 9). */
export const DEFAULT_NIGHT_PARAMS: NightParams = {
  guardHours: 3,
  remThreshold: 0.7,
  cueDelaySec: 60,
  cueSpacingMin: CUE_SPACING_SEC / 60,
  maxCuesPerNight: MAX_CUES_PER_NIGHT,
  maxCuesPerRem: MAX_CUES_PER_REM,
  volumeStart: 0.15,
  volumeMin: VOLUME_MIN,
  volumeMax: VOLUME_MAX,
  mode: 'CUE',
};

/**
 * Fill in missing fields and clamp the dangerous ones. Never trust stored params:
 * `volumeStart` is forced back inside the rails and every count is forced to a
 * sane non-negative integer, so a corrupt row degrades into a quiet night, not a
 * loud one.
 */
export function resolveNightParams(partial?: Partial<NightParams>): NightParams {
  const merged = { ...DEFAULT_NIGHT_PARAMS, ...(partial ?? {}) };
  const clamp = (v: number, lo: number, hi: number): number =>
    !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v;
  return {
    guardHours: clamp(merged.guardHours, 0, 12),
    remThreshold: clamp(merged.remThreshold, 0.5, 0.99),
    cueDelaySec: Math.round(clamp(merged.cueDelaySec, 0, 600)),
    cueSpacingMin: clamp(merged.cueSpacingMin, 1, 120),
    maxCuesPerNight: Math.round(clamp(merged.maxCuesPerNight, 0, 20)),
    maxCuesPerRem: Math.round(clamp(merged.maxCuesPerRem, 0, 10)),
    volumeStart: clamp(merged.volumeStart, VOLUME_MIN, VOLUME_MAX),
    volumeMin: VOLUME_MIN,
    volumeMax: VOLUME_MAX,
    mode: merged.mode === 'CONTROL' ? 'CONTROL' : 'CUE',
  };
}

// ---------------------------------------------------------------------------
// Events the night produces (DESIGN §7 `CueEvent` / `WakeEvent`)
// ---------------------------------------------------------------------------

/** What the sleeper did about a cue — from the wake detector + the morning question. */
export type CueResponse = 'WOKE' | 'NONE' | 'HEARD_IN_DREAM' | 'LUCID';

/** One whisper (or one whisper that was deliberately withheld on a control night). */
export interface CueEvent {
  /** Epoch seconds on the 30 s grid, same clock as `SensorEpoch.t`. */
  t: number;
  /** 1-based index within the night. */
  index: number;
  /** Absolute volume actually used, 0..1 (inside the rails). */
  volume: number;
  type: CueType;
  /** `p_REM` at the moment the cue fired. */
  pRemAtCue: number;
  /** `false` on a control night: recorded but never played (DESIGN §5.1). */
  played: boolean;
  /** Filled in later — `null` until the wake detector or the morning form answers. */
  response: CueResponse | null;
}

/** Why the engine believes the sleeper woke up (DESIGN §5.4). */
export type WakeCause = 'MOTION' | 'HR' | 'USER';

export interface WakeEvent {
  t: number;
  durationSec: number;
  cause: WakeCause;
  /** `true` when this wake started within 3 minutes of a cue — i.e. the sound woke them. */
  cueWoke: boolean;
}

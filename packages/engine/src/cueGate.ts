/**
 * `cueGate.ts` — the engine-side gate in front of every whisper (DESIGN-APP §5.1 · §5.3 · §0.5 S7).
 *
 * "Sleep first" (DESIGN §2 rule 1) means every feature that could wake the user needs
 * a gate, and the gate must be a **pure function**: one call, one verdict, one reason
 * code, no hidden state, no clock of its own. The cue controller (L2.6) and the audio
 * player (L1.7) both call it, so there are two independent layers that can say no and
 * zero places where a "yes" can be assumed.
 *
 * Order of the checks matters and is fixed (oracle C1–C7): the first rule that fails
 * is the reason reported, which is what shows up in the night report as "why it stayed
 * quiet". Cheapest and most structural first:
 *
 *   1. `STATE`    — anything other than `REM_LIKELY`. Includes `CUE` and `COOLDOWN`:
 *                   a second yes during a cue would stack two whispers.
 *   2. `CONTROL`  — a control night: the engine decides exactly as usual and the event
 *                   is recorded with `played: false`, but nothing is ever played
 *                   (DESIGN §5.1 "คืนควบคุม" — this is what makes the effect measurable).
 *   3. `GUARD`    — Sleep Guard has not expired (first 3 h after onset, or the short
 *                   20 min guard after repeated wakes).
 *   4. `MOTION`   — the sleeper moved within the last {@link CUE_MOTION_QUIET_SEC} s:
 *                   they are probably surfacing, and a whisper now wakes them.
 *   5. `HR_SPIKE` — heart rate jumped: same story, possibly a nightmare or a noise.
 *   6. `MAX_NIGHT`/`MAX_REM` — the caps.
 *   7. `SPACING`  — less than {@link CUE_SPACING_SEC} s since the last cue.
 *
 * `nowT`/`guardUntilT` are plain numbers on the caller's clock (epoch seconds on the
 * 30 s grid, same as `SensorEpoch.t`) — the engine never reads a wall clock (`clock.ts`).
 */

import {
  CUE_MOTION_QUIET_SEC,
  CUE_SPACING_SEC,
  MAX_CUES_PER_NIGHT,
  MAX_CUES_PER_REM,
  type NightMode,
  type NightState,
} from './types';

export { CUE_MOTION_QUIET_SEC, CUE_SPACING_SEC, MAX_CUES_PER_NIGHT, MAX_CUES_PER_REM };

/** Why the gate said no. Codes, not sentences — the report screen translates them. */
export type CueGateReason =
  | 'STATE'
  | 'CONTROL'
  | 'GUARD'
  | 'MOTION'
  | 'HR_SPIKE'
  | 'MAX_NIGHT'
  | 'MAX_REM'
  | 'SPACING';

export interface CueGateContext {
  /** Seconds since the last movement above the motion threshold. Big = lying still. */
  motionRecentSec: number;
  /** The wake detector saw a heart-rate jump (§5.4). */
  hrSpike: boolean;
  cuesThisNight: number;
  /** Cues already fired inside the current REM bout. */
  cuesThisRem: number;
  /** Seconds since the previous cue (use `Infinity` for "none yet"). */
  sinceLastCueSec: number;
  /** Sleep Guard end, on the same clock as `nowT`. */
  guardUntilT: number;
  nowT: number;
  mode: NightMode;
}

export interface CueGateVerdict {
  allowed: boolean;
  reason: CueGateReason | null;
}

const DENY = (reason: CueGateReason): CueGateVerdict => ({ allowed: false, reason });

/**
 * Read a number the sensors provided. Only `NaN`/non-numbers fall back — `Infinity`
 * is a legitimate value here ("never moved", "no cue yet") and must pass through.
 */
function num(value: number, fallbackWhenUnreadable: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallbackWhenUnreadable;
}

/**
 * May a cue be played right now?
 *
 * Missing/NaN numbers are treated as "not safe": an unreadable sensor must never be
 * able to unlock a whisper (that is the difference between a gate and a hint).
 */
export function cueGate(state: NightState, ctx: CueGateContext): CueGateVerdict {
  if (state !== 'REM_LIKELY') return DENY('STATE');
  if (ctx.mode !== 'CUE') return DENY('CONTROL');

  // Unreadable clock → assume the guard is still running.
  if (num(ctx.nowT, Number.NEGATIVE_INFINITY) < num(ctx.guardUntilT, Number.POSITIVE_INFINITY)) {
    return DENY('GUARD');
  }

  // Unreadable motion → assume they just moved.
  if (num(ctx.motionRecentSec, 0) < CUE_MOTION_QUIET_SEC) return DENY('MOTION');

  if (ctx.hrSpike === true) return DENY('HR_SPIKE');

  // Unreadable counters → assume the caps are already reached.
  if (num(ctx.cuesThisNight, MAX_CUES_PER_NIGHT) >= MAX_CUES_PER_NIGHT) return DENY('MAX_NIGHT');
  if (num(ctx.cuesThisRem, MAX_CUES_PER_REM) >= MAX_CUES_PER_REM) return DENY('MAX_REM');

  // Unreadable spacing → assume a cue just happened.
  if (num(ctx.sinceLastCueSec, 0) < CUE_SPACING_SEC) return DENY('SPACING');

  return { allowed: true, reason: null };
}

/**
 * `memorization.ts` — the ear test (DESIGN-APP §3.2 step 3, decision 24 ก.ย. round 13).
 *
 * Before a night can start the user has to hear their own watermark **in each ear
 * separately**: the app plays the signature 2–5 times in one channel only, with a
 * 1–3 s gap, and asks "how many times did you hear it?". A correct answer is proof
 * of three different things at once:
 *
 *   * that side of the headphones actually works and is actually in the ear,
 *   * the volume is audible (the number the user lands on becomes `volumeStart`),
 *   * the user has heard the cue consciously at least once tonight — which is the
 *     training half of the method, not just a hardware check.
 *
 * Why random and re-randomised on a wrong answer: a fixed count could be guessed,
 * and a user who guesses passes the screen without ever hearing anything. A wrong
 * answer therefore redraws the count (and the gaps) and replays — so the only way
 * through is to listen. One correct answer per side is enough (DESIGN §3.2); the
 * earlier "2 in a row" idea from APP-RUN §2 was relaxed by the 24 ก.ย. decision
 * because it made the pre-sleep flow too long.
 *
 * Pure and injectable: `rng` is passed in, so an oracle can replay any test.
 * The engine never touches the audio — it returns `{rounds, gapsMs, pan}` and the
 * app plays exactly that.
 */

import { clampAnchorVolume } from './signature';

/** Which ear this page is testing. Left first, then right (DESIGN §3.2). */
export type EarSide = 'L' | 'R';

/** `IDLE` → `PLAYING` (beeps going out) → `ASKING` (chips 1–5 on screen) → `PASSED`. */
export type MemorizationState = 'IDLE' | 'PLAYING' | 'ASKING' | 'PASSED';

/** Stored per night, two rows (DESIGN §7 table `EarTest`). Seed data for spatial cues later. */
export interface EarTest {
  side: EarSide;
  rounds: number;
  answer: number;
  attempts: number;
  volume: number;
}

/** What the app needs in order to play one round-trip of the test. */
export interface MemorizationPlan {
  /** How many times to play the signature, 2–5. */
  rounds: number;
  /** Silence between plays, `rounds - 1` values, each 1000–3000 ms. */
  gapsMs: number[];
  /** Hard pan: -1 = left channel only, +1 = right channel only. */
  pan: -1 | 1;
}

export interface MemorizationAnswer {
  correct: boolean;
  state: MemorizationState;
  /** The new (redrawn) count when the answer was wrong; the passed count when it was right. */
  rounds: number;
  /** The new gaps when the answer was wrong. */
  gapsMs: number[];
}

export interface MemorizationTest {
  readonly side: EarSide;
  readonly volume: number;
  readonly state: MemorizationState;
  /** Current count — changes on every wrong answer. */
  readonly rounds: number;
  readonly gapsMs: number[];
  /** How many times the user has answered (right or wrong). */
  readonly attempts: number;
  /** Draw the plan and hand it to the player. Safe to call again to replay. */
  start(): MemorizationPlan;
  /**
   * The app calls this when the last round has finished playing, so the screen can
   * show the chips. Purely cosmetic for the engine: {@link MemorizationTest.answer}
   * accepts an answer during `PLAYING` too (a user who counts early is not wrong).
   */
  ask(): MemorizationState;
  /** Called with the chip the user tapped, 1–5. Throws on anything else. */
  answer(count: number): MemorizationAnswer;
  /** The row to store. Throws until the side has passed. */
  result(): EarTest;
}

export interface MemorizationOptions {
  side: EarSide;
  /** Uniform [0,1) source — inject `mulberry32(seed).next` in tests. */
  rng: () => number;
  /** Volume the signature is played at; clamped into the anchor rails. */
  volume: number;
}

/** Inclusive bounds of the round count (DESIGN §3.2 · oracle M1). */
export const MEMORIZATION_ROUNDS_MIN = 2;
export const MEMORIZATION_ROUNDS_MAX = 5;
/** Inclusive bounds of the gap between plays, ms. */
export const MEMORIZATION_GAP_MIN_MS = 1000;
export const MEMORIZATION_GAP_MAX_MS = 3000;
/** The chips the UI shows — the answer must be one of these. */
export const MEMORIZATION_ANSWER_MIN = 1;
export const MEMORIZATION_ANSWER_MAX = 5;

function uniform01(rng: () => number): number {
  const value = rng();
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  // Defensive: a foreign rng may hand back 1 (or worse). Fold it back into [0,1).
  if (value < 0) return 0;
  if (value >= 1) return 0.999999;
  return value;
}

function drawRounds(rng: () => number): number {
  const span = MEMORIZATION_ROUNDS_MAX - MEMORIZATION_ROUNDS_MIN + 1;
  return MEMORIZATION_ROUNDS_MIN + Math.floor(uniform01(rng) * span);
}

function drawGaps(rng: () => number, rounds: number): number[] {
  const gaps: number[] = [];
  const span = MEMORIZATION_GAP_MAX_MS - MEMORIZATION_GAP_MIN_MS;
  for (let i = 0; i < rounds - 1; i += 1) {
    gaps.push(MEMORIZATION_GAP_MIN_MS + Math.round(uniform01(rng) * span));
  }
  return gaps;
}

/**
 * Create the state machine for one ear.
 *
 * `pan` is derived from `side` and never from a setting: if the two pages could
 * ever play the same channel the test would prove nothing.
 */
export function createMemorizationTest(options: MemorizationOptions): MemorizationTest {
  const side: EarSide = options.side === 'R' ? 'R' : 'L';
  const rng = options.rng;
  const volume = clampAnchorVolume(options.volume);
  const pan: -1 | 1 = side === 'R' ? 1 : -1;

  let state: MemorizationState = 'IDLE';
  let rounds = 0;
  let gapsMs: number[] = [];
  let attempts = 0;
  let passedAnswer = 0;

  const redraw = (avoid: number | null): void => {
    let next = drawRounds(rng);
    // One retry when the redraw repeats the previous count: a repeat is legitimate
    // (it must stay uniform, oracle M2) but repeating *often* would let a user brute
    // force the screen by tapping the same chip twice (oracle M6 keeps us honest).
    if (avoid !== null && next === avoid) next = drawRounds(rng);
    rounds = next;
    gapsMs = drawGaps(rng, rounds);
  };

  const test: MemorizationTest = {
    side,
    volume,
    get state() {
      return state;
    },
    get rounds() {
      return rounds;
    },
    get gapsMs() {
      return [...gapsMs];
    },
    get attempts() {
      return attempts;
    },

    start(): MemorizationPlan {
      if (state === 'PASSED') throw new Error('memorization: this side already passed');
      redraw(null);
      state = 'PLAYING';
      return { rounds, gapsMs: [...gapsMs], pan };
    },

    ask(): MemorizationState {
      if (state === 'PLAYING') state = 'ASKING';
      return state;
    },

    answer(count: number): MemorizationAnswer {
      if (state === 'IDLE') throw new Error('memorization: call start() before answer()');
      if (state === 'PASSED') throw new Error('memorization: this side already passed');
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < MEMORIZATION_ANSWER_MIN ||
        count > MEMORIZATION_ANSWER_MAX
      ) {
        throw new Error(
          `memorization: answer must be an integer ${MEMORIZATION_ANSWER_MIN}–${MEMORIZATION_ANSWER_MAX}, got ${String(count)}`,
        );
      }

      attempts += 1;

      if (count === rounds) {
        passedAnswer = count;
        state = 'PASSED';
        return { correct: true, state, rounds, gapsMs: [...gapsMs] };
      }

      // Wrong → new count, new gaps, play that ear again.
      redraw(rounds);
      state = 'PLAYING';
      return { correct: false, state, rounds, gapsMs: [...gapsMs] };
    },

    result(): EarTest {
      if (state !== 'PASSED') throw new Error('memorization: result() is only available after PASSED');
      return { side, rounds, answer: passedAnswer, attempts, volume };
    },
  };

  return test;
}

/** Both sides done? The "เริ่มคืนนี้" button only appears when this is true (DESIGN §3.2). */
export function earTestsComplete(tests: { L?: EarTest | null; R?: EarTest | null }): boolean {
  return Boolean(tests.L) && Boolean(tests.R);
}

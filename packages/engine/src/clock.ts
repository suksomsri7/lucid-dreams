/**
 * Clock injection (APP-RUN §0.2 rule 6: oracles must never depend on wall-clock time).
 *
 * Every engine function that needs "now" takes a `Clock`, never `Date.now()` directly.
 * Tests use `fixedClock` / `stepClock` so a night can be replayed deterministically.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch (UTC). */
  now(): number;
  /** ISO-8601 string in UTC, e.g. `2026-09-24T21:30:00.000Z`. */
  nowIso(): string;
}

/** Real time. The only place in the engine allowed to read `Date.now()`. */
export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date(Date.now()).toISOString(),
};

/** A clock frozen at one instant. `at` accepts epoch ms or an ISO string. */
export function fixedClock(at: number | string): Clock {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (Number.isNaN(ms)) throw new Error(`fixedClock: cannot parse time "${String(at)}"`);
  return {
    now: () => ms,
    nowIso: () => new Date(ms).toISOString(),
  };
}

/**
 * A clock that advances by `stepMs` on every read — handy for driving a whole
 * synthetic night (30 s epochs) without any timers.
 */
export function stepClock(start: number | string, stepMs: number): Clock & { advance(ms: number): void } {
  let ms = typeof start === 'number' ? start : Date.parse(start);
  if (Number.isNaN(ms)) throw new Error(`stepClock: cannot parse time "${String(start)}"`);
  const read = (): number => {
    const value = ms;
    ms += stepMs;
    return value;
  };
  return {
    now: read,
    nowIso: () => new Date(read()).toISOString(),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

/** Length of one sensor epoch in seconds (DESIGN §5.2). */
export const EPOCH_SECONDS = 30;

/** Floor a timestamp onto the 30 s epoch grid (UTC), returned in epoch seconds. */
export function epochIndexOf(ms: number, epochSeconds: number = EPOCH_SECONDS): number {
  return Math.floor(ms / 1000 / epochSeconds) * epochSeconds;
}

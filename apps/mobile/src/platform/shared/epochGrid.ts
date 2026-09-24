/**
 * One timer helper, shared by everything that has to act "once per 30 s epoch" (WO L2.3).
 *
 * Why a helper instead of `setInterval(fn, 30_000)` in three places: the engine's epoch grid is
 * absolute (`epochIndexOf` floors wall-clock time onto multiples of 30 s), so a plain interval
 * started at an arbitrary moment drifts across a boundary and will eventually close the *same*
 * grid slot twice — once with a full epoch of data and once empty. Aligning to the grid once,
 * then running every 30 s, keeps every tick inside its own slot.
 *
 * `lagMs` exists for the collector: a source that summarises a whole epoch (the phone on the
 * mattress) can only emit its reading *at* the boundary, so whoever closes the epoch has to wait
 * a moment past the boundary or it would close the window just before the last reading arrives.
 * Two seconds is far longer than any of these sources needs and far shorter than the 30 s slot.
 *
 * Note both this and the sources it drives depend on JS timers still running while the phone is
 * asleep. They do, for the only case that matters: the night keeps an audio session playing all
 * night (`UIBackgroundModes: ['audio']`), which is what keeps the JS runtime alive in the
 * background — see `ledger/wo-notes/L2.3.md`.
 */

import { EPOCH_SECONDS } from '@lucid/engine';

export type CancelGridTimer = () => void;

/**
 * Call `run` at every 30 s grid boundary (+ `lagMs`), starting with the next one.
 * Returns the canceller; safe to call twice.
 */
export function runOnEpochGrid(run: () => void, lagMs = 0): CancelGridTimer {
  const periodMs = EPOCH_SECONDS * 1000;
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const msIntoSlot = Date.now() % periodMs;
  const firstDelay = periodMs - msIntoSlot + lagMs;

  timeout = setTimeout(() => {
    timeout = null;
    run();
    interval = setInterval(run, periodMs);
  }, firstDelay);

  return () => {
    if (timeout !== null) clearTimeout(timeout);
    if (interval !== null) clearInterval(interval);
    timeout = null;
    interval = null;
  };
}

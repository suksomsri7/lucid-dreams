/**
 * Seeded pseudo-random numbers — the only source of randomness the engine may use.
 *
 * Why not `Math.random()`: every oracle in this RUN replays a night from a seed
 * (APP-RUN §0.2 rule 6 — no hidden state, no wall clock). One seed must always
 * produce the same night, byte for byte, on any machine and any Node version.
 *
 * Algorithm: **mulberry32** — 32-bit state, one multiply-xorshift round per draw.
 * It is not cryptographic (never use it for secrets) but it is fast, has a period
 * of 2^32 and passes the small-crush statistical suite, which is far more than a
 * hypnogram generator needs. All arithmetic stays inside `Math.imul`/`>>>` so the
 * result is exact integer maths, identical on every JS engine.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  /** `true` with probability `p`. */
  bool(p: number): boolean;
  /** Normal (Gaussian) draw — Box–Muller. */
  normal(mean?: number, sd?: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates copy — does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * Create a deterministic generator. Any finite number is accepted as a seed;
 * it is folded into a 32-bit state so `seed` and `seed + 2^32` do not collide in
 * practice for the small integers the CLI uses.
 */
export function mulberry32(seed: number): Rng {
  if (!Number.isFinite(seed)) throw new Error(`mulberry32: seed must be finite, got ${String(seed)}`);
  // `>>> 0` makes the state an unsigned 32-bit int; the golden-ratio constant
  // spreads neighbouring seeds (1, 2, 3 …) far apart so seed 1 and seed 2 give
  // completely different nights (oracle E2).
  let state = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi < lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    bool: (p) => next() < p,
    normal: (mean = 0, sd = 1) => {
      // Box–Muller. `u` must never be exactly 0 or `log(0)` = -Infinity.
      const u = next() || Number.EPSILON;
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[rng.int(0, items.length - 1)] as T;
    },
    shuffle: <T,>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        const a = copy[i] as T;
        copy[i] = copy[j] as T;
        copy[j] = a;
      }
      return copy;
    },
  };

  return rng;
}

/** Clamp a number into `[min, max]`. Used everywhere a signal must stay schema-valid. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** Round to `digits` decimals — keeps simulated JSON small and diff-friendly. */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

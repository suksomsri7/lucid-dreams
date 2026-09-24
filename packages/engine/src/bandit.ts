/**
 * `bandit.ts` — the learning loop of DESIGN §5.5 (WO L3.4).
 *
 * The app has three knobs it may turn between nights — how loud the whisper is, how
 * long after the dream starts it fires, and what kind of sound it is — and exactly one
 * measurement per night to learn from. That is 27 combinations and ~1 data point a day:
 * a sleeper who tried every combination twice would need two months. So the loop is a
 * **bandit**, not a grid search: it spends most nights on what already looks best and
 * still keeps testing, and it starts from what worked for other people (prior from the
 * population) instead of from nothing.
 *
 * What lives here:
 *   * {@link ARMS} / {@link armKey} — the 27 combinations and their stable ids;
 *   * {@link nightReward} — the one number a night is worth (§5.5 formula, unchanged);
 *   * {@link createBandit} — Beta posteriors per combination + Thompson sampling,
 *     driven entirely by an injected seeded generator so a night can be replayed;
 *   * {@link personalModelFromBandit} — the saved `PersonalModel` of DESIGN §7;
 *   * {@link explainLearning} — the same thing in words a person can argue with.
 *
 * Two rules that are easy to lose and expensive to lose:
 *   * **a control night never updates anything** (§5.5): nothing was played, so the
 *     night says nothing about the sound. The controller simply does not call
 *     {@link BanditHandle.update} — there is no "control" flag in here to get wrong.
 *   * **nothing here may raise the volume ceiling.** {@link personalModelFromBandit}
 *     clamps to {@link VOLUME_MAX} (35 %), the hard rail of §0.5 S6, and the arms
 *     themselves stop at 24 %.
 */

import { type MessageLang } from './aiScore';
import { clamp, round } from './rng';
import { VOLUME_MAX, VOLUME_MIN } from './types';

// ---------------------------------------------------------------------------
// The arm space
// ---------------------------------------------------------------------------

/** The three volumes the loop may try, all well inside the 8–35 % rails (§5.3). */
export const ARM_VOLUMES = [0.12, 0.18, 0.24] as const;
/** Seconds between "this looks like a dream" and the whisper (§5.3 rails 30–180 s). */
export const ARM_DELAYS_SEC = [60, 120, 180] as const;
/**
 * The three sound shapes L1.6 can produce. `AMBIENCE_SWELL` is the bed rising slowly
 * under the phrase; the audio layer's `CueType` calls the same thing `AMBIENCE_UP`
 * (see {@link playerCueType} — the names are bridged in one place on purpose).
 */
export const ARM_CUE_TYPES = ['WHISPER', 'TONE_PHRASE', 'AMBIENCE_SWELL'] as const;

export type ArmVolume = (typeof ARM_VOLUMES)[number];
export type ArmDelaySec = (typeof ARM_DELAYS_SEC)[number];
export type ArmCueType = (typeof ARM_CUE_TYPES)[number];

/** One thing the app can do tonight. */
export interface Arm {
  volume: ArmVolume;
  delaySec: ArmDelaySec;
  cueType: ArmCueType;
}

function buildArms(): Arm[] {
  const arms: Arm[] = [];
  for (const volume of ARM_VOLUMES) {
    for (const delaySec of ARM_DELAYS_SEC) {
      for (const cueType of ARM_CUE_TYPES) arms.push({ volume, delaySec, cueType });
    }
  }
  return arms;
}

/** All 27 combinations, in a fixed order — the order is part of the saved model. */
export const ARMS: readonly Arm[] = Object.freeze(buildArms());

/**
 * Stable id. It is a *readable* key on purpose: it ends up in `PersonalModel` on the
 * phone and in support logs, and `v0.18/d120/WHISPER` can be understood a year later
 * without the code, while an index could silently change meaning if the arm list grows.
 */
export function armKey(arm: Arm): string {
  return `v${arm.volume}/d${arm.delaySec}/${arm.cueType}`;
}

/** The arm with this id, or `null`. */
export function armFromKey(key: string): Arm | null {
  return ARMS.find((arm) => armKey(arm) === key) ?? null;
}

/** Bridge to the audio layer's vocabulary (`types.ts` `CueType`). */
export function playerCueType(arm: Arm): 'WHISPER' | 'TONE_PHRASE' | 'AMBIENCE_UP' {
  return arm.cueType === 'AMBIENCE_SWELL' ? 'AMBIENCE_UP' : arm.cueType;
}

// ---------------------------------------------------------------------------
// Reward
// ---------------------------------------------------------------------------

export interface NightRewardInput {
  lucid: 'YES' | 'NO' | 'UNSURE' | null;
  /** 0–10, the theme match used for learning. `null` when nobody scored the night. */
  themeMatch: number | null;
  /** `true` when a whisper woke the sleeper. */
  cueWoke: boolean;
  /** 0–10 self-reported sleep quality. `null` when the morning form was skipped. */
  sleepQuality: number | null;
}

/** Lucid = the point of the app, so it carries most of the weight. */
export const REWARD_LUCID_YES = 1;
/** "ไม่แน่ใจ" is real evidence — a sleeper who half-remembers noticing is not a `NO`. */
export const REWARD_LUCID_UNSURE = 0.3;
/** Theme match is a consolation prize: the dream went the right way even without lucidity. */
export const REWARD_THEME_WEIGHT = 0.3;
/** Waking somebody up is a failure even when they became lucid — hence the size of it. */
export const REWARD_WOKE_PENALTY = 0.5;
/** A night that felt bad must cost the loop something, or it would learn to be loud. */
export const REWARD_POOR_SLEEP_PENALTY = 0.3;
/** Below this self-reported score the night counts as poor sleep (§5.5). */
export const POOR_SLEEP_BELOW = 5;

/**
 * DESIGN §5.5, literally:
 * `lucid (YES 1 · UNSURE 0.3) + 0.3 × themeMatch/10 − 0.5 × woke − 0.3 × (sleep < 5)`
 *
 * The result is **not** clamped here: −0.8 … 1.3 is meaningful when a night is compared
 * with another night, and the Beta update clamps to 0…1 at the point where it has to.
 * Missing answers score 0 rather than being guessed — an unanswered morning must never
 * look like a good night.
 */
export function nightReward(input: NightRewardInput): number {
  const lucid = input.lucid === 'YES' ? REWARD_LUCID_YES : input.lucid === 'UNSURE' ? REWARD_LUCID_UNSURE : 0;
  const theme =
    input.themeMatch != null && Number.isFinite(input.themeMatch)
      ? (REWARD_THEME_WEIGHT * clamp(input.themeMatch, 0, 10)) / 10
      : 0;
  const woke = input.cueWoke ? REWARD_WOKE_PENALTY : 0;
  const poorSleep =
    input.sleepQuality != null && Number.isFinite(input.sleepQuality) && input.sleepQuality < POOR_SLEEP_BELOW
      ? REWARD_POOR_SLEEP_PENALTY
      : 0;
  return round(lucid + theme - woke - poorSleep, 6);
}

// ---------------------------------------------------------------------------
// Randomness: uniforms in, Beta samples out
// ---------------------------------------------------------------------------

/**
 * Anything that yields uniforms in [0, 1): either a bare function or the engine's
 * {@link Rng} object. Both are accepted because both are used in the codebase, and a
 * bandit that silently fell back to `Math.random` would destroy replay (§0.2 rule 6).
 */
export type UniformSource = (() => number) | { next(): number };

function toUniform(source: UniformSource | undefined): () => number {
  if (typeof source === 'function') return source;
  if (source != null && typeof source.next === 'function') return () => source.next();
  throw new Error('createBandit: rng is required (a seeded generator, never Math.random)');
}

/** Open interval (0, 1) — `log(0)` and `x ** (1/shape)` at 0 both ruin a night. */
function open01(u: () => number): number {
  const x = u();
  if (!Number.isFinite(x) || x <= 0) return Number.EPSILON;
  if (x >= 1) return 1 - Number.EPSILON;
  return x;
}

/** Box–Muller, built from the injected uniforms so the whole draw stays replayable. */
function normal(u: () => number): number {
  const a = open01(u);
  const b = open01(u);
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

/**
 * Gamma(shape, 1) — Marsaglia–Tsang (2000).
 *
 * Why a gamma sampler at all: a Beta draw is `X / (X + Y)` with `X ~ Γ(a)`,
 * `Y ~ Γ(b)`, and there is no closed-form inverse Beta CDF to use instead. Shapes
 * below 1 go through the standard boost `Γ(a) = Γ(a+1) · U^(1/a)`.
 */
function gamma(shape: number, u: () => number): number {
  if (!Number.isFinite(shape) || shape <= 0) return 0;
  if (shape < 1) return gamma(shape + 1, u) * open01(u) ** (1 / shape);

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // The acceptance rate is > 95 % for every shape ≥ 1; the cap only exists so a
  // pathological generator can never hang the night loop.
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const x = normal(u);
    const v = 1 + c * x;
    if (v <= 0) continue;
    const v3 = v * v * v;
    const uu = open01(u);
    if (uu < 1 - 0.0331 * x * x * x * x) return d * v3;
    if (Math.log(uu) < 0.5 * x * x + d * (1 - v3 + Math.log(v3))) return d * v3;
  }
  return d;
}

function betaSample(a: number, b: number, u: () => number): number {
  const x = gamma(a, u);
  const y = gamma(b, u);
  if (x + y <= 0) return 0.5;
  return x / (x + y);
}

// ---------------------------------------------------------------------------
// The bandit
// ---------------------------------------------------------------------------

export interface BetaPosterior {
  a: number;
  b: number;
}

/**
 * How much the posteriors are sharpened before a sample is drawn (`Beta(a·k, b·k)`).
 *
 * This is the one place the textbook is wrong for this product. With 27 arms and a
 * flat `Beta(1,1)`, the *maximum* of 26 unexplored draws sits at 26/27 ≈ 0.96 every
 * single night, so a population prior as strong as `Beta(30,3)` (mean 0.91) wins the
 * first night only `B(56,3)/B(30,3) = 16 %` of the time: pure Thompson sampling throws
 * the population away and explores at random for weeks. Sharpening by 3 shrinks the
 * spread of an *uninformative* arm without moving its mean, so night 1 follows what
 * worked for other people (≈ 80 % in the same calculation) while the loop still
 * explores enough to find a better arm over hundreds of nights (oracle B3 · B6).
 *
 * It is a deliberate bias toward the prior, and it is only defensible because the
 * prior is real data (the population) and because a wasted night here is a night of
 * somebody's sleep, not a row in a log.
 */
export const PICK_SHARPENING = 3;

export interface BanditOptions {
  /** Population prior per {@link armKey}. Arms without one start at `Beta(1,1)`. */
  prior?: Record<string, BetaPosterior>;
  /** Seeded uniforms — required. */
  rng: UniformSource;
}

export interface BanditHandle {
  /** Choose tonight's combination. Consumes randomness; never mutates the posteriors. */
  pick(): Arm;
  /** Fold one night's {@link nightReward} into one arm. Control nights never call this. */
  update(arm: Arm, reward01: number): void;
  /** A copy of every posterior, keyed by {@link armKey} — this is what gets saved. */
  posterior(): Record<string, BetaPosterior>;
  /** How many nights have been folded in (control nights are not among them). */
  readonly nights: number;
}

/**
 * Thompson sampling over the 27 arms.
 *
 * One night = one draw per arm from that arm's (sharpened) Beta posterior, and the
 * highest draw wins. The effect is that an arm is played about as often as the app
 * believes it is the best one — exploration and exploitation come out of the same
 * arithmetic, with no epsilon to tune and no schedule to get wrong.
 *
 * Rewards are clamped to `[0, 1]` before the update because a Beta posterior is a
 * belief about a *probability*: the raw §5.5 reward of 1.3 (lucid plus a perfect theme
 * match) is "the best kind of night", not "130 % of a success", and −0.8 is "the worst
 * kind", not negative evidence to be subtracted from a count.
 */
export function createBandit(options: BanditOptions): BanditHandle {
  const uniform = toUniform(options?.rng);
  const state = new Map<string, BetaPosterior>();

  for (const arm of ARMS) {
    const key = armKey(arm);
    const given = options.prior?.[key];
    const a = given != null && Number.isFinite(given.a) && given.a > 0 ? given.a : 1;
    const b = given != null && Number.isFinite(given.b) && given.b > 0 ? given.b : 1;
    state.set(key, { a, b });
  }

  let nights = 0;

  function pick(): Arm {
    let best: Arm = ARMS[0] as Arm;
    let bestDraw = Number.NEGATIVE_INFINITY;
    for (const arm of ARMS) {
      const post = state.get(armKey(arm)) as BetaPosterior;
      const draw = betaSample(post.a * PICK_SHARPENING, post.b * PICK_SHARPENING, uniform);
      // Strictly greater: ties go to the earlier arm, so a fresh bandit with an
      // all-equal prior is still deterministic for a given seed.
      if (draw > bestDraw) {
        bestDraw = draw;
        best = arm;
      }
    }
    return best;
  }

  function update(arm: Arm, reward01: number): void {
    const key = armKey(arm);
    const post = state.get(key);
    if (post == null) throw new Error(`bandit.update: unknown arm ${key}`);
    const reward = Number.isFinite(reward01) ? clamp(reward01, 0, 1) : 0;
    post.a += reward;
    post.b += 1 - reward;
    nights += 1;
  }

  function posterior(): Record<string, BetaPosterior> {
    const out: Record<string, BetaPosterior> = {};
    for (const [key, value] of state) out[key] = { a: value.a, b: value.b };
    return out;
  }

  return {
    pick,
    update,
    posterior,
    get nights() {
      return nights;
    },
  };
}

// ---------------------------------------------------------------------------
// PersonalModel
// ---------------------------------------------------------------------------

/** §5.5: nothing is presented as "what the app learned" before 14 nights. */
export const PERSONAL_MODEL_MIN_NIGHTS = 14;

export interface PersonalModel {
  /** The combination the app would recommend today. */
  topArm: Arm;
  /** 0–1 — how much the app would bet on that recommendation. */
  confidence: number;
  /** Hard cap on the volume any night may use, never above {@link VOLUME_MAX}. */
  volumeCeiling: number;
  /** The volume the app will actually ask for: the top arm's, under the ceiling. */
  suggestedVolume: number;
  /** Nights folded into the model (control nights excluded). */
  nights: number;
  /** `true` while §5.5's "กำลังเรียนรู้ n/14" is still the honest thing to show. */
  learning: boolean;
}

function mean(post: BetaPosterior): number {
  return post.a / (post.a + post.b);
}

function variance(post: BetaPosterior): number {
  const n = post.a + post.b;
  return (post.a * post.b) / (n * n * (n + 1));
}

/**
 * Turn the posteriors into the row DESIGN §7 stores and §4-08 shows.
 *
 * `confidence` deliberately multiplies two different kinds of doubt, because a person
 * asking "how sure are you?" means both at once:
 *   * **evidence** — nights against the 14-night bar, so 3 nights can never read as
 *     confident no matter how lucky they were;
 *   * **separation** — how far the leader is ahead of the runner-up, measured in the
 *     combined spread of the two beliefs (2 standard deviations = fully separated).
 *
 * `ceiling` is the user's own volume cap from settings; it is clamped into the engine
 * rails here rather than trusted, because it arrives from the UI (§0.5 S6).
 */
export function personalModelFromBandit(bandit: BanditHandle, ceiling?: number): PersonalModel {
  const post = bandit.posterior();
  const scored = ARMS.map((arm) => {
    const p = post[armKey(arm)] ?? { a: 1, b: 1 };
    return { arm, post: p, mean: mean(p), n: p.a + p.b };
  });
  // Leader = highest posterior mean; ties go to the better-observed arm, then to the
  // fixed ARMS order, so the model never flickers between two equal arms.
  const ranked = [...scored].sort((x, y) => (y.mean - x.mean) || (y.n - x.n));
  const top = ranked[0] as (typeof scored)[number];
  const second = (ranked[1] ?? top) as (typeof scored)[number];

  const nights = bandit.nights;
  const evidence = clamp(nights / PERSONAL_MODEL_MIN_NIGHTS, 0, 1);
  const spread = Math.sqrt(variance(top.post) + variance(second.post));
  const separation = spread > 0 ? clamp((top.mean - second.mean) / (2 * spread), 0, 1) : 0;

  const volumeCeiling = round(clamp(ceiling ?? VOLUME_MAX, VOLUME_MIN, VOLUME_MAX), 3);

  return {
    topArm: top.arm,
    confidence: round(clamp(evidence * separation, 0, 1), 3),
    volumeCeiling,
    suggestedVolume: round(clamp(Math.min(top.arm.volume, volumeCeiling), VOLUME_MIN, VOLUME_MAX), 3),
    nights,
    learning: nights < PERSONAL_MODEL_MIN_NIGHTS,
  };
}

// ---------------------------------------------------------------------------
// Saying it in words
// ---------------------------------------------------------------------------

function cueTypeWords(cueType: ArmCueType, lang: MessageLang): string {
  if (lang === 'th') {
    if (cueType === 'WHISPER') return 'เสียงกระซิบเบา ๆ';
    if (cueType === 'TONE_PHRASE') return 'เสียงโน้ตสั้นแล้วค่อยพูดประโยค';
    return 'เสียงบรรยากาศที่ดังขึ้นช้า ๆ';
  }
  if (cueType === 'WHISPER') return 'a soft whisper';
  if (cueType === 'TONE_PHRASE') return 'a short note, then the sentence';
  return 'the background sound rising slowly';
}

function minutesWords(delaySec: number, lang: MessageLang): string {
  const minutes = Math.max(1, Math.round(delaySec / 60));
  return lang === 'th' ? `${minutes} นาที` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * The learning loop, explained to the person it is learning about (§4-08).
 *
 * No jargon at all — not "Thompson", not "posterior", not the word for the thing being
 * chosen. That is not only a style rule: a sentence the sleeper cannot check is a
 * sentence they cannot disagree with, and the whole feature only works if they can say
 * "no, that night was bad because of the neighbour's dog".
 *
 * Before 14 nights the sentence leads with the count, exactly as §5.5 asks
 * ("กำลังเรียนรู้ n/14"), so a recommendation is never dressed up as a conclusion.
 */
export function explainLearning(model: PersonalModel, lang: MessageLang): string {
  const volumePercent = Math.round(model.suggestedVolume * 100);
  const sound = cueTypeWords(model.topArm.cueType, lang);
  const when = minutesWords(model.topArm.delaySec, lang);

  if (lang === 'th') {
    const sure =
      model.confidence >= 0.66
        ? 'ตอนนี้ค่อนข้างมั่นใจแล้ว'
        : model.confidence >= 0.33
          ? 'เริ่มเห็นแนวโน้มแล้ว แต่ยังขอดูอีกสองสามคืน'
          : 'ยังไม่แน่ใจ ขอเวลาอีกหน่อย';
    const head = model.learning
      ? `กำลังเรียนรู้ ${model.nights}/${PERSONAL_MODEL_MIN_NIGHTS} คืน`
      : `จาก ${model.nights} คืนที่ผ่านมา`;
    return `${head} — สิ่งที่เข้ากับคุณที่สุดคือ${sound} ที่ระดับ ${volumePercent}% เปิดหลังเริ่มฝันประมาณ ${when} · ${sure}`;
  }

  const sure =
    model.confidence >= 0.66
      ? 'I am fairly sure of that now'
      : model.confidence >= 0.33
        ? 'the pattern is showing, but give it a few more nights'
        : 'not sure yet, give it a few more nights';
  const head = model.learning
    ? `Still learning — ${model.nights} of ${PERSONAL_MODEL_MIN_NIGHTS} nights`
    : `Over your last ${model.nights} nights`;
  return `${head} — what suits you best is ${sound} at ${volumePercent}%, about ${when} after the dream starts · ${sure}`;
}

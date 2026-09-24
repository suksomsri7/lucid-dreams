/**
 * `advisor.ts` — the Dream Advisor brain: **บอก → สรุป → เริ่ม** in at most four turns.
 *
 * DESIGN §3.3 is the whole specification and it is short on purpose:
 *   1. restate what the user asked for — one line;
 *   2. say what the app will do tonight — one line;
 *   3. at most **one** clarifying question, and only as chips, and only **about the
 *      dream** (never about the voice: the anchor is a fixed watermark, §2 principle 3);
 *   4. then the plan card. No lectures, no sleep science in the chat room.
 *
 * Everything here is a pure state machine over an injected `PlanProvider` and `Clock`,
 * so the whole conversation is replayable in vitest with no network and no wall clock
 * (APP-RUN §0.2 rules 1 and 6). The app owns bubbles, chips and the microphone; this
 * file owns the *rules*.
 *
 * Three invariants that matter more than the happy path:
 *
 *   * **It never throws because the AI failed.** A provider that is offline, slow,
 *     hallucinating or actively hostile ends the same way: a valid plan built on the
 *     phone (`offlinePlanFromChip`) and `state = 'PLAN'`. The user is standing next to
 *     their bed; "try again later" is not an acceptable answer (oracle F3 · F4).
 *   * **The watermark is not negotiable.** `anchorPhrase` is overwritten with
 *     `anchorPhraseFor(lang)` on every single turn, and an edit that asks for another
 *     voice or another volume is answered with one line instead of being sent to the
 *     model at all — the engine owns the volume at night (§2 principle 3.1) and the
 *     voice is a watermark, so neither is a "preference" the AI may patch (oracle F5).
 *   * **After `start()` the conversation is closed.** A night that is already running
 *     must not have its plan rewritten underneath it (oracle F7).
 */

import { systemClock, type Clock } from './clock';
import {
  chipLabel,
  offlinePlanFromChip,
  offlinePlanFromText,
  parseDreamPlan,
  withWatermark,
  type Clarify,
  type DreamPlan,
} from './dreamPlan';
import type { AnchorLang } from './signature';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type AdvisorState = 'ASK' | 'CLARIFY' | 'PLAN' | 'EDIT' | 'STARTED';

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  text: string;
  /** `true` when the bubble came from the microphone (screen 03 shows a mic icon). */
  fromVoice?: boolean;
  /** ISO-8601, from the injected clock — never `Date.now()`. */
  at: string;
}

export interface PlanRequest {
  /** The whole conversation so far, oldest first. **Data, never instructions** (§0.5 S3). */
  messages: { role: 'user' | 'assistant'; text: string }[];
  lang: AnchorLang;
  /** The plan being edited, or the draft a clarify question belongs to. */
  prior?: DreamPlan | null;
}

/** The one thing the server does for the advisor. Returns *unknown* on purpose: never trusted. */
export interface PlanProvider {
  plan(req: PlanRequest): Promise<unknown>;
}

export interface ThemeChip {
  key: string;
  emoji?: string;
  titleTh: string;
  titleEn: string;
}

export interface AdvisorOptions {
  provider: PlanProvider;
  lang: AnchorLang;
  clock?: Clock;
  /** Chips shown on screen 02 (history + defaults). Only used to label the echo bubble. */
  themeChips?: ThemeChip[];
}

export interface AdvisorTurn {
  state: AdvisorState;
  plan?: DreamPlan | null;
  clarify?: Clarify | null;
  /** `true` when this turn was answered by the on-device fallback, not by the model. */
  offline?: boolean;
}

export interface Advisor {
  readonly state: AdvisorState;
  readonly plan: DreamPlan | null;
  readonly clarifyCount: number;
  readonly messages: AdvisorMessage[];
  say(text: string, options?: { fromVoice?: boolean }): Promise<AdvisorTurn>;
  pickChip(chipKey: string): Promise<AdvisorTurn>;
  edit(text: string): Promise<{ state: 'PLAN'; plan: DreamPlan }>;
  start(): { state: 'STARTED'; plan: DreamPlan };
}

/** How many clarifying questions one night may contain (DESIGN §3.3 · §2 principle 9). */
export const MAX_CLARIFY_PER_NIGHT = 1;

// ---------------------------------------------------------------------------
// Copy (one line each — the chat room is not a place for paragraphs)
// ---------------------------------------------------------------------------

/**
 * Why this text lives in the engine and not in `apps/mobile/src/i18n`:
 * the sentence is a *frame around model output* (`"เข้าใจแล้ว — คืนนี้อยาก" + titleTh`) and
 * the title itself only exists in the language the model answered in. Splitting the two
 * halves across two packages would guarantee they drift. The UI chrome (buttons, labels,
 * the empty-room question) stays in i18n where fitness rule B can see it.
 */
function restateLine(plan: DreamPlan, lang: AnchorLang): string {
  const title = lang === 'th' ? plan.theme.titleTh : plan.theme.titleEn;
  const place = plan.theme.place ?? '';
  if (lang === 'th') {
    return place === ''
      ? `เข้าใจแล้ว — คืนนี้อยากฝันเรื่อง ${plan.theme.emoji} ${title}`
      : `เข้าใจแล้ว — คืนนี้อยากฝันเรื่อง ${plan.theme.emoji} ${title} ที่${place}`;
  }
  return place === ''
    ? `Got it — tonight you want to dream about ${plan.theme.emoji} ${title}.`
    : `Got it — tonight you want to dream about ${plan.theme.emoji} ${title} at ${place}.`;
}

function actionLine(lang: AnchorLang): string {
  return lang === 'th'
    ? 'ผมจะปลูกภาพนี้ก่อนนอน แล้วกระซิบเสียงสมอเบา ๆ ตอนที่คุณน่าจะฝัน'
    : 'I will plant this scene before you sleep, then whisper your anchor softly when you are likely dreaming.';
}

function planReadyLine(lang: AnchorLang): string {
  return lang === 'th' ? 'เรียบร้อย นี่คือแผนคืนนี้' : 'All set — here is tonight’s plan.';
}

function planUpdatedLine(lang: AnchorLang): string {
  return lang === 'th' ? 'แก้ให้แล้ว นี่คือแผนล่าสุด' : 'Updated — here is the new plan.';
}

function couldNotUpdateLine(lang: AnchorLang): string {
  return lang === 'th'
    ? 'ตอนนี้ต่อเซิร์ฟเวอร์ไม่ได้ ผมเก็บแผนเดิมไว้ให้ก่อน — เริ่มคืนนี้ได้เลย'
    : 'I cannot reach the server right now, so I kept the previous plan — you can still start tonight.';
}

function offlineNoteLine(lang: AnchorLang): string {
  return lang === 'th'
    ? 'ตอนนี้ออฟไลน์ ผมใช้แผนสำเร็จในเครื่องให้ก่อน แก้ได้โดยพิมพ์บอก'
    : 'I am offline, so I used a built-in plan. Tell me what to change and I will patch it.';
}

function watermarkLockedLine(lang: AnchorLang): string {
  return lang === 'th'
    ? 'เสียงสมอเป็นลายน้ำของคุณ เปลี่ยนไม่ได้ (รีเซ็ตได้ในตั้งค่า) · ระดับเสียงคืนนี้แอปจะปรับเอง'
    : 'Your anchor sound is a personal watermark and cannot be changed (only reset in Settings) · the app tunes the volume itself at night.';
}

// ---------------------------------------------------------------------------
// Guards: things the model is not allowed to decide
// ---------------------------------------------------------------------------

/**
 * Words that mean "this is about the sound, not the dream".
 *
 * Used twice: to drop a `clarify` that asks the user to pick a voice (§3.3: the one
 * question must be about the dream) and to answer an edit like "เสียงผู้ชาย" / "quieter"
 * locally instead of forwarding it. A false positive is cheap — we go straight to the
 * plan, which is the behaviour §3.3 asks for anyway.
 */
const SOUND_TOPIC_WORDS = [
  'เสียงผู้ชาย',
  'เสียงผู้หญิง',
  'เสียงของฉัน',
  'เสียงสมอ',
  'ระดับเสียง',
  'ดังขึ้น',
  'ดังกว่า',
  'เบากว่า',
  'เบาลง',
  'ความดัง',
  'volume',
  'louder',
  'quieter',
  'male voice',
  'female voice',
  'my voice',
  'anchor sound',
  'anchor voice',
] as const;

function isAboutSound(text: string): boolean {
  const haystack = text.toLowerCase();
  return SOUND_TOPIC_WORDS.some((word) => haystack.includes(word.toLowerCase()));
}

function clarifyIsAllowed(clarify: Clarify): boolean {
  if (isAboutSound(clarify.question)) return false;
  return !clarify.options.some((option) => isAboutSound(option));
}

// ---------------------------------------------------------------------------
// createAdvisor
// ---------------------------------------------------------------------------

export function createAdvisor(options: AdvisorOptions): Advisor {
  const { provider, lang } = options;
  const clock: Clock = options.clock ?? systemClock;
  const themeChips = options.themeChips ?? [];

  let state: AdvisorState = 'ASK';
  let plan: DreamPlan | null = null;
  /**
   * The plan the model produced *together with* a clarify question. Held back so the
   * card does not appear before the question is answered, but kept so the next call can
   * send it as `prior` (the model does not have to invent the theme twice).
   */
  let draft: DreamPlan | null = null;
  let clarifyCount = 0;
  const messages: AdvisorMessage[] = [];

  function push(role: 'user' | 'assistant', text: string, fromVoice?: boolean): void {
    const message: AdvisorMessage = { role, text, at: clock.nowIso() };
    if (fromVoice === true) message.fromVoice = true;
    messages.push(message);
  }

  function labelFor(chipKey: string): string {
    const chip = themeChips.find((candidate) => candidate.key === chipKey);
    if (chip) {
      const title = lang === 'th' ? chip.titleTh : chip.titleEn;
      return chip.emoji === undefined ? title : `${chip.emoji} ${title}`;
    }
    return chipLabel(chipKey, lang);
  }

  /**
   * One provider round trip, with the retry policy the oracle pins down:
   *
   *   * an answer that fails the schema → **retry once** (models fix themselves
   *     surprisingly often when asked twice) → still bad → `null` (oracle F3: exactly
   *     two calls);
   *   * a **thrown** error (no network, DNS, TLS, timeout) → `null` immediately. There
   *     is nothing to fix by asking again and the user is waiting (oracle F4).
   */
  async function callProvider(prior: DreamPlan | null): Promise<DreamPlan | null> {
    const request: PlanRequest = {
      messages: messages.map((message) => ({ role: message.role, text: message.text })),
      lang,
      prior,
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let raw: unknown;
      try {
        raw = await provider.plan(request);
      } catch {
        return null;
      }
      const parsed = parseDreamPlan(raw);
      if (parsed) return parsed;
    }
    return null;
  }

  /** Turn a provider answer (or `null`) into the next state + the bubbles that go with it. */
  function settle(answer: DreamPlan | null, makeOffline: () => DreamPlan): AdvisorTurn {
    const offline = answer === null;
    const candidate = answer ?? makeOffline();

    const clarify = candidate.clarify ?? null;
    const mayAsk =
      !offline && clarify !== null && plan === null && clarifyCount < MAX_CLARIFY_PER_NIGHT && clarifyIsAllowed(clarify);

    if (mayAsk && clarify !== null) {
      clarifyCount += 1;
      draft = withWatermark(candidate, lang, clarify);
      state = 'CLARIFY';
      push('assistant', `${restateLine(candidate, lang)}\n${actionLine(lang)}\n${clarify.question}`);
      return { state, clarify, plan: null, offline: false };
    }

    const settled = withWatermark(candidate, lang, null);
    plan = settled;
    draft = null;
    state = 'PLAN';
    const lines = [restateLine(settled, lang), actionLine(lang), planReadyLine(lang)];
    if (offline) lines.push(offlineNoteLine(lang));
    push('assistant', lines.join('\n'));
    return { state, plan: settled, clarify: null, offline };
  }

  function assertOpen(method: string): void {
    if (state === 'STARTED') {
      throw new Error(`advisor.${method}: tonight already started — stop the night before changing the plan`);
    }
  }

  async function say(text: string, sayOptions?: { fromVoice?: boolean }): Promise<AdvisorTurn> {
    assertOpen('say');
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('advisor.say: empty message');
    }

    push('user', text, sayOptions?.fromVoice);

    // Editing by typing is the same gesture as talking (DESIGN §3.3 last bullet), so once
    // a plan exists a plain message is an edit — that is what the user means by "เปลี่ยนเป็น…".
    if (plan !== null) {
      const result = await edit(text, { alreadyPushed: true });
      return { state: result.state, plan: result.plan, clarify: null };
    }

    const answer = await callProvider(draft);
    return settle(answer, () => offlinePlanFromText(text, lang));
  }

  async function pickChip(chipKey: string): Promise<AdvisorTurn> {
    assertOpen('pickChip');
    if (typeof chipKey !== 'string' || chipKey.trim() === '') {
      throw new Error('advisor.pickChip: empty chip');
    }

    // A chip tapped while a question is on screen is the *answer* to that question,
    // not a new theme — the model gets it as the next user turn together with the draft.
    if (state === 'CLARIFY') {
      const pending = draft;
      push('user', chipKey);
      const answer = await callProvider(pending);
      return settle(answer, () => (pending === null ? offlinePlanFromText(chipKey, lang) : pending));
    }

    push('user', labelFor(chipKey));
    const answer = await callProvider(plan ?? draft);
    return settle(answer, () => offlinePlanFromChip(chipKey, lang));
  }

  async function edit(text: string, internal?: { alreadyPushed: boolean }): Promise<{ state: 'PLAN'; plan: DreamPlan }> {
    assertOpen('edit');
    const current = plan;
    if (current === null) {
      throw new Error('advisor.edit: there is no plan to edit yet');
    }
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('advisor.edit: empty message');
    }

    if (internal?.alreadyPushed !== true) push('user', text);

    // "เสียงผู้ชาย" / "เบากว่านี้" never reach the model: there is no field for them and
    // pretending there is would teach the user that the app can do something it must not
    // (§2 principle 3 · 3.1). One line back, plan untouched.
    if (isAboutSound(text)) {
      state = 'PLAN';
      push('assistant', watermarkLockedLine(lang));
      return { state: 'PLAN', plan: current };
    }

    state = 'EDIT';
    const answer = await callProvider(current);

    if (answer === null) {
      state = 'PLAN';
      push('assistant', couldNotUpdateLine(lang));
      return { state: 'PLAN', plan: current };
    }

    const patched = withWatermark(answer, lang, null);
    plan = patched;
    state = 'PLAN';
    push('assistant', `${planUpdatedLine(lang)}\n${restateLine(patched, lang)}`);
    return { state: 'PLAN', plan: patched };
  }

  function start(): { state: 'STARTED'; plan: DreamPlan } {
    const current = plan;
    if (current === null) {
      throw new Error('advisor.start: there is no plan yet — ask for a dream first');
    }
    state = 'STARTED';
    return { state: 'STARTED', plan: current };
  }

  return {
    get state() {
      return state;
    },
    get plan() {
      return plan;
    },
    get clarifyCount() {
      return clarifyCount;
    },
    get messages() {
      return [...messages];
    },
    say,
    pickChip,
    edit: (text: string) => edit(text),
    start,
  };
}

/**
 * `providers/mock.ts` — the plan provider QC runs against.
 *
 * APP-RUN §0.3 item 3: the OpenRouter key arrives when the owner is ready to test, so
 * every oracle, every CI run and every local dev session must work without it. This
 * provider answers from the same hand-written themes the offline fallback uses
 * (`packages/engine/src/dreamPlan.ts`), which gives two useful properties:
 *
 *   * **deterministic** — same conversation in, same plan out, no wall clock, no network.
 *     A QC run that fails, fails for a reason in our code.
 *   * **realistic enough to be dangerous** — it asks the one clarifying question on the
 *     first turn when the user was vague, so the `ASK → CLARIFY → PLAN` path is exercised
 *     by the mock and not only by the oracle's hand-built fixtures.
 *
 * It is *not* a stand-in for the model in production: `main.ts` refuses to boot on the mock
 * unless `AI_ALLOW_MOCK=1` is set explicitly, so a missing key can never silently ship
 * canned dreams to a real user.
 */

import {
  guessChipFromText,
  offlinePlanFromChip,
  type DreamPlan,
  type PlanProvider,
  type PlanRequest,
} from '@lucid/engine';

/** One clarifying question per theme, about the **dream** — never about the sound (§3.3). */
const CLARIFY_FIXTURES: Record<string, { th: { question: string; options: string[] }; en: { question: string; options: string[] } }> = {
  whale: {
    th: { question: 'อยากให้มีอะไรอยู่ในฝันด้วยไหม?', options: ['🐢 เต่าทะเล', '🪸 ปะการัง', 'ไม่ต้อง'] },
    en: { question: 'Anything else you want in the dream?', options: ['🐢 Sea turtles', '🪸 Coral', 'Nothing else'] },
  },
  fly: {
    th: { question: 'อยากบินตอนไหน?', options: ['🌅 เช้า', '🌙 กลางคืน', 'ไม่เจาะจง'] },
    en: { question: 'When would you like to be flying?', options: ['🌅 Morning', '🌙 Night', 'No preference'] },
  },
  space: {
    th: { question: 'อยากอยู่ตรงไหนของอวกาศ?', options: ['🛰 รอบโลก', '🌕 บนดวงจันทร์', 'ไม่เจาะจง'] },
    en: { question: 'Where in space?', options: ['🛰 Orbiting Earth', '🌕 On the moon', 'No preference'] },
  },
  sea: {
    th: { question: 'อยากอยู่บนฝั่งหรือในน้ำ?', options: ['🏖 บนหาด', '🤿 ในน้ำ', 'ทั้งสองอย่าง'] },
    en: { question: 'On the shore or in the water?', options: ['🏖 On the beach', '🤿 In the water', 'Both'] },
  },
  oldtown: {
    th: { question: 'อยากเดินคนเดียวหรือมีคนอยู่ด้วย?', options: ['🚶 คนเดียว', '👥 มีคนอยู่ด้วย', 'ไม่เจาะจง'] },
    en: { question: 'Walking alone or with someone?', options: ['🚶 Alone', '👥 With someone', 'No preference'] },
  },
};

/** Last thing the user said — the only part of the conversation the mock looks at. */
function lastUserText(request: PlanRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const message = request.messages[i];
    if (message && message.role === 'user') return message.text;
  }
  return '';
}

/** A place mentioned as "ที่ <place>" / "at <place>" — enough to prove `place` survives a round trip. */
function guessPlace(text: string): string | null {
  const th = /ที่\s*([^\s,.!?]{2,40})/u.exec(text);
  if (th?.[1]) return th[1];
  const en = /\bat\s+([A-Za-z][A-Za-z\s]{1,38})/u.exec(text);
  if (en?.[1]) return en[1].trim();
  return null;
}

export interface MockProviderOptions {
  /** Ask the one clarifying question when the first message is short/vague. Default `true`. */
  clarify?: boolean;
}

export function createMockPlanProvider(options?: MockProviderOptions): PlanProvider {
  const mayClarify = options?.clarify ?? true;

  return {
    async plan(request: PlanRequest): Promise<unknown> {
      const text = lastUserText(request);
      const chip = guessChipFromText(text);
      const base: DreamPlan = offlinePlanFromChip(chip, request.lang);
      const place = guessPlace(text) ?? request.prior?.theme.place ?? null;

      const plan: DreamPlan = { ...base, theme: { ...base.theme, place } };

      // First turn + vague wording + no plan to patch → ask the one question.
      const isFirstTurn = request.messages.filter((message) => message.role === 'user').length <= 1;
      const vague = text.trim().length <= 24;
      const fixture = CLARIFY_FIXTURES[chip];
      if (mayClarify && isFirstTurn && vague && !request.prior && fixture) {
        return { ...plan, clarify: request.lang === 'th' ? fixture.th : fixture.en };
      }

      return plan;
    },
  };
}

/** A provider that always answers off-schema — used to prove the `502 PROVIDER_SCHEMA` path. */
export const brokenPlanProvider: PlanProvider = {
  async plan(): Promise<unknown> {
    return { sorry: 'I am a chatty model that ignored your schema', volume: 1 };
  },
};

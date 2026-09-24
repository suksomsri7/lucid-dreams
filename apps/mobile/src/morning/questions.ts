/**
 * The four fixed morning questions (WO L3.1 · DESIGN §3.2's "morning, two steps", step 2
 * · mockup `06-morning.png` frame b) plus the fifth, conditional one — pure data, no
 * `DreamPlan`/`useMorning` import, so `MorningFlow.tsx` and any future test can both
 * build the exact same order without duplicating it.
 *
 * `themeMatch`'s question text is the one exception: it needs the night's own theme
 * ("how close to 🐋 the whale shark?"), which this file has no way to know — its
 * `questionKey` is `null` and the caller (`useMorning.ts`) builds that one sentence
 * itself from the plan it already loaded.
 */

import type { TranslationKey } from '../i18n';

export type MorningQuestionKey = 'dreamed' | 'themeMatch' | 'lucid' | 'sleepQuality' | 'cueWoke';

export type MorningQuestionKind = 'scale10' | 'lucidChips' | 'boolChips';

export interface MorningQuestionDef {
  key: MorningQuestionKey;
  kind: MorningQuestionKind;
  questionKey: TranslationKey | null;
}

/** DESIGN §4-06 frame b's fixed order: dreamed? → theme match → lucid? → slept well? */
export const MORNING_QUESTIONS: readonly MorningQuestionDef[] = [
  { key: 'dreamed', kind: 'scale10', questionKey: 'morning.q.dreamed' },
  { key: 'themeMatch', kind: 'scale10', questionKey: null },
  { key: 'lucid', kind: 'lucidChips', questionKey: 'morning.q.lucid' },
  { key: 'sleepQuality', kind: 'scale10', questionKey: 'morning.q.sleepQuality' },
];

/**
 * Only asked on a night that actually played a whisper (APP-RUN §2 L3.1's own line:
 * "'did the whisper wake you?' only on cue nights" · oracle M1.6). A control night, or a
 * cue night where nothing actually fired, has nothing to ask this about.
 */
export const CUE_WOKE_QUESTION: MorningQuestionDef = {
  key: 'cueWoke',
  kind: 'boolChips',
  questionKey: 'morning.q.cueWoke',
};

/** Tonight's full question order — the 4 fixed ones, plus `cueWoke` when relevant. */
export function morningQuestionOrder(cuesPlayed: number): readonly MorningQuestionDef[] {
  return cuesPlayed > 0 ? [...MORNING_QUESTIONS, CUE_WOKE_QUESTION] : MORNING_QUESTIONS;
}

/** The answers collected across `morningQuestionOrder` — `null` until each is answered. */
export interface MorningAnswers {
  dreamed: number | null;
  themeMatch: number | null;
  lucid: 'YES' | 'NO' | 'UNSURE' | null;
  sleepQuality: number | null;
  cueWoke: boolean | null;
}

export const EMPTY_MORNING_ANSWERS: MorningAnswers = {
  dreamed: null,
  themeMatch: null,
  lucid: null,
  sleepQuality: null,
  cueWoke: null,
};

/** `true` once every question `morningQuestionOrder(cuesPlayed)` asks has an answer. */
export function morningAnswersComplete(answers: MorningAnswers, cuesPlayed: number): boolean {
  return morningQuestionOrder(cuesPlayed).every((q) => answers[q.key] !== null);
}

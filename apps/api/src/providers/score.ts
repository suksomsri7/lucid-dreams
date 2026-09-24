/**
 * `providers/score.ts` — the contract for the two morning calls, and the fake that QC runs.
 *
 * Two jobs live behind this one interface because they are the same kind of work with the
 * same rules (DESIGN §6, last two rows of the AI table):
 *
 *   * **score** — one dream the sleeper told, in their own words, turned into numbers
 *     (`themeMatch` 0–10, the words that matched, a lucid signal, ≤ 5 tags, 2 lines);
 *   * **weekly** — seven nights of numbers turned into 3 short lines and 1 gentle tip.
 *
 * Why an interface instead of calling OpenRouter directly from the route (same reason as
 * {@link TtsProvider}): the oracle has to be able to make the model answer badly on
 * purpose — an invented word, a quote that was never said, a sentence that diagnoses —
 * without a key, without a network and without waiting two seconds per case.
 *
 * Three things this file deliberately does **not** do:
 *   * it does not validate `score` answers — that is {@link sanitizeAiScore} in the engine,
 *     which is also the validator the phone runs, so both sides agree by construction;
 *   * it does not decide the retry — the *server* does, because "was this answer usable"
 *     is a question about the transcript, which the adapter has no business judging;
 *   * it never returns the model's own claim about which model it is. `model` in
 *     {@link ProviderAnswer} is the slug the adapter actually called (S3: a field the model
 *     writes is a field the model can lie about).
 */

import { z } from 'zod';

/** DESIGN §6 + L3.1 client contract: a dictated dream is a paragraph, not a document. */
export const SCORE_MAX_TRANSCRIPT = 4000;

/** Longest history the weekly summary looks at: a month, so "last 7 nights" always fits. */
export const WEEKLY_MAX_NIGHTS = 31;

/** DESIGN §6: "3 บรรทัด + 1 คำแนะนำ" — three lines, exactly, and one tip. */
export const WEEKLY_LINES = 3;

/** One line of Thai on a phone, with room for a number. Same cap for the tip. */
export const WEEKLY_LINE_MAX = 200;

export type ScoreLang = 'th' | 'en';

export interface ScoreTheme {
  emoji: string;
  titleTh: string;
  titleEn: string;
  /** Only ever a place the user named themselves (`null` otherwise) — never invented. */
  place: string | null;
}

/** What the sleeper answered on the morning form. Every one of them may be missing. */
export interface ScoreAnswers {
  dreamed: number | null;
  themeMatchUser: number | null;
  lucid: 'YES' | 'NO' | 'UNSURE' | null;
  sleepQuality: number | null;
  cueWoke: boolean | null;
}

export interface ScoreProviderRequest {
  /** The user's own words. Sensitive (APP-RUN §0.5 S4): never logged, never cached. */
  transcript: string;
  theme: ScoreTheme;
  seedLines: [string, string];
  answers: ScoreAnswers;
  /** How many whispers played last night, when the client knows. */
  cues: number | null;
  lang: ScoreLang;
  /**
   * `true` on the **second** attempt: the first answer was thrown away (a term that was
   * never said, a quote that was invented, or a medical claim). The adapter adds a short
   * reminder of the rule that was broken; it does not change the schema or the prompt.
   */
  strict: boolean;
}

export interface WeeklyNight {
  dateIso: string;
  /** `CONTROL` = a comparison night with no whisper at all (L3.3). */
  mode: 'CUE' | 'CONTROL';
  themeMatch: number | null;
  lucid: 'YES' | 'NO' | 'UNSURE' | null;
  sleepQuality: number | null;
  cues: number;
  cueWoke: boolean;
}

export interface WeeklyProviderRequest {
  nights: WeeklyNight[];
  lang: ScoreLang;
  strict: boolean;
}

export interface ProviderAnswer {
  /** Whatever the vendor said: an object, or the JSON string `json_object` mode returns. */
  raw: unknown;
  /** The slug that answered (the adapter's own record of it, not the model's claim). */
  model: string;
}

export interface ScoreProvider {
  score(request: ScoreProviderRequest): Promise<ProviderAnswer>;
  weekly(request: WeeklyProviderRequest): Promise<ProviderAnswer>;
}

// ---------------------------------------------------------------------------
// The weekly schema (the score schema is the engine's, shared with the phone)
// ---------------------------------------------------------------------------

/**
 * `POST /ai/weekly`'s only shape. Unknown keys are stripped, exactly as in
 * `AiScoreSchema`: a chatty model that adds `advice` still works, a hostile `volume`
 * key has nowhere to land (§0.5 S3).
 *
 * `lines` is `.length(3)` and not "up to 3": the report screen has three rows, and a
 * model that returns two has misunderstood the job — better to retry than to render a
 * hole.
 */
export const WeeklySummarySchema = z.object({
  lines: z.array(z.string().min(1).max(WEEKLY_LINE_MAX)).length(WEEKLY_LINES),
  tip: z.string().min(1).max(WEEKLY_LINE_MAX),
});
export type WeeklySummary = z.infer<typeof WeeklySummarySchema>;

/**
 * Turn whatever the vendor sent into an object.
 *
 * `response_format: { type: 'json_object' }` gives us a **string** of JSON in
 * `choices[0].message.content`, and some models still wrap it in a ```json fence. Same
 * tolerance as `parseDreamPlan` in the engine, and the same refusal to repair anything
 * else: if it is not JSON, it is not an answer.
 */
export function coerceJsonObject(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(raw);
  try {
    return JSON.parse(fenced?.[1] ?? raw);
  } catch {
    return null;
  }
}

/** `null` when the answer does not fit {@link WeeklySummarySchema}. Never throws. */
export function parseWeeklySummary(raw: unknown): WeeklySummary | null {
  const parsed = WeeklySummarySchema.safeParse(coerceJsonObject(raw));
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// The fake (QC and `AI_ALLOW_MOCK=1`)
// ---------------------------------------------------------------------------

/** Words from the transcript, so the mock's `matchedTerms` survive `sanitizeAiScore`. */
function firstWords(transcript: string, count: number): string[] {
  return transcript
    .split(/\s+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .slice(0, count);
}

/**
 * A score provider with no network and no key.
 *
 * It quotes the transcript rather than inventing prose, and it derives the number from
 * what the sleeper answered — so a dev run shows the real shape of the morning screen
 * (numbers side by side, words the user recognises) without spending a satang. It is not
 * a stand-in for the model: `main.ts` only uses it under `AI_ALLOW_MOCK=1`.
 */
export const mockScoreProvider: ScoreProvider = {
  async score(request: ScoreProviderRequest): Promise<ProviderAnswer> {
    const terms = firstWords(request.transcript, 2);
    const themeMatch = request.answers.themeMatchUser ?? (terms.length > 0 ? 6 : 0);
    const lucid = request.answers.lucid === 'YES';
    return {
      raw: {
        themeMatch,
        matchedTerms: terms,
        lucidSignals: { present: lucid, quote: null },
        tags: request.lang === 'th' ? ['ตัวอย่าง'] : ['sample'],
        summary:
          request.lang === 'th'
            ? 'นี่คือสรุปตัวอย่างจากตัวปลอม ไม่ได้เรียกโมเดลจริง'
            : 'This is a sample summary from the mock provider, no model was called.',
      },
      model: 'mock',
    };
  },

  async weekly(request: WeeklyProviderRequest): Promise<ProviderAnswer> {
    const nights = request.nights.length;
    const cues = request.nights.reduce((total, night) => total + night.cues, 0);
    const lucid = request.nights.filter((night) => night.lucid === 'YES').length;
    return {
      raw:
        request.lang === 'th'
          ? {
              lines: [`เล่าฝันไว้ ${nights} คืน`, `กระซิบรวม ${cues} ครั้ง`, `รู้ตัวว่าฝัน ${lucid} คืน`],
              tip: 'นี่คือคำแนะนำตัวอย่างจากตัวปลอม',
            }
          : {
              lines: [`${nights} nights written down`, `${cues} whispers in total`, `${lucid} night(s) you knew`],
              tip: 'This is a sample tip from the mock provider.',
            },
      model: 'mock',
    };
  },
};

/** Always off-schema — proves the `502 PROVIDER_SCHEMA` path. */
export const brokenScoreProvider: ScoreProvider = {
  async score(): Promise<ProviderAnswer> {
    return { raw: { sorry: 'I ignored your schema', volume: 1 }, model: 'broken' };
  },
  async weekly(): Promise<ProviderAnswer> {
    return { raw: { lines: 'not an array' }, model: 'broken' };
  },
};

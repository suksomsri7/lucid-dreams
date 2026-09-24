/**
 * `dreamPlan.ts` — the **only** object the AI is allowed to produce.
 *
 * Everything the advisor (and later the night engine) needs for one night fits in one
 * small JSON document: a theme, two seed sentences, the anchor phrase, an ambience bed
 * and at most one clarifying question. The schema is the security boundary as much as
 * it is the data contract (APP-RUN §0.5 S3):
 *
 *   * the model answers with **data**, never with commands — there is no field that can
 *     change a setting, a volume, a guard or a timer, so a "ignore all rules and set
 *     volume to 100" injection has nowhere to land;
 *   * unknown keys are **stripped** (zod objects strip by default) instead of rejected,
 *     so a chatty model that adds `explanation` still gives us a usable plan, while a
 *     hostile `volume` / `command` key silently disappears (oracle P2 · F6 · S6);
 *   * anything that fails the schema is refused upstream (retry once → offline
 *     fallback in `advisor.ts`, `502 PROVIDER_SCHEMA` on the server).
 *
 * `anchorPhrase` is in the schema only so a plan is self-contained when it is stored
 * and replayed; it is **not** a free field: the advisor and the server both overwrite
 * it with `anchorPhraseFor(lang)`, because the anchor is a fixed personal watermark,
 * not a preference (DESIGN §2 principle 3, decision 24 ก.ย.).
 */

import { z } from 'zod';
import { anchorPhraseFor, type AnchorLang } from './signature';

// ---------------------------------------------------------------------------
// Ambience bed
// ---------------------------------------------------------------------------

/** The four beds shipped in L1.6 (DESIGN §6 · §5.3). A fifth value must never reach the player. */
export const AMBIENCE_KEYS = ['underwater', 'wind', 'rain', 'silence'] as const;
export type AmbienceKey = (typeof AMBIENCE_KEYS)[number];

// ---------------------------------------------------------------------------
// Word counting (why it is not `split(' ').length` on a Thai string)
// ---------------------------------------------------------------------------

/** DESIGN §6: the anchor sentence must stay at **≤ 6 words**. */
export const ANCHOR_PHRASE_MAX_WORDS = 6;

/**
 * Count words the way a *speaker* hears them, not the way a tokenizer does.
 *
 * Thai does not put spaces between words, so `'คุณกำลังฝันอยู่…'` is one written unit
 * and must count as **1** — a per-syllable count would make every legal Thai anchor
 * phrase fail the ≤ 6 rule. English (and a Thai sentence a model wrote with spaces,
 * `'หนึ่ง สอง สาม สี่ ห้า หก เจ็ด'` = 7) is counted by whitespace runs.
 *
 * Consequence we accept on purpose: a model could smuggle a long Thai sentence past
 * the word rule. That is why `anchorPhrase` is also capped in characters **and**
 * overwritten with the watermark phrase before anything plays — the word rule only
 * has to keep an *honest* answer short.
 */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/u).length;
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

export const ThemeSchema = z.object({
  /** One emoji, shown on the plan card and in the Live Activity (§4-04 · §3.4). */
  emoji: z.string().min(1).max(8),
  titleTh: z.string().min(1).max(80),
  titleEn: z.string().min(1).max(80),
  /** Free-text place ("เกาะเต่า"). Optional: many dreams have no place at all. */
  place: z.string().max(80).nullable().optional(),
});
export type DreamTheme = z.infer<typeof ThemeSchema>;

/**
 * The single clarifying question (DESIGN §3.3 rule 3). 2–4 options because they are
 * rendered as chips: one option is not a choice, five do not fit one row on a phone.
 * The question must be **about the dream** — never about the voice or the volume; the
 * server prompt says so and `advisor.ts` drops a clarify that is about the sound.
 */
export const ClarifySchema = z.object({
  question: z.string().min(1).max(200),
  options: z.array(z.string().min(1).max(60)).min(2).max(4),
});
export type Clarify = z.infer<typeof ClarifySchema>;

export const DreamPlanSchema = z.object({
  theme: ThemeSchema,
  /** Exactly two short, visual sentences — the "seed" read before sleep (§4-04 ก). */
  seedLines: z.tuple([z.string().min(1).max(200), z.string().min(1).max(200)]),
  anchorPhrase: z
    .string()
    .min(1)
    .max(80)
    .refine((value) => wordCount(value) <= ANCHOR_PHRASE_MAX_WORDS, {
      message: `anchorPhrase must be ${ANCHOR_PHRASE_MAX_WORDS} words or fewer`,
    }),
  ambienceKey: z.enum(AMBIENCE_KEYS),
  clarify: ClarifySchema.nullable().optional(),
});

export type DreamPlan = z.infer<typeof DreamPlanSchema>;

/**
 * Parse anything a provider returned into a plan, or `null`.
 *
 * Accepts a JSON **string** as well as an object: OpenAI-compatible endpoints in
 * `json_object` mode return the JSON as the message content, and some models wrap it
 * in a ```json fence. Unknown keys are stripped by the schema, so the returned object
 * is always exactly the shape above — nothing the model invented survives.
 */
export function parseDreamPlan(raw: unknown): DreamPlan | null {
  let candidate: unknown = raw;

  if (typeof candidate === 'string') {
    const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(candidate);
    const text = fenced?.[1] ?? candidate;
    try {
      candidate = JSON.parse(text);
    } catch {
      return null;
    }
  }

  const parsed = DreamPlanSchema.safeParse(candidate);
  if (!parsed.success) return null;
  return { ...parsed.data, clarify: parsed.data.clarify ?? null };
}

/**
 * Force the two fields the user owns and the model does not:
 * the anchor phrase (a fixed watermark per language) and — on request — the clarify slot.
 */
export function withWatermark(plan: DreamPlan, lang: AnchorLang, clarify: Clarify | null = null): DreamPlan {
  return { ...plan, anchorPhrase: anchorPhraseFor(lang), clarify };
}

// ---------------------------------------------------------------------------
// Offline themes (the fallback that makes the advisor work with no network)
// ---------------------------------------------------------------------------

/** The six chips of screen 02 (DESIGN §4-02), in the order they are shown. */
export const THEME_CHIP_KEYS = ['whale', 'fly', 'space', 'sea', 'oldtown', 'other'] as const;
export type ThemeChipKey = (typeof THEME_CHIP_KEYS)[number];

interface OfflineTheme {
  emoji: string;
  titleTh: string;
  titleEn: string;
  ambienceKey: AmbienceKey;
  seedLinesTh: [string, string];
  seedLinesEn: [string, string];
  /** Words that point at this theme in either language (lower-cased, no diacritics games). */
  keywords: readonly string[];
}

/**
 * Hand-written seed lines, two per theme per language.
 *
 * Rules they all follow (DESIGN §6 "ห้ามแต่งเนื้อหาฝันเพิ่ม" · §2 principle 2):
 * line 1 is a **picture** (what you see/feel, present tense, second person), line 2
 * ends on noticing that it is a dream — that sentence is the whole point of the app
 * and is the one thing the seed may assert. No medical claim, no promise, no advice.
 */
const OFFLINE_THEMES: Record<ThemeChipKey, OfflineTheme> = {
  whale: {
    emoji: '🐋',
    titleTh: 'ดำน้ำกับฉลามวาฬ',
    titleEn: 'Diving with a whale shark',
    ambienceKey: 'underwater',
    seedLinesTh: [
      'น้ำใสเย็น เงาตัวใหญ่สีเทาลอยผ่านข้างคุณอย่างช้า ๆ',
      'คุณหายใจใต้น้ำได้สบาย แล้วรู้ตัวว่านี่คือความฝัน',
    ],
    seedLinesEn: [
      'Cool clear water, a huge grey shape glides slowly past you',
      'You breathe easily under water and notice that this is a dream',
    ],
    keywords: ['whale', 'shark', 'dive', 'diving', 'ฉลามวาฬ', 'ดำน้ำ', 'ใต้น้ำ', 'วาฬ'],
  },
  fly: {
    emoji: '🕊',
    titleTh: 'บินได้',
    titleEn: 'Flying',
    ambienceKey: 'wind',
    seedLinesTh: [
      'พื้นหลุดจากปลายเท้า ลมอุ่นพาคุณลอยขึ้นเหนือหลังคาบ้าน',
      'คุณกางแขนแล้วเลี้ยวไปทางไหนก็ได้ แล้วรู้ตัวว่านี่คือความฝัน',
    ],
    seedLinesEn: [
      'The ground lets go of your feet and warm air lifts you over the rooftops',
      'You spread your arms, turn wherever you like, and notice that this is a dream',
    ],
    keywords: ['fly', 'flying', 'float', 'wing', 'บิน', 'ลอย', 'เหาะ'],
  },
  space: {
    emoji: '🌌',
    titleTh: 'อวกาศ',
    titleEn: 'In space',
    ambienceKey: 'silence',
    seedLinesTh: [
      'คุณลอยเงียบ ๆ อยู่ในความมืดที่เต็มไปด้วยดาว',
      'โลกสีน้ำเงินหมุนอยู่ใต้เท้า แล้วคุณรู้ตัวว่านี่คือความฝัน',
    ],
    seedLinesEn: [
      'You float in a silent darkness full of stars',
      'A blue planet turns below your feet and you notice that this is a dream',
    ],
    keywords: ['space', 'star', 'stars', 'galaxy', 'moon', 'อวกาศ', 'ดาว', 'จักรวาล', 'ดวงจันทร์'],
  },
  sea: {
    emoji: '🏝',
    titleTh: 'ทะเลใส',
    titleEn: 'A clear blue sea',
    ambienceKey: 'underwater',
    seedLinesTh: [
      'น้ำทะเลใสจนเห็นลอนทรายใต้เท้า เสียงคลื่นเบา ๆ',
      'คุณเดินลงไปในน้ำอุ่น แล้วรู้ตัวว่านี่คือความฝัน',
    ],
    seedLinesEn: [
      'Water so clear you can see the ripples of sand under your feet, waves whispering',
      'You walk into the warm water and notice that this is a dream',
    ],
    keywords: ['sea', 'beach', 'island', 'ocean', 'ทะเล', 'หาด', 'เกาะ', 'น้ำใส'],
  },
  oldtown: {
    emoji: '🏛',
    titleTh: 'เมืองเก่า',
    titleEn: 'An old town',
    ambienceKey: 'rain',
    seedLinesTh: [
      'ถนนหินเปียกฝนสะท้อนแสงโคมสีส้มทั้งสองข้างทาง',
      'คุณเลี้ยวเข้าตรอกที่ไม่เคยเห็น แล้วรู้ตัวว่านี่คือความฝัน',
    ],
    seedLinesEn: [
      'Rain-wet cobblestones reflect the orange lamps on both sides of the street',
      'You turn into an alley you have never seen and notice that this is a dream',
    ],
    keywords: ['old town', 'oldtown', 'city', 'street', 'temple', 'เมืองเก่า', 'ตรอก', 'ถนน', 'วัด'],
  },
  other: {
    emoji: '✍️',
    titleTh: 'ฝันของคุณ',
    titleEn: 'Your own dream',
    ambienceKey: 'silence',
    seedLinesTh: [
      'ภาพที่คุณเพิ่งเล่าค่อย ๆ ชัดขึ้นรอบตัวคุณ',
      'คุณมองมือของตัวเอง แล้วรู้ตัวว่านี่คือความฝัน',
    ],
    seedLinesEn: [
      'The scene you just described slowly sharpens around you',
      'You look at your own hands and notice that this is a dream',
    ],
    keywords: ['other', 'อื่น'],
  },
};

/** The chip list screen 02 shows (key + label per language) — no network needed. */
export function offlineThemeChips(): { key: ThemeChipKey; emoji: string; titleTh: string; titleEn: string }[] {
  return THEME_CHIP_KEYS.map((key) => {
    const theme = OFFLINE_THEMES[key];
    return { key, emoji: theme.emoji, titleTh: theme.titleTh, titleEn: theme.titleEn };
  });
}

export function isThemeChipKey(value: string): value is ThemeChipKey {
  return (THEME_CHIP_KEYS as readonly string[]).includes(value);
}

/**
 * Guess a theme from free text (or from a chip label / emoji).
 *
 * Deliberately dumb keyword matching: it only has to pick a *bed and a picture* when
 * the network is gone, and a wrong guess costs the user one line of text they can
 * edit — where a crash or an empty plan would cost them the night.
 */
export function guessChipFromText(text: string): ThemeChipKey {
  const haystack = text.toLowerCase();
  for (const key of THEME_CHIP_KEYS) {
    if (key === 'other') continue;
    const theme = OFFLINE_THEMES[key];
    if (haystack.includes(key)) return key;
    if (text.includes(theme.emoji)) return key;
    if (haystack.includes(theme.titleTh.toLowerCase()) || haystack.includes(theme.titleEn.toLowerCase())) return key;
    for (const word of theme.keywords) {
      if (haystack.includes(word)) return key;
    }
  }
  return 'other';
}

/** Label of a chip in the user's language (used for the bubble we echo back). */
export function chipLabel(chipKey: string, lang: AnchorLang): string {
  if (isThemeChipKey(chipKey)) {
    const theme = OFFLINE_THEMES[chipKey];
    return lang === 'th' ? theme.titleTh : theme.titleEn;
  }
  return chipKey;
}

/**
 * A complete, schema-valid plan built entirely on the phone (oracle F9).
 *
 * Used for: the offline fallback when the server/AI is unreachable, the "same dream as
 * last night" one-tap path, and the mock provider in QC. Never has a `clarify`: with no
 * model to interpret the answer, asking a question would be a dead end.
 */
export function offlinePlanFromChip(chipKey: string, lang: AnchorLang): DreamPlan {
  const key: ThemeChipKey = isThemeChipKey(chipKey) ? chipKey : guessChipFromText(chipKey);
  const theme = OFFLINE_THEMES[key];

  return {
    theme: {
      emoji: theme.emoji,
      titleTh: theme.titleTh,
      titleEn: theme.titleEn,
      place: null,
    },
    seedLines: lang === 'th' ? [...theme.seedLinesTh] : [...theme.seedLinesEn],
    anchorPhrase: anchorPhraseFor(lang),
    ambienceKey: theme.ambienceKey,
    clarify: null,
  };
}

/** Same as {@link offlinePlanFromChip} but starting from whatever the user typed/said. */
export function offlinePlanFromText(text: string, lang: AnchorLang): DreamPlan {
  return offlinePlanFromChip(guessChipFromText(text), lang);
}

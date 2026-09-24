/**
 * The dream advisor's UI-side adapter (WO L1.4). `createMockAdvisorAdapter` is a fully
 * deterministic, offline stand-in for the real engine advisor Opus is writing in a
 * parallel worktree right now (`scripts/qc-tests/L1.5-advisor.test.ts`) — this file must
 * not import from `packages/engine`, so every piece of "intelligence" here is a lookup
 * table, not a model call. `useAdvisor.ts` is the only consumer; `AdvisorRoom.tsx` never
 * touches this file directly.
 *
 * Swap-out plan (WO L1.4 §deliverables, confirmed with Fable): at the L1.5 merge, a
 * second `createEngineAdvisorAdapter(lang)` implementing the same `AdvisorAdapter`
 * interface will wrap the real `createAdvisor()` + an OpenRouter-backed `PlanProvider`,
 * and `useAdvisor.ts` picks between them behind one line. Nothing in `AdvisorRoom.tsx`
 * or `PlanCardCompact.tsx` should need to change.
 *
 * State machine mirrors the engine contract exactly (same names, same rule): `ASK` →
 * `CLARIFY` (asked at most once — `MAX_CLARIFY`) → `PLAN` → typing more edits the plan
 * in place (`EDIT`-shaped, but this mock folds it back into `PLAN`) → `start()` moves to
 * `STARTED`, after which `say`/`edit`/`pickChip` all reject.
 */

import { translate, type Locale, type TranslationKey } from '../i18n';
import type {
  AdvisorAdapter,
  AdvisorResult,
  AdvisorState,
  AmbienceKey,
  DreamPlan,
  Message,
  ThemeKey,
} from './types';

/** DESIGN §3.3: the advisor may ask at most one clarifying question per plan. */
export const MAX_CLARIFY = 1;

type ClarifyPick = 'turtle' | 'coral' | 'none';

interface ThemeDefinition {
  key: ThemeKey;
  emoji: string;
  /** Also the plan card's title for every real theme — only `'other'` diverges (§ below). */
  chipLabelKey: TranslationKey;
  planTitleKey: TranslationKey;
  placeKey: TranslationKey | null;
  seed1Key: TranslationKey;
  seed2Key: TranslationKey;
  ambienceKey: AmbienceKey;
}

/**
 * The 6 starting chips (DESIGN §4-02, mockup `02-advisor-start.png`) — oracle A1.3/A1.4
 * greps for this exact export name. `'other'` is deliberately last and has no keywords:
 * `themeFromText` never returns it by matching, only as the fallback.
 */
export const THEME_CHIPS: readonly ThemeDefinition[] = [
  {
    key: 'whale',
    emoji: '🐋',
    chipLabelKey: 'advisor.theme.whale',
    planTitleKey: 'advisor.theme.whale',
    placeKey: 'advisor.theme.whale.place',
    seed1Key: 'advisor.theme.whale.seed1',
    seed2Key: 'advisor.theme.whale.seed2',
    ambienceKey: 'underwater',
  },
  {
    key: 'fly',
    emoji: '🕊',
    chipLabelKey: 'advisor.theme.fly',
    planTitleKey: 'advisor.theme.fly',
    placeKey: 'advisor.theme.fly.place',
    seed1Key: 'advisor.theme.fly.seed1',
    seed2Key: 'advisor.theme.fly.seed2',
    ambienceKey: 'wind',
  },
  {
    key: 'space',
    emoji: '🌌',
    chipLabelKey: 'advisor.theme.space',
    planTitleKey: 'advisor.theme.space',
    placeKey: 'advisor.theme.space.place',
    seed1Key: 'advisor.theme.space.seed1',
    seed2Key: 'advisor.theme.space.seed2',
    ambienceKey: 'silence',
  },
  {
    key: 'sea',
    emoji: '🏝',
    chipLabelKey: 'advisor.theme.sea',
    planTitleKey: 'advisor.theme.sea',
    placeKey: 'advisor.theme.sea.place',
    seed1Key: 'advisor.theme.sea.seed1',
    seed2Key: 'advisor.theme.sea.seed2',
    ambienceKey: 'underwater',
  },
  {
    key: 'oldtown',
    emoji: '🏛',
    chipLabelKey: 'advisor.theme.oldtown',
    planTitleKey: 'advisor.theme.oldtown',
    placeKey: 'advisor.theme.oldtown.place',
    seed1Key: 'advisor.theme.oldtown.seed1',
    seed2Key: 'advisor.theme.oldtown.seed2',
    ambienceKey: 'wind',
  },
  {
    key: 'other',
    emoji: '✍️',
    chipLabelKey: 'advisor.theme.other',
    planTitleKey: 'advisor.plan.genericTitle',
    placeKey: null,
    seed1Key: 'advisor.plan.genericSeed1',
    seed2Key: 'advisor.plan.genericSeed2',
    ambienceKey: 'silence',
  },
];

function findTheme(key: string): ThemeDefinition {
  return THEME_CHIPS.find((def) => def.key === key) ?? (THEME_CHIPS[THEME_CHIPS.length - 1] as ThemeDefinition);
}

/**
 * Free-typed text always maps to the `'whale'` theme (deterministic, per the WO — this
 * mock has no NLU and must not fake one; matching arbitrary user text to a theme is the
 * real engine's job from L1.5 on). Chip taps skip this entirely (`pickChip` passes the
 * chip's own key straight through) — this only fires when someone types or speaks
 * instead of tapping, which the WO's own fixture (`advisor-plan`) exercises with a
 * whale-shark sentence anyway.
 */
function themeFromText(_text: string): ThemeKey {
  return 'whale';
}

function themeLabel(lang: Locale, def: ThemeDefinition): string {
  return `${def.emoji} ${translate(lang, def.chipLabelKey)}`;
}

function restateLabel(lang: Locale, def: ThemeDefinition): string {
  const title = translate(lang, def.planTitleKey);
  return def.placeKey ? `${title} ${translate(lang, def.placeKey)}` : title;
}

function buildThemePlan(themeKey: string, lang: Locale, clarifyPick: ClarifyPick | null): DreamPlan {
  const def = findTheme(themeKey);
  const seed2 =
    clarifyPick === 'turtle'
      ? translate(lang, 'advisor.clarify.turtle.detail')
      : clarifyPick === 'coral'
        ? translate(lang, 'advisor.clarify.coral.detail')
        : translate(lang, def.seed2Key);

  return {
    theme: {
      emoji: def.emoji,
      titleTh: translate('th', def.planTitleKey),
      titleEn: translate('en', def.planTitleKey),
      place: def.placeKey ? translate(lang, def.placeKey) : null,
    },
    seedLines: [translate(lang, def.seed1Key), seed2],
    anchorPhrase: translate(lang, 'advisor.anchorPhrase'),
    ambienceKey: def.ambienceKey,
    clarify: null,
  };
}

let messageCounter = 0;
function nextId(prefix: string): string {
  messageCounter += 1;
  return `${prefix}-${messageCounter}`;
}

function clarifyChips(lang: Locale, selected?: ClarifyPick): Message['chips'] {
  return [
    { key: 'turtle', label: `🐢 ${translate(lang, 'advisor.clarify.turtle')}`, selected: selected === 'turtle' },
    { key: 'coral', label: `🪸 ${translate(lang, 'advisor.clarify.coral')}`, selected: selected === 'coral' },
    { key: 'none', label: translate(lang, 'advisor.clarify.none'), selected: selected === 'none' },
  ];
}

function introMessage(lang: Locale, now: () => string): Message {
  return {
    id: nextId('ai'),
    kind: 'ai',
    text: translate(lang, 'advisor.intro'),
    at: now(),
    chips: THEME_CHIPS.map((def) => ({ key: def.key, label: themeLabel(lang, def) })),
  };
}

export interface CreateMockAdvisorAdapterOptions {
  /**
   * Skips straight to the finished mockup-03 conversation (whale shark theme, turtle
   * clarify already picked) — used by the `?fixture=advisor-plan` QC fixture in
   * `src/dev/fixtures.ts` so the plan-state screenshot doesn't depend on tapping through
   * the flow first.
   */
  seed?: 'plan';
  /** Test/fixture seam — defaults to the real clock. */
  now?: () => string;
}

/**
 * A deterministic, offline dream advisor: restate + at most one clarify (3 fixed chips)
 * + a compact plan, per the WO. No network, no `packages/engine` import — everything a
 * real `PlanProvider` would decide is a lookup in `THEME_CHIPS` instead.
 */
export function createMockAdvisorAdapter(
  lang: Locale,
  options: CreateMockAdvisorAdapterOptions = {},
): AdvisorAdapter {
  const now = options.now ?? (() => new Date().toISOString());

  let state: AdvisorState = 'ASK';
  let plan: DreamPlan | null = null;
  let clarifyCount = 0;
  let pendingThemeKey: ThemeKey | null = null;
  let messages: Message[] = [introMessage(lang, now)];

  if (options.seed === 'plan') {
    const def = findTheme('whale');
    plan = buildThemePlan('whale', lang, 'turtle');
    messages = [
      messages[0] as Message,
      { id: nextId('me'), kind: 'me', text: translate(lang, 'advisor.fixture.userText'), fromVoice: true, at: now() },
      { id: nextId('ai'), kind: 'ai', text: translate(lang, 'advisor.restate', { label: restateLabel(lang, def) }), at: now() },
      { id: nextId('ai'), kind: 'ai', text: translate(lang, 'advisor.clarify.question'), at: now(), chips: clarifyChips(lang, 'turtle') },
      { id: nextId('ai'), kind: 'ai', text: translate(lang, 'advisor.planReady'), at: now(), planCompact: true },
    ];
    state = 'PLAN';
    clarifyCount = 1;
    pendingThemeKey = 'whale';
  }

  function toResult(): AdvisorResult {
    return { state, plan, clarify: null };
  }

  function requireNotStarted(): void {
    if (state === 'STARTED') throw new Error('advisor: conversation already started');
  }

  function pushUserMessage(text: string, fromVoice: boolean): void {
    messages = [...messages, { id: nextId('me'), kind: 'me', text, fromVoice, at: now() }];
  }

  function selectChip(messageId: string, key: string): void {
    messages = messages.map((message) =>
      message.id === messageId && message.chips
        ? { ...message, chips: message.chips.map((chip) => ({ ...chip, selected: chip.key === key })) }
        : message,
    );
  }

  function askClarify(themeKey: ThemeKey): void {
    pendingThemeKey = themeKey;
    const def = findTheme(themeKey);
    messages = [
      ...messages,
      { id: nextId('ai'), kind: 'ai', text: translate(lang, 'advisor.restate', { label: restateLabel(lang, def) }), at: now() },
      { id: nextId('ai'), kind: 'ai', text: translate(lang, 'advisor.clarify.question'), at: now(), chips: clarifyChips(lang) },
    ];
    state = 'CLARIFY';
    // The mock only ever asks once — `MAX_CLARIFY` above is the ceiling the real engine enforces too.
    clarifyCount = Math.min(clarifyCount + 1, MAX_CLARIFY);
  }

  function revealPlan(clarifyPick: ClarifyPick): void {
    plan = buildThemePlan(pendingThemeKey ?? 'other', lang, clarifyPick);
    messages = [...messages, { id: nextId('ai'), kind: 'ai', text: translate(lang, 'advisor.planReady'), at: now(), planCompact: true }];
    state = 'PLAN';
  }

  const adapter: AdvisorAdapter = {
    get state() {
      return state;
    },
    get plan() {
      return plan;
    },
    get messages() {
      return messages;
    },
    get clarifyCount() {
      return clarifyCount;
    },

    async say(text, sayOptions = {}) {
      requireNotStarted();
      if (state === 'PLAN') {
        // Typing more after the plan exists edits it in place (DESIGN §3.3) — same path as `edit()`.
        return adapter.edit(text);
      }
      pushUserMessage(text, sayOptions.fromVoice === true);
      if (state === 'ASK') {
        askClarify(themeFromText(text));
      } else if (state === 'CLARIFY') {
        // Free text instead of tapping a clarify chip — never leaves the user stuck.
        revealPlan('none');
      }
      return toResult();
    },

    async pickChip(key) {
      requireNotStarted();
      if (state === 'ASK') {
        selectChip((messages[0] as Message).id, key);
        askClarify(findTheme(key).key);
      } else if (state === 'CLARIFY') {
        const lastId = (messages[messages.length - 1] as Message).id;
        selectChip(lastId, key);
        const pick: ClarifyPick = key === 'turtle' || key === 'coral' ? key : 'none';
        revealPlan(pick);
      }
      return toResult();
    },

    async edit(text) {
      requireNotStarted();
      if (state !== 'PLAN' || !plan) return toResult();
      pushUserMessage(text, false);
      // Mock edit: the typed text becomes the new place; `anchorPhrase` never changes —
      // it is a fixed personal watermark (DESIGN §3.3, mirrors engine test F5).
      plan = { ...plan, theme: { ...plan.theme, place: text } };
      messages = [...messages, { id: nextId('ai'), kind: 'ai', text: translate(lang, 'advisor.editAck'), at: now(), planCompact: true }];
      return toResult();
    },

    start() {
      if (!plan) throw new Error('advisor: start() requires a plan');
      state = 'STARTED';
      return toResult();
    },
  };

  return adapter;
}

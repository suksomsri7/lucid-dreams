/**
 * UI-side shape of the dream advisor room (WO L1.4). Every field here is a *reduced*
 * mirror of the real contract the engine builder is writing in a parallel worktree
 * (`scripts/qc-tests/L1.5-advisor.test.ts`'s header comment — read, never imported: this
 * WO must not touch `packages/engine`). `DreamPlan` below matches that file's
 * `DreamPlanSchema` shape field-for-field so `adapter.ts`'s mock data and, later,
 * L1.5's real `createAdvisor` output are interchangeable without this file changing.
 *
 * `Message` is this screen's own vocabulary (`kind: 'ai' | 'me'`), not the engine's
 * (`role: 'user' | 'assistant'`) — `useAdvisor.ts` is the only place that has to know
 * both shapes exist.
 */

export type MessageKind = 'ai' | 'me';

export interface MessageChip {
  key: string;
  label: string;
  /** This chip is the one the user already picked — the row becomes inert once any chip in it is. */
  selected?: boolean;
}

export interface Message {
  id: string;
  kind: MessageKind;
  text: string;
  /** Set on a `'me'` bubble built from a transcribed voice message (DESIGN §3.3). */
  fromVoice?: boolean;
  at: string;
  /** Theme row (first AI message) or a clarify question's options — rendered under the bubble. */
  chips?: MessageChip[];
  /** This message is followed by the compact plan card + "เริ่มคืนนี้" button. */
  planCompact?: boolean;
}

export type ThemeKey = 'whale' | 'fly' | 'space' | 'sea' | 'oldtown' | 'other';

export type AmbienceKey = 'underwater' | 'wind' | 'rain' | 'silence';

export interface DreamPlanTheme {
  emoji: string;
  titleTh: string;
  titleEn: string;
  place: string | null;
}

export interface DreamPlanClarify {
  question: string;
  options: string[];
}

/** Mirrors `packages/engine`'s future `DreamPlan` (L1.5) — see the file header above. */
export interface DreamPlan {
  theme: DreamPlanTheme;
  seedLines: [string, string];
  anchorPhrase: string;
  ambienceKey: AmbienceKey;
  clarify?: DreamPlanClarify | null;
}

export type AdvisorState = 'ASK' | 'CLARIFY' | 'PLAN' | 'EDIT' | 'STARTED';

export interface AdvisorResult {
  state: AdvisorState;
  plan?: DreamPlan | null;
  clarify?: DreamPlanClarify | null;
}

/**
 * UI-side adapter interface — the shape `useAdvisor.ts` drives and the shape
 * `createMockAdvisorAdapter` (this WO) and the real engine-backed adapter (wired at the
 * L1.5 merge, per the WO) both implement. Method names and the state machine
 * (`ASK → CLARIFY(≤1) → PLAN → EDIT`, `start()` only from `PLAN`) mirror
 * `createAdvisor()` in `scripts/qc-tests/L1.5-advisor.test.ts`.
 */
export interface AdvisorAdapter {
  readonly state: AdvisorState;
  readonly plan: DreamPlan | null;
  readonly messages: Message[];
  readonly clarifyCount: number;
  say(text: string, options?: { fromVoice?: boolean }): Promise<AdvisorResult>;
  pickChip(key: string): Promise<AdvisorResult>;
  edit(text: string): Promise<AdvisorResult>;
  /** Synchronous, like the engine's — throws if there is no plan yet. */
  start(): AdvisorResult;
}

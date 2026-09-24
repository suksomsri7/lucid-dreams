/**
 * React glue between `AdvisorRoom.tsx` and the `AdvisorAdapter` (`adapter.ts`). Owns the
 * one adapter instance for the room's lifetime and re-renders the screen after every
 * interaction — the adapter itself is a plain object (mutable getters), not a React
 * store, so this hook is the only place that turns "an async method resolved" into
 * "the screen should now show something different".
 */

import { useMemo, useRef, useState } from 'react';

import { advisorFixtureRequested } from '../dev/fixtures';
import type { Locale } from '../i18n';
import { saveTonightPlan } from '../store/night';
import { createEngineAdvisorAdapter, createMockAdvisorAdapter } from './adapter';
import type { AdvisorAdapter, AdvisorState, DreamPlan, Message } from './types';

export interface UseAdvisorResult {
  state: AdvisorState;
  plan: DreamPlan | null;
  messages: Message[];
  clarifyCount: number;
  say: (text: string, options?: { fromVoice?: boolean }) => Promise<void>;
  pickChip: (key: string) => Promise<void>;
  edit: (text: string) => Promise<void>;
  start: () => void;
}

interface Snapshot {
  state: AdvisorState;
  plan: DreamPlan | null;
  messages: Message[];
  clarifyCount: number;
}

function snapshotOf(adapter: AdvisorAdapter): Snapshot {
  return { state: adapter.state, plan: adapter.plan, messages: adapter.messages, clarifyCount: adapter.clarifyCount };
}

/**
 * `lang` only seeds the adapter the *first* time this hook mounts for a given room —
 * the mock's copy is baked into each message as it is created (same as a real advisor
 * reply would be), so switching the language mid-conversation does not retranslate
 * history already on screen. This matches how a live AI reply works (it answered once,
 * in the language asked at the time) and keeps the adapter's message log immutable
 * after the fact — see `ledger/wo-notes/L1.4.md` for the alternative considered.
 */
export function useAdvisor(lang: Locale): UseAdvisorResult {
  const adapterRef = useRef<AdvisorAdapter | null>(null);
  if (adapterRef.current === null) {
    // `createEngineAdvisorAdapter` (WO L1.7ui) is the default from here on — the real
    // `packages/engine` state machine talking to `apps/api`'s `/ai/plan` (and, offline
    // or unreachable, the engine's own on-device fallback plan; see `advisor.ts`'s "it
    // never throws" invariant). The mock stays reachable behind `?fixture=advisor-plan`
    // only, for QC screenshots that need the exact scripted whale-shark/turtle
    // conversation instantly and deterministically — a live/offline-fallback plan would
    // still render *something*, just not byte-for-byte the mockup's conversation.
    adapterRef.current =
      advisorFixtureRequested() === 'advisor-plan'
        ? createMockAdvisorAdapter(lang, { seed: 'plan' })
        : createEngineAdvisorAdapter(lang);
  }
  const adapter = adapterRef.current;

  const [snapshot, setSnapshot] = useState<Snapshot>(() => snapshotOf(adapter));

  const actions = useMemo(
    () => ({
      say: async (text: string, options?: { fromVoice?: boolean }) => {
        await adapter.say(text, options);
        setSnapshot(snapshotOf(adapter));
      },
      pickChip: async (key: string) => {
        await adapter.pickChip(key);
        setSnapshot(snapshotOf(adapter));
      },
      edit: async (text: string) => {
        await adapter.edit(text);
        setSnapshot(snapshotOf(adapter));
      },
      start: () => {
        adapter.start();
        // Hand-off to `app/plan/*` (WO L1.7ui): those are separate routes, not this
        // component, so the plan the advisor just built has to cross through a shared
        // store rather than React state/props (`src/store/night.ts`'s header explains
        // why). Both adapters produce the same `DreamPlan` shape, so this line does not
        // care which one is active.
        if (adapter.plan) saveTonightPlan(adapter.plan, lang);
        setSnapshot(snapshotOf(adapter));
      },
    }),
    [adapter],
  );

  return { ...snapshot, ...actions };
}

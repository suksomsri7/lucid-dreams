/**
 * React glue between `AdvisorRoom.tsx` and the `AdvisorAdapter` (`adapter.ts`). Owns the
 * one adapter instance for the room's lifetime and re-renders the screen after every
 * interaction — the adapter itself is a plain object (mutable getters), not a React
 * store, so this hook is the only place that turns "an async method resolved" into
 * "the screen should now show something different".
 */

import { useMemo, useRef, useState } from 'react';

import { advisorFixtureRequested, advisorThinkingFixtureRequested } from '../dev/fixtures';
import type { Locale } from '../i18n';
import { saveTonightPlan } from '../store/night';
import { createEngineAdvisorAdapter, createMockAdvisorAdapter } from './adapter';
import type { AdvisorAdapter, AdvisorState, DreamPlan, Message } from './types';

export interface UseAdvisorResult {
  state: AdvisorState;
  plan: DreamPlan | null;
  messages: Message[];
  clarifyCount: number;
  /**
   * WO L3.10 (R1 hotfix #2): true from the moment `say`/`pickChip`/`edit` is called until
   * its reply lands. `AdvisorRoom.tsx` renders `TypingBubble` and disables every chip, the
   * composer's send button and the mic while this is true — the R1 bug this closes is a
   * ~4 s AI reply with *no* on-screen signal, which read as "nothing happened" and got
   * tapped repeatedly.
   */
  busy: boolean;
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
 * `?fixture=advisor-thinking` (`src/dev/fixtures.ts`) freezes the room's very first
 * message — the intro bubble + 6 theme chips — with the first real theme chip marked
 * `selected` (as if it had just been tapped) so the QC screenshot can show exactly the
 * moment the R1 report complained about: a chip picked, no plan yet, and (now) the
 * typing bubble on screen instead of silence.
 */
function withFirstChipSelected(snapshot: Snapshot): Snapshot {
  const [first, ...rest] = snapshot.messages;
  if (!first?.chips) return snapshot;
  const pickIndex = first.chips.findIndex((chip) => chip.key !== 'other');
  if (pickIndex < 0) return snapshot;
  const chips = first.chips.map((chip, index) => ({ ...chip, selected: index === pickIndex }));
  return { ...snapshot, messages: [{ ...first, chips }, ...rest] };
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
  const thinkingFixture = advisorThinkingFixtureRequested();
  if (adapterRef.current === null) {
    // `createEngineAdvisorAdapter` (WO L1.7ui) is the default from here on — the real
    // `packages/engine` state machine talking to `apps/api`'s `/ai/plan` (and, offline
    // or unreachable, the engine's own on-device fallback plan; see `advisor.ts`'s "it
    // never throws" invariant). The mock stays reachable behind `?fixture=advisor-plan`
    // only, for QC screenshots that need the exact scripted whale-shark/turtle
    // conversation instantly and deterministically — a live/offline-fallback plan would
    // still render *something*, just not byte-for-byte the mockup's conversation.
    // `?fixture=advisor-thinking` (WO L3.10) also needs the deterministic mock — its own
    // default `ASK` state (intro + 6 chips) is exactly the frame it freezes.
    adapterRef.current =
      advisorFixtureRequested() === 'advisor-plan' || thinkingFixture
        ? createMockAdvisorAdapter(lang, advisorFixtureRequested() === 'advisor-plan' ? { seed: 'plan' } : {})
        : createEngineAdvisorAdapter(lang);
  }
  const adapter = adapterRef.current;

  const [snapshot, setSnapshot] = useState<Snapshot>(() => {
    const base = snapshotOf(adapter);
    return thinkingFixture ? withFirstChipSelected(base) : base;
  });
  // `busyRef` is the actual re-entrancy guard (checked synchronously, before any state
  // update lands) — `busy` (React state) is only what drives the UI. The R1 bug tapped a
  // chip up to 9 times inside the ~4 s a reply takes; without a synchronous check here,
  // every one of those taps would start its own `adapter.pickChip` call and each would
  // eventually push its own user bubble.
  const busyRef = useRef(thinkingFixture);
  const [busy, setBusy] = useState(thinkingFixture);

  const actions = useMemo(
    () => ({
      say: async (text: string, options?: { fromVoice?: boolean }) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
          await adapter.say(text, options);
        } finally {
          busyRef.current = false;
          setBusy(false);
          setSnapshot(snapshotOf(adapter));
        }
      },
      pickChip: async (key: string) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        // `adapter.pickChip` marks the tapped chip `selected: true` synchronously, before
        // its own first `await` (`adapter.ts`'s mock and engine adapters both do this now)
        // — capturing the promise separately and snapshotting right after starting it (not
        // waiting for it to resolve) is what makes the chip lock land on screen instantly
        // instead of ~4 s later with the reply.
        const pending = adapter.pickChip(key);
        setSnapshot(snapshotOf(adapter));
        try {
          await pending;
        } finally {
          busyRef.current = false;
          setBusy(false);
          setSnapshot(snapshotOf(adapter));
        }
      },
      edit: async (text: string) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
          await adapter.edit(text);
        } finally {
          busyRef.current = false;
          setBusy(false);
          setSnapshot(snapshotOf(adapter));
        }
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
    [adapter, lang],
  );

  return { ...snapshot, ...actions, busy };
}

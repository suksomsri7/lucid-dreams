/**
 * Tonight's plan + pre-sleep progress, persisted locally (WO L1.7ui · DESIGN §3.2 step 3).
 *
 * `AdvisorRoom.tsx`'s "start tonight" button calls `advisor.start()` and then
 * `router.push('/plan')` — a **new** route in the expo-router stack, not the same
 * component, so the plan the advisor just built (held in `useAdvisor`'s adapter ref,
 * private to that screen) is not reachable from `app/plan/*` any other way. This store
 * is the hand-off: `useAdvisor.ts`'s `start` action calls {@link saveTonightPlan} the
 * moment a plan is started, and every `app/plan/*` screen reads it back with
 * {@link useNightState}.
 *
 * Also owns the two other things the pre-start flow needs across screens that do not
 * share a parent component: the lazily-created `NightSession` id (`src/data/night.ts`)
 * and the two `EarTest` rows, so `evaluateReadiness` on `devices.tsx` can see a pass
 * recorded on `ear-left.tsx` a screen earlier. Same AsyncStorage-backed
 * `useSyncExternalStore` shape as `src/store/onboarding.ts` — read that file first if
 * this one is confusing.
 */

import { useSyncExternalStore } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AnchorLang, DreamPlan, EarSide, EarTest } from '@lucid/engine';

import { ensureNightSession, saveEarTestToRepo } from '../data/night';

const STORAGE_KEY = 'lucid.night.v1';

export interface NightState {
  plan: DreamPlan | null;
  lang: AnchorLang | null;
  sessionId: string | null;
  earTests: { L: EarTest | null; R: EarTest | null };
}

const DEFAULT_STATE: NightState = {
  plan: null,
  lang: null,
  sessionId: null,
  earTests: { L: null, R: null },
};

let state: NightState = DEFAULT_STATE;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
}

async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NightState>;
      state = {
        ...DEFAULT_STATE,
        ...parsed,
        earTests: { ...DEFAULT_STATE.earTests, ...parsed.earTests },
      };
    }
  } catch {
    // Corrupt or missing storage — keep the defaults, do not throw (this runs at module load).
  } finally {
    hydrated = true;
    emit();
  }
}

void hydrate();

export function getNightState(): NightState {
  return state;
}

export function isNightStateHydrated(): boolean {
  return hydrated;
}

/**
 * A fresh plan means a fresh night: any ear tests and session id from a previous plan
 * (edited theme, "same dream as last night" pick, etc.) must not leak forward and make
 * `evaluateReadiness` think tonight's headphones were already proven.
 */
export function saveTonightPlan(plan: DreamPlan, lang: AnchorLang): void {
  state = { plan, lang, sessionId: null, earTests: { L: null, R: null } };
  emit();
  persist();
}

export function clearNightPlan(): void {
  state = DEFAULT_STATE;
  emit();
  persist();
}

/**
 * Record a passed ear test: updates local state immediately (so `devices.tsx`'s/`ear-
 * right.tsx`'s `evaluateReadiness` call sees it on the very next render) and writes the
 * row to the database in the background. The DB write never blocks or fails the UI —
 * `earTests` in AsyncStorage is the source of truth for tonight's readiness gate either
 * way; the DB row is the permanent record `nightReport()` reads later.
 */
export function recordEarTest(entry: EarTest): void {
  const side: EarSide = entry.side;
  state = { ...state, earTests: { ...state.earTests, [side]: entry } };
  emit();
  persist();

  const plan = state.plan;
  if (plan === null) return;
  void (async () => {
    try {
      const sessionId = await ensureNightSession(state.sessionId, plan, new Date().toISOString());
      if (state.sessionId !== sessionId) {
        state = { ...state, sessionId };
        emit();
        persist();
      }
      await saveEarTestToRepo(sessionId, entry);
    } catch {
      // Best-effort: the local `earTests` state above already unblocked the UI. A
      // failed DB write here (e.g. web, or a first-launch migration race) is not the
      // user's problem tonight — TODO(L1.8/L2.x): surface this in diagnostics.
    }
  })();
}

/** Re-renders whenever the plan, session id, ear tests or the hydration flag changes. */
export function useNightState(): NightState & { hydrated: boolean } {
  const snapshot = useSyncExternalStore(subscribe, getNightState, getNightState);
  const hydratedFlag = useSyncExternalStore(subscribe, isNightStateHydrated, isNightStateHydrated);
  return { ...snapshot, hydrated: hydratedFlag };
}

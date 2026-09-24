/**
 * Onboarding + consent, persisted locally (DESIGN §4-01 · APP-RUN §2 L1.3).
 *
 * `hasOnboarded` gates the root redirect (`app/_layout.tsx`) so onboarding is shown
 * exactly once. `consentSafety` records *that* the user ticked "รับทราบ", *which*
 * version of the safety notes they accepted, and *when* — required so a future policy
 * change can re-ask only the users who accepted an older version (oracle O2.2).
 *
 * `consentAi` (DESIGN §2 rule 6: "ส่งขึ้นเซิร์ฟเวอร์เฉพาะข้อความ … ปิดได้") defaults to
 * `false` here — opt-in, never assumed. There is **no toggle for it on the welcome
 * screen**: mockup `01-onboarding.png`/`.body.html` has no such control (verified by
 * reading the mockup source — see `ledger/wo-notes/L1.3.md` disagreement N-1), so adding
 * one would violate the "UI must match the mockup exactly" rule (APP-RUN §0.2 rule 9)
 * on the strength of a WO line that the actual design file does not back up. The state
 * still exists end-to-end (default off) so the setting has somewhere to live once a
 * later WO (Settings, L3.6) puts a real switch on it.
 *
 * TODO(L1.8): mirror this into `UserProfile.consentAi` / `.consentSafety` once
 * `packages/data`'s repo layer exists — this file must not import from `packages/data`
 * (out of scope for L1.3, and that package is off-limits to this WO).
 */

import { useSyncExternalStore } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

export const POLICY_VERSION = 1;

export interface ConsentSafety {
  accepted: boolean;
  policyVersion: number;
  /** ISO-8601, `null` until accepted once. */
  acceptedAt: string | null;
}

export interface OnboardingState {
  hasOnboarded: boolean;
  consentSafety: ConsentSafety;
  consentAi: boolean;
}

const STORAGE_KEY = 'lucid.onboarding.v1';

const DEFAULT_STATE: OnboardingState = {
  hasOnboarded: false,
  consentSafety: { accepted: false, policyVersion: POLICY_VERSION, acceptedAt: null },
  consentAi: false,
};

let state: OnboardingState = DEFAULT_STATE;
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
      const parsed = JSON.parse(raw) as Partial<OnboardingState>;
      state = {
        ...DEFAULT_STATE,
        ...parsed,
        consentSafety: { ...DEFAULT_STATE.consentSafety, ...parsed.consentSafety },
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

export function getOnboardingState(): OnboardingState {
  return state;
}

export function isOnboardingHydrated(): boolean {
  return hydrated;
}

export function acceptSafetyConsent(nowIso: string = new Date().toISOString()): void {
  state = {
    ...state,
    consentSafety: { accepted: true, policyVersion: POLICY_VERSION, acceptedAt: nowIso },
  };
  emit();
  persist();
}

export function setConsentAi(value: boolean): void {
  if (state.consentAi === value) return;
  state = { ...state, consentAi: value };
  emit();
  persist();
}

export function completeOnboarding(): void {
  if (state.hasOnboarded) return;
  state = { ...state, hasOnboarded: true };
  emit();
  persist();
}

/** Test seam — mirrors `platform/index.ts`'s `__setPlatformForTests`. Never called in app code. */
export function __resetOnboardingStateForTests(): void {
  state = DEFAULT_STATE;
  hydrated = true;
  emit();
}

/** Re-renders whenever the state or the hydration flag changes. */
export function useOnboardingState(): OnboardingState & { hydrated: boolean } {
  const snapshot = useSyncExternalStore(subscribe, getOnboardingState, getOnboardingState);
  const hydratedFlag = useSyncExternalStore(subscribe, isOnboardingHydrated, isOnboardingHydrated);
  return { ...snapshot, hydrated: hydratedFlag };
}

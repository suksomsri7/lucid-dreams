/**
 * The app's only door to `apps/api` (WO L1.7ui: wiring the real dream advisor).
 * `apps/api/src/server.ts` is off-limits to this WO — everything below is read from
 * its actual route contract (`DeviceBodySchema`/`PlanBodySchema`, the bearer-token
 * guard) rather than guessed.
 *
 * One device token per install, requested once and kept in `AsyncStorage` (not
 * SecureStore — see the disagreement note in `ledger/wo-notes/L1.7ui.md`: SecureStore
 * has no web implementation and this module must also work, harmlessly, in the web QC
 * bundle where `?fixture=` always wins before any of this runs). The token is not a
 * secret with blast radius beyond "someone can call `/ai/plan` as this install" — the
 * real secrets (API keys) never leave the server (DESIGN §0.5 S1/S2).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { PlanRequest } from '@lucid/engine';

const DEVICE_TOKEN_KEY = 'lucid.device.token';

function apiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  return extra?.apiBaseUrl ?? 'http://localhost:8787';
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.1.0';
}

function platformName(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
}

/** In-memory cache on top of `AsyncStorage` so a chatty conversation (several `/ai/plan`
 * calls a minute) does not round-trip storage for every single request. */
let cachedToken: string | null = null;

async function registerDevice(): Promise<string> {
  const response = await fetch(`${apiBaseUrl()}/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: platformName(), appVersion: appVersion() }),
  });
  if (!response.ok) throw new Error(`device registration failed: HTTP ${response.status}`);
  const data = (await response.json()) as { deviceId: string; token: string };
  return data.token;
}

async function getDeviceToken(forceFresh = false): Promise<string> {
  if (!forceFresh && cachedToken !== null) return cachedToken;
  if (!forceFresh) {
    const stored = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
    if (stored !== null) {
      cachedToken = stored;
      return stored;
    }
  }
  const token = await registerDevice();
  cachedToken = token;
  await AsyncStorage.setItem(DEVICE_TOKEN_KEY, token).catch(() => undefined);
  return token;
}

async function requestPlan(request: PlanRequest, token: string): Promise<Response> {
  return fetch(`${apiBaseUrl()}/ai/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
}

/**
 * `PlanProvider.plan()` for the real advisor (`createEngineAdvisorAdapter`, `src/
 * advisor/adapter.ts`). Returns *unknown* — same contract as every `PlanProvider`
 * (`packages/engine/src/advisor.ts`'s header: "never trusted") — `parseDreamPlan`
 * validates it before anything on screen sees it. Throws on any failure (network,
 * non-2xx, revoked token after one retry); `createAdvisor()`'s own retry/offline-
 * fallback policy is what turns that into a plan the user can still use tonight.
 */
export async function requestDreamPlan(request: PlanRequest): Promise<unknown> {
  const token = await getDeviceToken();
  let response = await requestPlan(request, token);

  if (response.status === 401) {
    // The stored token was revoked or never valid — register a fresh one and retry
    // exactly once (mirrors the engine's own "retry once, then give up" shape).
    const fresh = await getDeviceToken(true);
    response = await requestPlan(request, fresh);
  }

  if (!response.ok) throw new Error(`plan request failed: HTTP ${response.status}`);
  return response.json();
}

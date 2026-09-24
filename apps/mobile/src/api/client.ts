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

// ---------------------------------------------------------------------------
// WO L3.1 — the client half of `/ai/score` (DESIGN §6 · APP-RUN §2 L3.2)
// ---------------------------------------------------------------------------

/**
 * The request body the future `apps/api` `/ai/score` route (WO L3.2, off-limits to this
 * WO) is documented to accept — `transcript`/`theme`/`seedLines`/`answers`, mirroring the
 * `/ai/plan` body's own shape (`PlanBodySchema` in `apps/api/src/server.ts`) closely
 * enough that L3.2 can lift this type wholesale into a zod schema rather than invent a
 * second contract. See `ledger/wo-notes/L3.1.md` §route contract for the full write-up.
 */
export interface ScoreRequest {
  transcript: string;
  theme: { emoji: string; titleTh: string; titleEn: string; place: string | null };
  seedLines: [string, string];
  answers: {
    dreamed: number | null;
    themeMatchUser: number | null;
    lucid: 'YES' | 'NO' | 'UNSURE' | null;
    sleepQuality: number | null;
    cueWoke: boolean | null;
  };
  lang: 'th' | 'en';
}

async function requestScore(request: ScoreRequest, token: string): Promise<Response> {
  return fetch(`${apiBaseUrl()}/ai/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
}

/**
 * Unlike {@link requestDreamPlan}, this **never throws** — `/ai/score` does not exist on
 * `apps/api` yet (L3.2 builds the server side; this WO only wires the phone's half), so
 * every call fails today, and DESIGN §6 is explicit about what a failure means: no score
 * on — fall back to the user's own score alone (schema-broken/unreachable/501/404 all
 * read the same way), not a crashed morning screen. `src/api/score.ts#requestAiScore` is the only
 * caller and is what actually gates this on `consentAi` — this function itself has no
 * opinion on consent, same layering as `requestDreamPlan` having no opinion on offline
 * fallback (that is `createAdvisor()`'s job one layer up).
 */
export async function postScore(request: ScoreRequest): Promise<unknown | null> {
  try {
    const token = await getDeviceToken();
    let response = await requestScore(request, token);
    if (response.status === 401) {
      const fresh = await getDeviceToken(true);
      response = await requestScore(request, fresh);
    }
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WO L3.6 — "delete everything" (§0.5 S4: the server half of it, `DELETE /device`)
// ---------------------------------------------------------------------------

/**
 * The last step of Settings › ลบทั้งหมด (mockup 09, DESIGN §7's own note: "ลบได้ทั้งหมด
 * ในตั้งค่า"). This WO cannot add the actual `DELETE /device` route (`apps/api` is
 * off-limits) — it only has to exist on the server for this call to matter; until then
 * every response the server could plausibly give (404 the route isn't built yet, 401 the
 * token was already gone, network failure) all mean the same thing here: **the local
 * wipe must proceed regardless** (`settings.tsx`'s own delete flow never awaits this for
 * its success/failure, same "never blocks on the network" policy `requestAiScore`/
 * `postScore` already use). No fresh-token retry on 401 like the two calls above — a 401
 * here means the account is already gone server-side, which is exactly the state being
 * asked for.
 */
export async function deleteDevice(): Promise<void> {
  try {
    const token = await getDeviceToken();
    await fetch(`${apiBaseUrl()}/device`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    // Best-effort — see the doc comment above.
  } finally {
    cachedToken = null;
    await AsyncStorage.removeItem(DEVICE_TOKEN_KEY).catch(() => undefined);
  }
}

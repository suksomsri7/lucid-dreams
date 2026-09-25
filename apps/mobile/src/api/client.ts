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
 * The last step of Settings › "Delete all" (mockup 09, DESIGN §7's own note: "everything
 * can be deleted in Settings"). This WO cannot add the actual `DELETE /device` route (`apps/api` is
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

// ---------------------------------------------------------------------------
// WO L3.8 — the full anchor file (`POST /ai/anchor`: the bell **and** the whisper)
// ---------------------------------------------------------------------------

/** How long the phone waits for `/ai/anchor` before giving up (a cold MISS costs ~4 s of ffmpeg). */
export const ANCHOR_AUDIO_TIMEOUT_MS = 15000;

export interface AnchorAudioRequest {
  /** `getAnchorSeed()` — the per-install seed the server folds into `makeSignature`. */
  seed: string;
  lang: 'th' | 'en';
}

/**
 * What the caller needs in order to decide whether these bytes may be kept: the body plus
 * the three headers `/ai/anchor` answers with (`apps/api/src/server.ts`'s `headers()`).
 * `hash` is the server's own `makeSignature(seed, lang).hash` — `src/audio/anchorRemote.ts`
 * compares it with the signature it asked for, so a file built from someone else's seed (or
 * from a server whose signature maths has moved on) is dropped instead of cached forever.
 */
export type AnchorAudioResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string | null;
      hash: string | null;
      cache: string | null;
      notes: string | null;
      /** Wall-clock milliseconds of the whole call, for the R1 note's "first download" number. */
      elapsedMs: number;
    }
  | { ok: false; status: number | null; detail: string };

async function requestAnchorAudio(
  request: AnchorAudioRequest,
  token: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${apiBaseUrl()}/ai/anchor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
    signal,
  });
}

/**
 * Download the user's own anchor mp3 (bell + "You are dreaming.").
 *
 * Like {@link postScore} and {@link deleteDevice} — and unlike {@link requestDreamPlan} — this
 * **never throws**: the only caller is a best-effort prefetch/fallback path
 * (`src/audio/anchorRemote.ts`), and every possible failure means the same thing to it, namely
 * "tonight is bell-only". The 15 s `AbortController` timeout is the point of the whole
 * function: `ensureFullAnchorUri` can be reached from `playAnchorOnce`, i.e. from a night cue at
 * 3 a.m. with no signal, and a `fetch` with no timeout there would hang that cue forever.
 * A 401 re-registers the device and retries exactly once, same shape as the two calls above.
 */
export async function fetchAnchorAudio(
  request: AnchorAudioRequest,
  timeoutMs: number = ANCHOR_AUDIO_TIMEOUT_MS,
): Promise<AnchorAudioResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await getDeviceToken();
    let response = await requestAnchorAudio(request, token, controller.signal);
    if (response.status === 401) {
      const fresh = await getDeviceToken(true);
      response = await requestAnchorAudio(request, fresh, controller.signal);
    }
    if (!response.ok) return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
    const buffer = await response.arrayBuffer();
    return {
      ok: true,
      bytes: new Uint8Array(buffer),
      contentType: response.headers.get('content-type'),
      hash: response.headers.get('x-anchor-hash'),
      cache: response.headers.get('x-cache'),
      notes: response.headers.get('x-anchor-notes'),
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, detail };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// WO L3.14 — one spoken seed line (`POST /ai/tts`: George whispering a sentence)
// ---------------------------------------------------------------------------

/**
 * Same budget as {@link ANCHOR_AUDIO_TIMEOUT_MS} and for the same reason: a cold MISS costs the
 * server one vendor render (~4 s measured on 25 Sep 2026); a HIT answers in well under a second.
 */
export const TTS_AUDIO_TIMEOUT_MS = 15000;

export interface TtsAudioRequest {
  /** One sentence. `apps/api`'s `TtsBodySchema` caps it at 120 characters (`TTS_MAX_TEXT`). */
  text: string;
  lang: 'th' | 'en';
}

export type TtsAudioResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string | null;
      /** `HIT`/`MISS` — the R1 note's "was the sentence already warm?" number. */
      cache: string | null;
      elapsedMs: number;
    }
  | { ok: false; status: number | null; detail: string };

async function requestTts(
  request: TtsAudioRequest,
  token: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${apiBaseUrl()}/ai/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    // `voice` is a `z.literal('whisper')` on the server — there is no voice picker in the app
    // (DESIGN §2 principle 3), so it is hard-coded here rather than passed in by the caller.
    body: JSON.stringify({ text: request.text, lang: request.lang, voice: 'whisper' }),
    signal,
  });
}

/**
 * Download the whispered mp3 of one sentence.
 *
 * Same policy as {@link fetchAnchorAudio}: **never throws**, hard `AbortController` timeout, one
 * fresh-token retry on 401. The only caller is `src/audio/seedRemote.ts`, whose whole contract is
 * "a sentence the phone could not fetch simply does not get spoken tonight" — so every failure
 * (429 rate limit, 501 no TTS provider configured, 400 too long, no signal) reads the same way.
 */
export async function fetchTtsAudio(
  request: TtsAudioRequest,
  timeoutMs: number = TTS_AUDIO_TIMEOUT_MS,
): Promise<TtsAudioResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await getDeviceToken();
    let response = await requestTts(request, token, controller.signal);
    if (response.status === 401) {
      const fresh = await getDeviceToken(true);
      response = await requestTts(request, fresh, controller.signal);
    }
    if (!response.ok) return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
    const buffer = await response.arrayBuffer();
    return {
      ok: true,
      bytes: new Uint8Array(buffer),
      contentType: response.headers.get('content-type'),
      cache: response.headers.get('x-cache'),
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, detail };
  } finally {
    clearTimeout(timer);
  }
}

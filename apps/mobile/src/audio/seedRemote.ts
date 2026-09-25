/**
 * The **spoken** seed lines (WO L3.14): the two sentences that plant tonight's image, in
 * George's whisper, at minute 3 and minute 8 of the night.
 *
 * The engine has emitted `WHISPER_SEED` since L2.6 and `src/night/session.ts` has written the
 * database row since L2.8 — but the sound itself was the debt `src/audio/anchor.ts`'s header has
 * carried since L1.7ui: a seed line is arbitrary prose, so unlike the anchor bell it cannot be
 * rendered from maths on the phone. It is vendor TTS, cached per sentence by `apps/api`
 * (`POST /ai/tts` → `200 audio/mpeg`, ~75 KB, ~4.5 s of audio) and cached again as a file here so
 * that the night itself never depends on the network.
 *
 * The rules are `anchorRemote.ts`'s rules, with one difference:
 *
 *  1. **It can never delay a night.** Every path resolves to `null` instead of throwing, the
 *     network call has a 15 s hard timeout (`fetchTtsAudio`), and the caller treats `null` as
 *     "stay silent, record `played: false`". A sleeper who is drifting off at minute 3 must not
 *     get a sentence at minute 4 because a request was slow — `session.ts` caps its own wait at
 *     3 s on top of this.
 *  2. **No identity check.** Unlike the anchor there is nothing personal in these bytes (a seed
 *     line is the theme's prose, identical for every user who picked that theme — which is
 *     exactly why the server's cache key is `sha256(text|lang|voice)` and global), so there is no
 *     `x-anchor-hash` equivalent to verify. The cache key below is the same triple.
 *  3. **The voice on the server can change.** {@link SEED_AUDIO_VERSION} is part of the file
 *     name, so bumping it is the whole client-side migration the day the owner picks another
 *     voice — same contract as `FULL_ANCHOR_VERSION`.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { DreamPlan } from '../advisor/types';
import { fetchTtsAudio } from '../api/client';
import type { Locale } from '../i18n';

/**
 * Bumped whenever the *voice* behind `/ai/tts` changes. `george-1` = ElevenLabs "George" in the
 * `[whispers]` style, the voice the owner approved on 25 Sep 2026 (the same one the full anchor's
 * `george-2` file whispers "You are dreaming." in).
 */
export const SEED_AUDIO_VERSION = 'george-1';

/** `audio/mpeg` (possibly with parameters) is the only body this module will store. */
const AUDIO_MPEG = 'audio/mpeg';

/**
 * A real clip is ~75 KB; anything under 8 KB is not 4 s of speech but almost certainly a JSON
 * error body with a wrong content type. Same gate, same number as `anchorRemote.ts` — a bad file
 * written once would otherwise poison the cache until the next version bump.
 */
const MIN_PLAUSIBLE_BYTES = 8000;

/**
 * `apps/api`'s `TtsBodySchema` is `z.string().min(1).max(TTS_MAX_TEXT)` with `TTS_MAX_TEXT = 120`
 * (`apps/api/src/providers/tts.ts`). Every built-in theme's lines are ≤ 80 characters, but a line
 * the model wrote can be up to 200 (`dreamPlan.ts`'s `DreamPlanSchema`), and sending one of those
 * is a guaranteed 400. Checked here so the phone does not spend a round-trip to learn that.
 */
const MAX_SPOKEN_CHARS = 120;

/** `Paths.cache/seed/` — its own directory, so `clearAnchorCache()` does not touch these files. */
function seedCacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'seed');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * FNV-1a forwards + FNV-1a over the reversed string with a different offset basis — the identical
 * construction `packages/engine/src/signature.ts#stableHash` uses for the anchor's own file names
 * (it is not exported, and `packages/*` is off-limits to this WO, so it is repeated here).
 *
 * Not sha1: the app has no crypto dependency (`expo-crypto` is not installed and this WO may not
 * add one), and nothing here needs a cryptographic digest — this is a cache file name for public
 * prose, and two 32-bit halves make a collision between the handful of sentences one install ever
 * plays effectively impossible.
 */
function stableHash(payload: string): string {
  const fnv = (input: string, offsetBasis: number): string => {
    let hash = offsetBasis >>> 0;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  let reversed = '';
  for (let i = payload.length - 1; i >= 0; i -= 1) reversed += payload[i];
  return fnv(payload, 0x811c9dc5) + fnv(reversed, 0x9e3779b9);
}

/** `<hash(text|lang|version)>.mp3` — the same triple the server keys its own cache by. */
function seedFile(text: string, lang: Locale): File {
  return new File(seedCacheDirectory(), `${stableHash(`${text}|${lang}|${SEED_AUDIO_VERSION}`)}.mp3`);
}

/**
 * The whispered clip of one sentence, downloading it once if needed.
 *
 * Returns a `file://` URI, or `null` when the sentence has to stay silent tonight — every reason
 * is logged with `console.warn` and none of them throws:
 *
 *  - running on web (the QC export): no audio backend, so no reason to spend a server call;
 *  - `cachedOnly` and the file is not on disk (the night path, see rule 1);
 *  - a sentence longer than the server accepts (`MAX_SPOKEN_CHARS`);
 *  - no network / 429 rate limit / 501 no TTS provider configured / 15 s timeout;
 *  - a body that is not `audio/mpeg` or is implausibly short;
 *  - a filesystem that refuses the write.
 */
export async function ensureSeedLineUri(
  text: string,
  lang: Locale,
  options: { cachedOnly?: boolean } = {},
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const sentence = text.trim();
  if (sentence === '') return null;

  let file: File;
  try {
    file = seedFile(sentence, lang);
    if (file.exists) return file.uri;
    if (options.cachedOnly === true) return null;
  } catch (error) {
    // eslint-disable-next-line no-console -- never throw out of an audio path (rule 1)
    console.warn('[seed] cache unreadable', error);
    return null;
  }

  if (sentence.length > MAX_SPOKEN_CHARS) {
    // eslint-disable-next-line no-console -- the only signal R1 gets for "why was minute 3 silent"
    console.warn('[seed] line too long for /ai/tts', sentence.length);
    return null;
  }

  const result = await fetchTtsAudio({ text: sentence, lang });
  if (!result.ok) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[seed] /ai/tts did not answer with audio', result.status, result.detail);
    return null;
  }
  const contentType = result.contentType ?? '';
  if (!contentType.toLowerCase().includes(AUDIO_MPEG)) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[seed] /ai/tts answered a non-audio body', contentType);
    return null;
  }
  if (result.bytes.byteLength < MIN_PLAUSIBLE_BYTES) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[seed] /ai/tts body too short to be speech', result.bytes.byteLength);
    return null;
  }

  try {
    if (!file.exists) file.create();
    file.write(result.bytes);
  } catch (error) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[seed] could not write the seed line to the cache', error);
    return null;
  }

  // eslint-disable-next-line no-console -- one line per *download* (not per play): the R1 timing number
  console.log('[seed] line downloaded', {
    bytes: result.bytes.byteLength,
    ms: result.elapsedMs,
    cache: result.cache,
    lang,
  });
  return file.uri;
}

/** In-flight guard: three call sites fire this within seconds of each other ("Start tonight"). */
let inFlight: Promise<boolean> | null = null;

/**
 * Warm both of tonight's lines. `void prefetchSeedLines(plan, lang)` from `useAdvisor.start()`,
 * from `AdvisorRoom.handleStart` and one last time from `startNightSession` — the user is awake
 * and holding the phone at all three, which is the opposite of the situation at minute 3.
 *
 * Resolves `true` only when *both* files are on disk, which is what "the night can speak offline"
 * means. Never throws; the callers do not await it.
 */
export async function prefetchSeedLines(plan: DreamPlan, lang: Locale): Promise<boolean> {
  if (inFlight !== null) return inFlight;
  const run = (async (): Promise<boolean> => {
    try {
      let all = true;
      // Sequential on purpose: a cold pair is two vendor renders, and the server rate-limits per
      // device — two parallel MISSes buy ~4 s at the cost of a burst we have no reason to spend.
      for (const line of plan.seedLines) {
        const uri = await ensureSeedLineUri(line, lang);
        if (uri === null) all = false;
      }
      return all;
    } catch (error) {
      // eslint-disable-next-line no-console -- a prefetch must never surface to the UI (rule 1)
      console.warn('[seed] prefetch failed', error);
      return false;
    } finally {
      inFlight = null;
    }
  })();
  inFlight = run;
  return run;
}

/**
 * The **full** anchor (WO L3.8): the deep bell *and* the whispered "You are dreaming.".
 *
 * `src/audio/anchor.ts` renders only the bell — pure maths, offline, identical everywhere.
 * The whisper cannot be rendered on the phone: it is a vendor TTS clip that `apps/api` mixes
 * into the bell once per (seed, lang) and then serves from its own cache
 * (`POST /ai/anchor` → `200 audio/mpeg`, ~160 KB, 9.84 s, the sentence starting 2.6 s in).
 * Nothing in the app called that route until this file existed, which is why the first night
 * was bell-only — the debt `ledger/wo-notes/L1.7ui.md` carried and this module pays.
 *
 * Three rules shape everything below:
 *
 *  1. **It can never delay a night.** Every entry point resolves to `null` rather than
 *     throwing, the network call has a hard 15 s timeout (`fetchAnchorAudio`), and the caller
 *     (`player.ts#playAnchorOnce`) treats `null` as "play the bell WAV". A cue at 3 a.m. with
 *     no signal must sound, on time, whatever this module thinks.
 *  2. **A file is only kept if it is provably this user's.** The server answers
 *     `x-anchor-hash: makeSignature(seed, lang).hash`; if that does not equal the hash of the
 *     signature we asked about, the bytes are dropped. The anchor is a watermark
 *     (DESIGN-APP §2 principle 3) — playing somebody else's would be worse than playing none.
 *  3. **The voice on the server can change.** {@link FULL_ANCHOR_VERSION} is part of the cache
 *     file name, so the day the owner picks a different voice (this is already the second one —
 *     George, chosen 25 Sep 2026) bumping this constant is the whole client-side migration:
 *     old files stop being looked up and the next prefetch downloads the new sound.
 *
 * The cache lives in the same `Paths.cache/anchor/` directory `anchor.ts` uses, which is why
 * `clearAnchorCache()` (and therefore Settings › "reset watermark") already wipes these files
 * too; {@link clearFullAnchorCache} is the narrower, explicit version — it removes only the
 * downloaded mp3s and leaves the locally-rendered WAVs alone.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { AnchorLang, AnchorSignature } from '@lucid/engine';

import { fetchAnchorAudio } from '../api/client';
import { getLocale } from '../i18n';
import { buildAnchorSignature, getAnchorSeed } from './anchor';

/**
 * Bumped whenever the *sound* on the server changes (voice, mix levels, whisper timing) —
 * see rule 3 in the header. `george-1` = the v2-C bell + George whispering at normal speed
 * (owner decision 25 Sep 2026, server cache warmed the same day).
 */
export const FULL_ANCHOR_VERSION = 'george-1';

/** `audio/mpeg` (possibly with parameters) is the only body this module will store. */
const AUDIO_MPEG = 'audio/mpeg';

/**
 * Anything much smaller than the real file (~160 KB) is not a 9.84 s mp3 — most likely a JSON
 * error body served with the wrong content type. Cheap sanity gate before a write that would
 * otherwise poison the cache until the next version bump.
 */
const MIN_PLAUSIBLE_BYTES = 8000;

/** The same directory `src/audio/anchor.ts#anchorDirectory` uses — one anchor cache, two producers. */
function anchorCacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'anchor');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** `<hash>-<lang>-<version>.mp3` — hash and lang identify the user's sound, version the server's. */
function fullAnchorFileName(hash: string, lang: AnchorLang): string {
  return `${hash}-${lang}-${FULL_ANCHOR_VERSION}.mp3`;
}

function fullAnchorFile(signature: AnchorSignature, lang: AnchorLang): File {
  return new File(anchorCacheDirectory(), fullAnchorFileName(signature.hash, lang));
}

/**
 * The bell + whisper file for this signature, downloading it once if needed.
 *
 * Returns the `file://` URI, or `null` when tonight has to be bell-only — every reason for
 * `null` is logged with `console.warn` and none of them throws:
 *
 *  - running on web (the QC export): no audio backend and no reason to spend a server call;
 *  - no network / server unreachable / 429 rate limit / 501 no TTS provider configured;
 *  - a body that is not `audio/mpeg`, is implausibly short, or whose `x-anchor-hash` does not
 *    match `signature.hash` (see rule 2);
 *  - a filesystem that refuses the write.
 *
 * `lang` defaults to `signature.lang` on purpose: the server rebuilds the signature from
 * `(seed, lang)` before hashing it, so asking for a different language than the signature was
 * built with can only ever produce a hash mismatch and a wasted 4 s.
 */
export async function ensureFullAnchorUri(
  signature: AnchorSignature,
  lang: AnchorLang = signature.lang,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  let file: File;
  try {
    file = fullAnchorFile(signature, lang);
    if (file.exists) return file.uri;
  } catch (error) {
    // eslint-disable-next-line no-console -- never throw out of an audio path (WO L3.8 rule 1)
    console.warn('[anchor] full anchor cache unreadable', error);
    return null;
  }

  const result = await fetchAnchorAudio({ seed: signature.seed, lang });
  if (!result.ok) {
    // eslint-disable-next-line no-console -- the only signal R1 gets for "why bell-only tonight"
    console.warn('[anchor] /ai/anchor did not answer with audio', result.status, result.detail);
    return null;
  }

  const contentType = result.contentType ?? '';
  if (!contentType.toLowerCase().includes(AUDIO_MPEG)) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[anchor] /ai/anchor answered a non-audio body', contentType);
    return null;
  }
  if (result.hash !== signature.hash) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[anchor] x-anchor-hash mismatch — dropping the file', result.hash, signature.hash);
    return null;
  }
  if (result.bytes.byteLength < MIN_PLAUSIBLE_BYTES) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[anchor] /ai/anchor body too short to be the anchor', result.bytes.byteLength);
    return null;
  }

  try {
    if (!file.exists) file.create();
    file.write(result.bytes);
  } catch (error) {
    // eslint-disable-next-line no-console -- see above
    console.warn('[anchor] could not write the full anchor to the cache', error);
    return null;
  }

  // eslint-disable-next-line no-console -- one line per *download* (not per play): the R1 timing number
  console.log('[anchor] full anchor downloaded', {
    bytes: result.bytes.byteLength,
    ms: result.elapsedMs,
    cache: result.cache,
    lang,
  });
  return file.uri;
}

/** In-flight guard: three call sites fire this at once on a cold launch (intro + plan + devices). */
let inFlight: Promise<boolean> | null = null;

/**
 * Warm the cache in the background — `void prefetchFullAnchor()` from the intro overlay, from
 * "Start tonight" and from the device-check screen. Resolves `true` once the file is on disk.
 *
 * Deliberately builds its own signature from `getAnchorSeed()` + the current UI locale rather
 * than taking one as an argument: the callers are screens that have no signature in hand, and
 * this is exactly the pair `playBrandAnchor`/the night session use.
 */
export async function prefetchFullAnchor(): Promise<boolean> {
  if (inFlight !== null) return inFlight;
  const run = (async (): Promise<boolean> => {
    try {
      const seed = await getAnchorSeed();
      const lang = getLocale();
      const uri = await ensureFullAnchorUri(buildAnchorSignature(seed, lang), lang);
      return uri !== null;
    } catch (error) {
      // eslint-disable-next-line no-console -- a prefetch must never surface to the UI (rule 1)
      console.warn('[anchor] prefetch failed', error);
      return false;
    } finally {
      inFlight = null;
    }
  })();
  inFlight = run;
  return run;
}

/**
 * Delete every downloaded full anchor (`*-<version>.mp3` — and the other versions' files too:
 * a reset should not leave last voice's bytes behind either). Called by `resetAnchorSeed()` in
 * `anchor.ts`, where a new seed means a new watermark and every cached sound of the old one is
 * dead weight. Never throws: a cache that cannot be listed is not a reason to fail a reset.
 */
export function clearFullAnchorCache(): void {
  try {
    const dir = new Directory(Paths.cache, 'anchor');
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (entry.name.endsWith('.mp3')) entry.delete();
    }
  } catch (error) {
    // eslint-disable-next-line no-console -- best effort, same policy as `clearAnchorCache`
    console.warn('[anchor] could not clear the full anchor cache', error);
  }
}

/**
 * `'ready'` when tonight's cue can whisper offline, `'missing'` when it would be bell-only —
 * what the device-check screen's status row (`app/plan/devices.tsx`, mockup 04 frame b) reads.
 * Pure filesystem check, no network: on web it is always `'missing'`, which is the honest
 * answer there (the web build has no audio backend at all).
 */
export async function fullAnchorStatus(): Promise<'ready' | 'missing'> {
  if (Platform.OS === 'web') return 'missing';
  try {
    const seed = await getAnchorSeed();
    const lang = getLocale();
    return fullAnchorFile(buildAnchorSignature(seed, lang), lang).exists ? 'ready' : 'missing';
  } catch {
    return 'missing';
  }
}

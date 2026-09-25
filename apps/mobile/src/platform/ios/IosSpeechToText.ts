/**
 * Speech → text on iOS (WO L3.13 · DESIGN §2.6 · APP-RUN §0.5 S4), the real implementation of
 * `SpeechToText` (`../types.ts` §5). Until this work order the class with this name was a stub in
 * `IosPeripherals.ts` that answered `isAvailable() === false`, which is why both microphone
 * buttons in TestFlight build 2 (advisor room and morning room) only ever said "this device
 * cannot do that yet".
 *
 * Backed by `expo-speech-recognition` (Apple's `SFSpeechRecognizer` underneath), the module
 * DESIGN §8.2 named for this job. It is imported here and nowhere else: this file only ever
 * lands in the iOS bundle (`../native.ios.ts`), Android and web keep their own stubs
 * (APP-RUN §0.2 rule 8).
 *
 * Two things this class is careful about:
 *
 * 1. **On device when the device can** (S4: the dream audio should not leave the phone). Apple
 *    only does on-device recognition for locales whose model is installed; for everything else
 *    `SFSpeechRecognizer` sends audio to Apple's servers. Thai is exactly the case that can go
 *    either way depending on the phone, so the mode is decided per start and *logged* (mode
 *    only — never the words) so a support question can be answered with a fact.
 * 2. **A silent session is an error, not a result.** Apple ends a recognition task with no final
 *    result at all when it heard nothing; a caller that only listens for results would wait
 *    forever, so `end` without a final result is reported through `onError` as `NO_SPEECH`.
 */

import type { ExpoSpeechRecognitionModule as SpeechModule } from 'expo-speech-recognition';

/**
 * Loaded lazily and defensively (Fable, R1 review 2026-09-25): `expo-speech-recognition` calls
 * `requireNativeModule` when its JS is evaluated, which throws on a binary that does not ship
 * the native module. This file is also delivered by OTA to TestFlight build 2, which has no
 * such module — a static import would crash that build at launch. `null` ⇒ `isAvailable()`
 * is false and the mic shows "not on this device", exactly like the old stub.
 */
let speechModuleCache: typeof SpeechModule | null | undefined;
function loadSpeechModule(): typeof SpeechModule | null {
  if (speechModuleCache !== undefined) return speechModuleCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- guarded native load
    const mod = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: typeof SpeechModule };
    speechModuleCache = mod.ExpoSpeechRecognitionModule ?? null;
  } catch {
    speechModuleCache = null;
  }
  return speechModuleCache;
}
function speech(): typeof SpeechModule {
  const mod = loadSpeechModule();
  if (!mod) throw new Error('SPEECH_NATIVE_MODULE_MISSING');
  return mod;
}

import type { SpeechResult, SpeechToText, Unsubscribe } from '../types';

/** Where the audio is turned into text. Logged per session, never the transcript itself. */
type RecognitionMode = 'on-device' | 'server';

/** `th_TH`, `th-TH`, `TH-th` → `th-th`, so tags from Apple and from the UI compare equal. */
function normaliseTag(tag: string): string {
  return tag.replace(/_/g, '-').toLowerCase();
}

/** `no-speech` → `NO_SPEECH`: the `SpeechToText.onError` contract is a machine-readable string. */
function toErrorCode(code: string): string {
  return code.replace(/-/g, '_').toUpperCase();
}

export class IosSpeechToText implements SpeechToText {
  private readonly resultListeners = new Set<(result: SpeechResult) => void>();
  private readonly errorListeners = new Set<(error: string) => void>();
  /** Native subscriptions for the *current* session only — dropped on `end`/`stop`. */
  private nativeSubscriptions: { remove(): void }[] = [];
  private sawFinalResult = false;

  /**
   * `isRecognitionAvailable()` is `SFSpeechRecognizer.isAvailable` — false on a simulator with no
   * recogniser, on a device whose recognition service is temporarily down, and while Screen Time
   * restricts it. `getStateAsync()` adds the other half of the question: a recogniser that is
   * still tearing down the previous session ("stopping") would reject a new `start()` with
   * `busy`, and telling the caller "not now" is better than letting it show a live microphone
   * that is about to fail.
   */
  async isAvailable(): Promise<boolean> {
    if (!loadSpeechModule()) return false;
    try {
      if (!speech().isRecognitionAvailable()) return false;
      const state = await speech().getStateAsync();
      return state !== 'stopping';
    } catch {
      return false;
    }
  }

  /**
   * One prompt for both permissions iOS needs here: the microphone, and — because a
   * server-based recognition sends audio to Apple — speech recognition itself
   * (`requestPermissionsAsync` asks for both on iOS). `granted` is false both when the user
   * refuses and when Content & Privacy Restrictions forbid it; the caller turns either into
   * the same "open Settings" hint, which is the only route back from both.
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const response = await speech().requestPermissionsAsync();
      return response.granted;
    } catch {
      return false;
    }
  }

  async start(options: { locale: string }): Promise<void> {
    // A session left over from a previous tap would answer `start()` with a `busy` error.
    const state = await speech().getStateAsync().catch(() => 'inactive');
    if (state !== 'inactive') {
      speech().abort();
    }

    this.detachNative();
    this.sawFinalResult = false;
    const mode = await this.resolveMode(options.locale);
    this.attachNative();

    // eslint-disable-next-line no-console -- WO L3.13: the S4 audit trail (mode + language only, never the words)
    console.log(`[speech] start lang=${options.locale} mode=${mode}`);

    speech().start({
      lang: options.locale,
      // Partial results are what makes the words appear in the composer while the user is still
      // talking (DESIGN §2.6) instead of one block of text seconds later.
      interimResults: true,
      // One utterance per tap: iOS ends the task itself after a short silence, so the user does
      // not have to reach for the microphone button to finish a sentence.
      continuous: false,
      requiresOnDeviceRecognition: mode === 'on-device',
      // The dream text is read back to the user in the morning room and stored in the journal —
      // sentences with full stops are worth the extra option.
      addsPunctuation: true,
      maxAlternatives: 1,
    });
  }

  /**
   * Ask for the final result and stop the microphone. Apple answers a `stop()` with one last
   * `result` event (if it heard anything) followed by `end`, so the native listeners stay
   * attached until that `end` arrives — see `attachNative`.
   */
  async stop(): Promise<void> {
    try {
      const state = await speech().getStateAsync().catch(() => 'inactive');
      if (state === 'inactive') {
        this.detachNative();
        return;
      }
      speech().stop();
    } catch {
      this.detachNative();
    }
  }

  onResult(listener: (result: SpeechResult) => void): Unsubscribe {
    this.resultListeners.add(listener);
    return () => {
      this.resultListeners.delete(listener);
    };
  }

  onError(listener: (error: string) => void): Unsubscribe {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  // -------------------------------------------------------------------------

  /**
   * On-device if the phone can do it at all **and** Apple lists this language as one it can
   * recognise; server-based otherwise (WO L3.13: Thai is not installed on every phone).
   *
   * The honest limits of this answer, worth knowing before trusting the log line: the module's
   * `supportsOnDeviceRecognition()` asks the *default* recogniser, and iOS's `getSupportedLocales()`
   * reports `SFSpeechRecognizer.supportedLocales()` without saying which of them have an offline
   * model. So this is "on-device is plausible for this language", not a promise. The native side
   * makes the real decision safely — `ExpoSpeechRecognizer.swift` only forwards
   * `requiresOnDeviceRecognition` when the recogniser built for *this* locale supports it, and
   * otherwise transparently falls back to the server rather than failing the session.
   */
  private async resolveMode(locale: string): Promise<RecognitionMode> {
    try {
      if (!speech().supportsOnDeviceRecognition()) return 'server';
      const supported = await speech().getSupportedLocales({});
      const wanted = normaliseTag(locale);
      const installed = supported.installedLocales.length > 0 ? supported.installedLocales : supported.locales;
      return installed.some((tag) => normaliseTag(tag) === wanted) ? 'on-device' : 'server';
    } catch {
      // Never let a capability query stop someone from dictating — the server path always exists.
      return 'server';
    }
  }

  private attachNative(): void {
    this.nativeSubscriptions = [
      speech().addListener('result', (event) => {
        const transcript = event.results[0]?.transcript ?? '';
        if (event.isFinal) this.sawFinalResult = true;
        this.emitResult({ text: transcript, isFinal: event.isFinal });
      }),
      speech().addListener('error', (event) => {
        // `aborted` is this class cancelling a stale session in `start()`, not something that
        // happened to the user — reporting it would flash an error for a session they never saw.
        if (event.error === 'aborted') return;
        this.sawFinalResult = true; // the `end` that follows must not add a second error
        // eslint-disable-next-line no-console -- WO L3.13: diagnosing a mic that "does nothing" needs the code
        console.warn(`[speech] error ${event.error}`);
        this.emitError(toErrorCode(event.error));
      }),
      speech().addListener('end', () => {
        const silent = !this.sawFinalResult;
        this.detachNative();
        // Apple ends a task it heard nothing in with no result at all. Without this the caller
        // would keep a "listening" microphone on screen forever (WO L3.13).
        if (silent) this.emitError('NO_SPEECH');
      }),
    ];
  }

  private detachNative(): void {
    for (const subscription of this.nativeSubscriptions) subscription.remove();
    this.nativeSubscriptions = [];
  }

  private emitResult(result: SpeechResult): void {
    for (const listener of [...this.resultListeners]) listener(result);
  }

  private emitError(error: string): void {
    for (const listener of [...this.errorListeners]) listener(error);
  }
}

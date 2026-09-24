/**
 * Do-Not-Disturb / Focus check for the device-readiness gate (`readiness.ts`'s
 * `dndAllowsAppAudio` input, DESIGN §3.2 step 3 "Do Not Disturb — this app's sound is already
 * allowed").
 *
 * WO L2.2n replaced L1.7ui's `return true` stub with a real native read
 * (`apps/mobile/modules/lucid-focus`) — but the honest answer is still usually "we do not know",
 * and that is on purpose. The reasoning, because it is the kind of thing somebody will want to
 * "fix" later:
 *
 * 1. **iOS exposes no "is my audio silenced" API.** `UNUserNotificationCenter` reports
 *    *notification* settings; `INFocusStatusCenter` reports whether the user is in *a* Focus.
 *    Neither is "this app's playback is inaudible".
 * 2. **A Focus does not silence us.** The night plays through an `AVAudioSession` in the
 *    `playback` category with `playsInSilentMode` (`IosAudioPlayer.configureSession`). Sleep Focus
 *    silences notifications and calls, not that session. So "the user is in Sleep Focus" is not
 *    evidence of a problem — and since practically everyone is in Sleep Focus at bedtime, gating
 *    on it would block every single night with `ready.blocker.DND_BLOCKS` ("Turn off Do Not
 *    Disturb first"), a sentence that would also be untrue.
 * 3. **The entitlement is not shipped.** Reading Focus status needs
 *    `com.apple.developer.focus-status`, which needs a capability enabled on the App ID. Shipping
 *    an entitlement the provisioning profile does not carry makes the build fail, sometimes
 *    silently (`reference_watch_target_entitlements`) — and there is no Apple account wired up yet
 *    (APP-RUN §0.3 item 2). So `readState().known` is `false` in every build this work order
 *    produces, and this function answers `true`.
 *
 * What that leaves: the gate stops lying about what it checked, the real read is one line away
 * when Fable decides to enable the capability, and the numbers that *do* predict an inaudible
 * whisper (output volume at zero, another app holding primary audio) are exposed by
 * {@link readAudioEnvironment} for the diagnostics screen — deliberately **not** wired into the
 * DND gate, because the sentence that gate shows is about Do Not Disturb and an error message must
 * never blame the wrong thing (`feedback_error_must_not_blame_user`).
 */

import LucidFocus, { type FocusState } from '../../modules/lucid-focus';

/** Everything the OS will tell us about who might be silencing the night. */
export interface AudioEnvironment extends FocusState {
  /** `false` when the native module is missing entirely (web bundle, pre-L2.2n build). */
  nativeAvailable: boolean;
}

const UNKNOWN: AudioEnvironment = {
  nativeAvailable: false,
  known: false,
  focused: false,
  outputVolume: 0,
  otherAudioPlaying: false,
  secondaryAudioSilencedHint: false,
};

/**
 * Raw read for diagnostics. Never throws: a night must not fail because a status read did.
 */
export function readAudioEnvironment(): AudioEnvironment {
  if (!LucidFocus) return UNKNOWN;
  try {
    return { nativeAvailable: true, ...LucidFocus.readState() };
  } catch {
    return UNKNOWN;
  }
}

/**
 * The one decision to make here, kept as a named switch instead of buried in an `if`.
 *
 * `false` (today): being in a Focus never blocks the night. Flipping it to `true` means "a Focus
 * counts as Do Not Disturb silencing us" and requires **both** the
 * `com.apple.developer.focus-status` entitlement in `app.config.ts` (plus the capability on the
 * App ID) **and** a decision from Fable that the trade-off in point 2 of the file comment is
 * acceptable: every night started inside Sleep Focus would then be blocked with
 * `ready.blocker.DND_BLOCKS`.
 *
 * Typed `boolean` rather than left to inference so flipping it does not turn the comparison below
 * into a "this condition is always false" narrowing.
 */
const TREAT_FOCUS_AS_BLOCKING: boolean = false;

/**
 * `true` = nothing we can see is stopping this app's sound tonight.
 *
 * Unknown counts as allowed (see the file comment): the pre-night gate must not invent a blocker it
 * cannot prove, and `evaluateReadiness` keeps its `DND_BLOCKS` code ready for the day this returns
 * a real reading.
 */
export async function dndAllowsAppAudio(): Promise<boolean> {
  if (!TREAT_FOCUS_AS_BLOCKING) return true;
  const state = readAudioEnvironment();
  if (!state.known) return true;
  return !state.focused;
}

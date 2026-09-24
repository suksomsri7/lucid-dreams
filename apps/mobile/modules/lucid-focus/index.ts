/**
 * `LucidFocus` — typed surface of the Focus/audio-environment reader
 * (native half: `ios/LucidFocusModule.swift`, consumed by `src/platform/dnd.ts`).
 *
 * Resolved optionally: absent on web/Android and in any build made before this work order, where
 * `known` is `false` and the pre-night check treats that as "nothing is silencing us".
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

export interface FocusState {
  /**
   * `true` only when iOS actually told us whether a Focus is on. `false` means "not allowed to
   * know" (no `com.apple.developer.focus-status` entitlement, or the user never authorised it) —
   * which is the shipped state today.
   */
  known: boolean;
  /** The user is in some Focus (Sleep, Work, …). Meaningless unless `known`. */
  focused: boolean;
  /** System output volume, 0..1. Diagnostics only — a simulator can report 0. */
  outputVolume: number;
  /** Another app holds primary audio. */
  otherAudioPlaying: boolean;
  /** iOS is hinting that secondary audio should be silenced (e.g. a game over a podcast). */
  secondaryAudioSilencedHint: boolean;
}

export interface LucidFocusNativeModule {
  readState(): FocusState;
  /** Resolves `false` when the entitlement is missing; never shows anything in that case. */
  requestAuthorization(): Promise<boolean>;
}

const LucidFocus = requireOptionalNativeModule<LucidFocusNativeModule>('LucidFocus');

export default LucidFocus;

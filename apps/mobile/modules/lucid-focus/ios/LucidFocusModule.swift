import AVFAudio
import ExpoModulesCore
import Intents

/**
 "Is anything silencing us tonight?" — the native half of `src/platform/dnd.ts`
 (DESIGN §3.2 step 3 "ห้ามรบกวน — อนุญาตเสียงของแอปแล้ว" · WO L1.7's DND debt).

 ## What iOS actually exposes, and what it does not

 There is **no** API that answers "is my audio being silenced right now". Two things come close
 and both are reported here, separately, so the layer above can decide without this one having to
 lie:

 - `INFocusStatusCenter` says whether the user is in *a* Focus (Sleep, Work, …). It needs the
   `com.apple.developer.focus-status` entitlement **and** a one-time user authorisation; without
   either, `authorizationStatus` is not `.authorized` and `isFocused` is `nil`. That is reported
   as `known: false`.
 - `AVAudioSession` knows the current output volume, whether another app holds primary audio, and
   whether the system is hinting that secondary audio should be silenced.

 🔴 A Focus does **not** mute an `AVAudioSession` in the `playback` category — which is the
 category the night runs in (`IosAudioPlayer.configureSession`). So "the user is in Sleep Focus"
 is *not* evidence that the whisper will be inaudible, and the gate must not use it as such: at
 bedtime almost everyone is in Sleep Focus, and blocking the night with "Turn off Do Not Disturb
 first" would be both wrong and the one message guaranteed to appear every single night. The
 things that really do make a whisper inaudible are a zero output volume and dead headphones —
 both reported here, neither wired into the gate, because the wording the gate shows
 (`ready.blocker.DND_BLOCKS`) is about Do Not Disturb and a message must never blame the wrong
 thing. See `ledger/wo-notes/L2.2n.md` for the decision and what Fable has to rule on.

 ⚠️ Not compiled — no macOS/Xcode here (APP-RUN §0.3 item 2).
 */
public final class LucidFocusModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LucidFocus")

    /// Everything known about "who might be silencing us", in one synchronous read. No promise:
    /// all four values are local properties, and the pre-night screen reads them on every render.
    Function("readState") { () -> [String: Any] in
      let center = INFocusStatusCenter.default
      let authorized = center.authorizationStatus == .authorized
      // `isFocused` is `Bool?`: `nil` means "we are not allowed to know".
      let isFocused = authorized ? center.focusStatus.isFocused : nil
      let session = AVAudioSession.sharedInstance()

      return [
        // `true` only when iOS actually told us something. `false` ⇒ treat as "no information"
        // (the caller then answers "audio is allowed", APP-RUN §0.5: never invent a blocker).
        "known": isFocused != nil,
        "focused": isFocused ?? false,
        // 0...1. Read without activating the session, which is enough for "is it muted"; a
        // simulator, or an iOS version that has not published a route yet, can report 0 here, so
        // this is diagnostics and must not gate anything on its own.
        "outputVolume": Double(session.outputVolume),
        "otherAudioPlaying": session.isOtherAudioPlaying,
        "secondaryAudioSilencedHint": session.secondaryAudioShouldBeSilencedHint,
      ]
    }

    /// One-time user authorisation for reading Focus status. Resolves `false` (without showing
    /// anything) when the entitlement is missing, which is the shipped state today — so calling
    /// this is always safe.
    AsyncFunction("requestAuthorization") { (promise: Promise) in
      INFocusStatusCenter.default.requestAuthorization { status in
        promise.resolve(status == .authorized)
      }
    }
  }
}

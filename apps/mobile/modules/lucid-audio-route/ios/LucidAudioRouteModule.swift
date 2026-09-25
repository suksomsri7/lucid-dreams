import AVFAudio
import ExpoModulesCore

/**
 "Where is the sound coming out right now?" — the native half of
 `src/platform/ios/audioRoute.ts` (WO L3.9 §B · R1 hotfix #1).

 ## Why this module has to exist

 `expo-audio` (SDK 57) exposes volume, rate and mute, and nothing about the output route
 (checked against `node_modules/expo-audio/build/AudioModule.types.d.ts`). So
 `IosAudioPlayer.getStatus().route` was always `nil`, the devices screen could never list a pair
 of headphones, and the 🎧 category of the pre-night gate could never pass on a real phone. The
 whole answer lives in two `AVAudioSession` facts, so this module is deliberately two calls wide
 and nothing else.

 ## What it reports

 | JS | source |
 |---|---|
 | `getCurrentRoute()` | `AVAudioSession.sharedInstance().currentRoute.outputs.first` → `{ portType, portName }`, or `nil` when iOS publishes no output at all |
 | `onRouteChange` | `AVAudioSession.routeChangeNotification`, same body |

 `portType` is `AVAudioSession.Port`'s raw value (`BluetoothA2DP`, `Headphones`, `BuiltInSpeaker`,
 …) and is the only field anything is decided from; `portName` is the user-visible device name
 ("Sleep A20") and is only ever shown. Classification into headphones/speaker/other happens in
 JavaScript (`src/platform/ios/audioRoute.ts`) so that the rule can be read, reviewed and changed
 without a new binary — and so this file never has an opinion about readiness.

 It does **not** activate, configure or otherwise touch the session: the devices screen reads this
 on every refresh, and a read must never be able to start audio, steal the route from another app
 or provoke a permission sheet (APP-RUN §0.5 S7 · the "every call is a pure read" rule
 `src/devices/registry.ts` states for the whole devices screen).

 ⚠️ Not compiled here — no macOS/Xcode on this machine (APP-RUN §0.3 item 2). R1 has to confirm
 on device that plugging/unplugging headphones changes the 🎧 card within ~2 s.
 */
public final class LucidAudioRouteModule: Module {
  /// Kept so `OnStopObserving` can remove exactly the observer `OnStartObserving` added.
  private var routeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("LucidAudioRoute")

    Events("onRouteChange")

    /// Synchronous on purpose: two local property reads, called from `getStatus()` on the devices
    /// screen's refresh tick, where a promise would mean a render with a stale route.
    Function("getCurrentRoute") { () -> [String: Any]? in
      LucidAudioRouteModule.currentOutput()
    }

    /// Only observe while JavaScript is listening — outside a night nobody is, and an observer
    /// that outlives its listeners is just a retain cycle waiting to happen.
    OnStartObserving {
      guard self.routeObserver == nil else { return }
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: AVAudioSession.sharedInstance(),
        // Main queue: the listener ends up in a React state update, and `sendEvent` off the main
        // thread is how a route change turns into a rare, unreproducible crash.
        queue: .main
      ) { [weak self] _ in
        // The notification's own `AVAudioSessionRouteChangeReasonKey` is deliberately ignored:
        // the JS side only cares what the route *is* now, and re-reading it is both simpler and
        // correct for every reason code (new device, old device gone, category change, override).
        self?.sendRouteEvent()
      }
    }

    OnStopObserving {
      guard let observer = self.routeObserver else { return }
      NotificationCenter.default.removeObserver(observer)
      self.routeObserver = nil
    }
  }

  /// `nil` when iOS publishes no output port (an inactive session on a simulator can do this) —
  /// reported as "no route" rather than invented as the built-in speaker.
  private static func currentOutput() -> [String: Any]? {
    guard let output = AVAudioSession.sharedInstance().currentRoute.outputs.first else {
      return nil
    }
    return ["portType": output.portType.rawValue, "portName": output.portName]
  }

  /// One event shape for both "there is a route" and "there is none": the two keys are always
  /// present, holding `nil` when nothing is plugged in, so the JS listener never has to tell a
  /// missing key from a null one.
  private func sendRouteEvent() {
    let output = LucidAudioRouteModule.currentOutput()
    sendEvent("onRouteChange", [
      "portType": output?["portType"] as Any?,
      "portName": output?["portName"] as Any?,
    ])
  }
}

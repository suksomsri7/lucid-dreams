import ExpoModulesCore
import WatchConnectivity

/**
 The iPhone half of the watch link (WO L2.2 · DESIGN §8.2).

 The watch app in `targets/watch` aggregates heart rate and wrist motion into one 30 s epoch
 and sends it with `WCSession.sendMessage` when the phone is reachable, or queues it with
 `transferUserInfo` when it is not. Both arrive here, on two different delegate callbacks, and
 both end up as the same `epoch` event in JavaScript.

 ## Events

 | event | body | when |
 |---|---|---|
 | `epoch` | `{ t, hrMean, hrSd, motion, battery }` — any field may be missing | a message or a queued userInfo arrived |
 | `status` | `{ paired, installed, reachable, model }` | activation finished, reachability changed, or the watch app was installed/removed |
 | `command` | `{ type: "stop" }` | the watch's own hold-to-stop button |

 ## Rules this module follows

 - **It never judges the data.** Range checks, the 30 s grid and duplicate dropping all happen
   in `src/platform/ios/WatchSensorSource.ts` against the engine's own
   `SensorEpochSchema`/`normalizeEpochs`, because those are the same rules the engine applies
   to a replayed night (APP-RUN §0.5 S8). Anything filtered here would be filtered twice with
   two definitions.
 - **Nothing is lost between app launch and the first JS listener.** watchOS delivers a queued
   backlog as soon as the phone wakes, which can be before `startNightSession()` has
   subscribed. Epochs that arrive with no listener are held in {@link WatchLink.backlog} and
   flushed when JavaScript calls `activate()` (which `WatchSensorSource.start()` does *after*
   subscribing).
 - **Every callback hops to the main thread.** `WCSession` calls its delegate on its own queue.

 ⚠️ Not compiled: there is no macOS/Xcode on the machine this was written on (APP-RUN §0.3
 item 2). See `ledger/wo-notes/L2.2n.md` for the exact list R1 has to verify on device.
 */
public final class LucidWatchLinkModule: Module {
  private let link = WatchLink()

  public func definition() -> ModuleDefinition {
    Name("LucidWatchLink")

    Events("epoch", "status", "command")

    OnCreate {
      self.link.onEpoch = { [weak self] payload in
        self?.emit("epoch", payload)
      }
      self.link.onStatus = { [weak self] status in
        self?.emit("status", status)
      }
      self.link.onCommand = { [weak self] command in
        self?.emit("command", ["type": command])
      }
    }

    /// Activates `WCSession` (idempotent) and answers with the status as it is known right now.
    /// Resolving does **not** mean a watch is there — read the returned fields.
    AsyncFunction("activate") { () -> [String: Any] in
      self.link.activate()
      return self.link.statusDictionary()
    }

    /// Cheap, synchronous snapshot for the diagnostics screen.
    Function("getStatus") { () -> [String: Any] in
      self.link.statusDictionary()
    }

    /// Ask the watch to start or stop its workout session. Rejects for anything else so a typo
    /// in JavaScript fails loudly here instead of being silently ignored on the watch.
    AsyncFunction("sendCommand") { (command: String) in
      guard command == "start" || command == "stop" else {
        throw InvalidCommandException(command)
      }
      try self.link.send(message: ["command": command])
    }

    /// Mirror the night's live status onto the watch face: `pRem` (may be `nil` before the
    /// first estimate), whispers played and the ceiling for tonight.
    AsyncFunction("sendStatus") { (pRem: Double?, cuesPlayed: Int, cuesPlanned: Int) in
      var status: [String: Any] = ["cuesPlayed": cuesPlayed, "cuesPlanned": cuesPlanned]
      if let pRem {
        status["pRem"] = pRem
      }
      // Application context, not a message: the newest value replaces the previous one and
      // survives a watch that is asleep, which is exactly the semantics of "current status".
      // A queue would replay stale percentages minutes later.
      self.link.updateContext(["status": status])
    }

    /// The number behind the watch complication (nights in a row). The phone owns it; the watch
    /// only stores and shows it — see `targets/watch/StreakStore.swift`.
    AsyncFunction("setStreakNights") { (nights: Int) in
      self.link.updateContext(["streakNights": max(0, nights)])
    }
  }

  /// `BaseModule.sendEvent` wants `[String: Any?]`; everything inside {@link WatchLink} is built
  /// as `[String: Any]` (absent fields are simply not present, which is what the JS schema
  /// expects — a key holding `null` is not the same as a missing key there). Converted in one
  /// place rather than at three call sites.
  private func emit(_ name: String, _ body: [String: Any]) {
    sendEvent(name, body.mapValues { $0 as Any? })
  }
}

internal final class InvalidCommandException: GenericException<String> {
  override var reason: String {
    "Unknown watch command '\(param)' — only 'start' and 'stop' exist (DESIGN §3.4)"
  }
}

// MARK: - WCSession plumbing

/// Owns the session and the delegate. A separate `NSObject` because `WCSessionDelegate`
/// inherits from `NSObjectProtocol` and Expo's `Module` is not an `NSObject`.
internal final class WatchLink: NSObject {
  /// Largest number of epochs kept while JavaScript has no listener yet — 200 epochs is 100
  /// minutes, far more than the gap between an app launch and `startNightSession()`, and small
  /// enough to be irrelevant in memory (five numbers each).
  private static let backlogLimit = 200

  var onEpoch: (([String: Any]) -> Void)?
  var onStatus: (([String: Any]) -> Void)?
  var onCommand: ((String) -> Void)?

  private var backlog: [[String: Any]] = []
  private var hasFlushedBacklog = false

  private var session: WCSession? {
    WCSession.isSupported() ? WCSession.default : nil
  }

  func activate() {
    guard let session else { return }
    if session.delegate !== self {
      session.delegate = self
    }
    if session.activationState != .activated {
      session.activate()
    }
    // Deliver anything that arrived before JavaScript was listening. Async so the `activate()`
    // promise resolves before the first `epoch` event reaches the same JS tick.
    DispatchQueue.main.async { [weak self] in
      self?.flushBacklog()
    }
  }

  func statusDictionary() -> [String: Any] {
    guard let session else {
      return ["paired": false, "installed": false, "reachable": false, "model": NSNull()]
    }
    return [
      "paired": session.isPaired,
      "installed": session.isWatchAppInstalled,
      "reachable": session.isReachable,
      // `WCSession` exposes no watch model or name. The JS contract has always allowed `null`
      // here (`WatchLinkStatus.model`), and inventing "Apple Watch" would be a made-up device
      // name on the diagnostics screen.
      "model": NSNull(),
    ]
  }

  /// Phone → watch, live only. A command that cannot be delivered right now is dropped rather
  /// than queued: a "stop" that arrives an hour late would end a night the user restarted.
  func send(message: [String: Any]) throws {
    guard let session, session.activationState == .activated else {
      throw SessionNotActivatedException()
    }
    guard session.isReachable else {
      throw WatchNotReachableException()
    }
    session.sendMessage(message, replyHandler: nil, errorHandler: nil)
  }

  /// Phone → watch, newest-wins. Merged into whatever is already in the context so a status
  /// update does not wipe the streak (and the other way round).
  func updateContext(_ values: [String: Any]) {
    guard let session, session.activationState == .activated else { return }
    var context = session.applicationContext
    for (key, value) in values {
      context[key] = value
    }
    // `updateApplicationContext` throws if the pair is not set up; there is nothing useful to
    // do about that beyond not crashing the night over a watch-face number.
    try? session.updateApplicationContext(context)
  }

  private func emitStatus() {
    let status = statusDictionary()
    DispatchQueue.main.async { [weak self] in
      self?.onStatus?(status)
    }
  }

  /// One place where an incoming dictionary becomes either an epoch, a command, or nothing.
  private func handleIncoming(_ message: [String: Any]) {
    if let command = message["command"] as? String {
      // Today the watch only ever says "stop" (DESIGN §3.4: sensor plus one button).
      guard command == "stop" else { return }
      DispatchQueue.main.async { [weak self] in
        self?.onCommand?(command)
      }
      return
    }

    guard message["t"] != nil else { return } // not an epoch, not a command: ignore
    let payload = epochPayload(from: message)
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.onEpoch != nil, self.hasFlushedBacklog {
        self.onEpoch?(payload)
      } else {
        self.backlog.append(payload)
        if self.backlog.count > WatchLink.backlogLimit {
          self.backlog.removeFirst(self.backlog.count - WatchLink.backlogLimit)
        }
      }
    }
  }

  /// Copies only the five fields the epoch contract names, as plain numbers. Anything else the
  /// other side might send is dropped here: the JS schema would reject the whole epoch for an
  /// unexpected key, and an unknown key is never something this layer should pass on.
  private func epochPayload(from message: [String: Any]) -> [String: Any] {
    var payload: [String: Any] = [:]
    if let t = (message["t"] as? NSNumber)?.doubleValue {
      payload["t"] = t
    }
    for key in ["hrMean", "hrSd", "motion", "battery"] {
      if let value = (message[key] as? NSNumber)?.doubleValue {
        payload[key] = value
      }
    }
    return payload
  }

  /// Runs on the main thread only (called from `activate()`'s `DispatchQueue.main.async` and
  /// from `handleIncoming`'s hop), so `backlog` needs no lock.
  private func flushBacklog() {
    hasFlushedBacklog = true
    guard let onEpoch else { return }
    let pending = backlog
    backlog = []
    for payload in pending {
      onEpoch(payload)
    }
  }
}

extension WatchLink: WCSessionDelegate {
  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    emitStatus()
  }

  /// Required on iOS: the user switched to another watch. The session has to be reactivated for
  /// the new one, otherwise nothing arrives for the rest of the night.
  func sessionDidBecomeInactive(_ session: WCSession) {
    emitStatus()
  }

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
    emitStatus()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    emitStatus()
  }

  /// The watch app was installed or removed while the phone was running.
  func sessionWatchStateDidChange(_ session: WCSession) {
    emitStatus()
  }

  /// Live epoch (or the watch's stop button) while the phone was reachable.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handleIncoming(message)
  }

  /// Same, for the variant with a reply handler — some watchOS versions use it when the app is
  /// in the foreground. Replying keeps the watch side from logging a timeout.
  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    handleIncoming(message)
    replyHandler([:])
  }

  /// The queue watchOS filled while the phone was unreachable, delivered in order. This is the
  /// half that makes a night survive a phone in another room (DESIGN §8.2).
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    handleIncoming(userInfo)
  }
}

internal final class SessionNotActivatedException: Exception {
  override var reason: String {
    "WCSession is not activated yet — call activate() first"
  }
}

internal final class WatchNotReachableException: Exception {
  override var reason: String {
    "The watch is not reachable right now, so the command was not sent"
  }
}

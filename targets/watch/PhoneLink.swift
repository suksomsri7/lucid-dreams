import Foundation
import WatchConnectivity

/// Sends every epoch to the iPhone and receives commands / live status back.
///
/// Delivery rule (DESIGN §8.2): `sendMessage` when the phone is reachable — it is
/// immediate and cheap — otherwise `transferUserInfo`, which watchOS queues and
/// delivers in FIFO order even if the phone is asleep or out of range. A night must
/// never lose epochs just because the phone was in another room.
///
/// ## The four messages on this link (WO L2.2 — the phone half is
/// `apps/mobile/modules/lucid-watch-link/ios/LucidWatchLinkModule.swift`)
///
/// | direction | shape | transport |
/// |---|---|---|
/// | watch → phone | `["t": Int, "hrMean": Double?, "hrSd": Double?, "motion": Double?, "battery": Double?]` | `sendMessage`, falling back to `transferUserInfo` |
/// | watch → phone | `["command": "stop"]` | `sendMessage` (best effort: the phone also sees the workout end) |
/// | phone → watch | `["command": "start" \| "stop"]` | `sendMessage` |
/// | phone → watch | `["status": ["pRem": Double?, "cuesPlayed": Int, "cuesPlanned": Int, "streakNights": Int?]]` | `updateApplicationContext` (newest wins) or `sendMessage` |
///
/// Every field is read defensively: a message from the other side is untrusted input
/// (APP-RUN §0.5 S8), and an unknown key is ignored rather than trusted.
///
/// Threading: `WCSession` calls its delegate on a background queue, so **every**
/// `@Published` mutation in here hops to main first (L1.1 fix, kept). The only exceptions
/// are the direct mutations inside `send(_:)`, which is documented as main-actor-only.
final class PhoneLink: NSObject, ObservableObject {
    static let shared = PhoneLink()

    /// `true` when a message can go through right now.
    @Published private(set) var isReachable = false
    /// Epochs that had to be queued rather than sent live. Reported in diagnostics.
    @Published private(set) var queuedCount = 0
    /// Last transport error, for the diagnostics screen. Never user-facing text.
    @Published private(set) var lastError: String?

    /// Called when the phone asks the watch to start or stop.
    var onCommand: ((String) -> Void)?
    /// Called when the phone reports where the night is: `(pRem, cuesPlayed, cuesPlanned)`.
    /// `pRem` is `nil` until the estimator has produced a number (DESIGN §2.2).
    var onStatus: ((Double?, Int, Int) -> Void)?

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    private override init() {
        super.init()
    }

    func activate() {
        guard let session else {
            lastError = "WCSESSION_UNSUPPORTED"
            return
        }
        session.delegate = self
        session.activate()
        isReachable = session.isReachable
    }

    /// Fire-and-forget. Falls back to the queue on any failure, including a phone that
    /// went unreachable between the check and the send.
    func send(_ payload: EpochPayload) {
        // Called from `WorkoutManager.closeEpoch()` on the main actor, so the direct
        // mutations in this method body are already on the main thread.
        guard let session, session.activationState == .activated else {
            lastError = "WCSESSION_NOT_ACTIVATED"
            return
        }

        let body = payload.dictionary

        if session.isReachable {
            session.sendMessage(body, replyHandler: nil) { [weak self] error in
                // WatchConnectivity calls this error handler on its own queue, so the
                // @Published mutations have to hop to main like every other callback here
                // — mutating them off-main would publish from a background thread and
                // SwiftUI would either warn or update the view out of order.
                session.transferUserInfo(body) // live send failed — queue it so the epoch is not lost
                DispatchQueue.main.async {
                    self?.lastError = "SEND_FAILED:\(error.localizedDescription)"
                    self?.queuedCount += 1
                }
            }
        } else {
            session.transferUserInfo(body)
            queuedCount += 1
        }
    }

    /// The watch's own hold-to-stop button, told to the phone so `NightController.userStop()`
    /// runs there too (WO L2.8's `SensorSource.onCommand`). Best effort by design: if the
    /// phone is unreachable the night still ends on the watch, and the phone notices the
    /// epochs stopping. Deliberately **not** queued with `transferUserInfo` — a "stop" that
    /// arrives an hour late would end a night the user may have restarted since.
    func sendStopCommand() {
        guard let session, session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(["command": "stop"], replyHandler: nil) { [weak self] error in
            DispatchQueue.main.async {
                self?.lastError = "STOP_SEND_FAILED:\(error.localizedDescription)"
            }
        }
    }

    /// Shared parsing for the phone's status, whichever transport brought it.
    private func applyIncoming(_ message: [String: Any]) {
        if let command = message["command"] as? String, command == "start" || command == "stop" {
            DispatchQueue.main.async {
                self.onCommand?(command)
            }
        }

        if let status = message["status"] as? [String: Any] {
            // `NSNumber` covers both Int and Double coming over the wire.
            let pRem = (status["pRem"] as? NSNumber)?.doubleValue
            let played = (status["cuesPlayed"] as? NSNumber)?.intValue ?? 0
            let planned = (status["cuesPlanned"] as? NSNumber)?.intValue ?? 0
            DispatchQueue.main.async {
                self.onStatus?(pRem, played, planned)
            }
        }

        if let streak = (message["streakNights"] as? NSNumber)?.intValue {
            // Not a @Published value: the complication lives in another process and reads
            // the App Group, so this write is the only thing that has to happen.
            StreakStore.write(nights: streak)
        }
    }
}

extension PhoneLink: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
            if let error {
                self.lastError = "ACTIVATION:\(error.localizedDescription)"
            }
        }
        // A context that arrived while this side was not activated is waiting here.
        applyIncoming(session.receivedApplicationContext)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    /// The phone's only commands are "start" and "stop" (DESIGN §3.4: the watch is a
    /// sensor plus one button). Anything else is ignored rather than trusted.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        applyIncoming(message)
    }

    /// The phone's live status uses the application context so the newest value survives a
    /// watch that was asleep — the queue would otherwise replay stale percentages.
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        applyIncoming(applicationContext)
    }
}

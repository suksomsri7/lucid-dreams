import Foundation
import WatchConnectivity

/// Sends every epoch to the iPhone and receives start/stop commands back.
///
/// Delivery rule (DESIGN §8.2): `sendMessage` when the phone is reachable — it is
/// immediate and cheap — otherwise `transferUserInfo`, which watchOS queues and
/// delivers in FIFO order even if the phone is asleep or out of range. A night must
/// never lose epochs just because the phone was in another room.
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
        guard let session, session.activationState == .activated else {
            lastError = "WCSESSION_NOT_ACTIVATED"
            return
        }

        let body = payload.dictionary

        if session.isReachable {
            session.sendMessage(body, replyHandler: nil) { [weak self] error in
                // live send failed — queue it so the epoch is not lost
                self?.lastError = "SEND_FAILED:\(error.localizedDescription)"
                session.transferUserInfo(body)
                self?.queuedCount += 1
            }
        } else {
            session.transferUserInfo(body)
            queuedCount += 1
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
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isReachable = session.isReachable
        }
    }

    /// The phone's only commands are "start" and "stop" (DESIGN §3.4: the watch is a
    /// sensor plus one button). Anything else is ignored rather than trusted.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let command = message["command"] as? String,
              command == "start" || command == "stop" else { return }
        DispatchQueue.main.async {
            self.onCommand?(command)
        }
    }
}

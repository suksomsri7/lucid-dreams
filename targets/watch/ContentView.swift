import SwiftUI
import WatchKit

/// Small helper so `WorkoutManager` does not have to import WatchKit.
enum WatchBattery {
    static func enableMonitoring() {
        WKInterfaceDevice.current().isBatteryMonitoringEnabled = true
    }

    /// 0...1, or a negative number when the OS has no reading yet.
    static func level() -> Float {
        WKInterfaceDevice.current().batteryLevel
    }
}

/// Three states, exactly as DESIGN §3.2 / §10 describe. The watch is a sensor plus one
/// button; it shows numbers and never explains anything.
///
/// Strings (WO L2.2, closing L1.1's debt H-2): the watch target is a separate binary and
/// cannot read the app's TypeScript i18n catalogue, so every visible string goes through
/// `String(localized:)` against `Localizable.xcstrings` in this folder, which carries the
/// Thai column next to the English one. Two rules for whoever edits them:
///   1. the literal passed to `String(localized:)` is the **key**, not the English text —
///      keys look like `watch.running.hrUnit` so a wording change never orphans a
///      translation;
///   2. anything with a number in it is `String(format:)` over the localised value, so the
///      Thai and English sentences can put the number in different places.
struct ContentView: View {
    @StateObject private var manager = WorkoutManager()

    var body: some View {
        Group {
            switch manager.phase {
            case .ready:
                ReadyView(manager: manager)
            case .running:
                RunningView(manager: manager)
            case .morning:
                MorningView()
            }
        }
        .onAppear { WatchBattery.enableMonitoring() }
    }
}

private struct ReadyView: View {
    let manager: WorkoutManager

    var body: some View {
        VStack(spacing: 10) {
            Text(String(localized: "watch.ready.title"))
                .font(.headline)
            Text(String(localized: "watch.ready.hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(String(localized: "watch.ready.start")) {
                Task { await manager.start() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

private struct RunningView: View {
    @ObservedObject var manager: WorkoutManager

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(manager.heartRate.map { String(Int($0.rounded())) } ?? "--")
                    .font(.system(size: 44, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                Text(String(localized: "watch.running.hrUnit"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            // "REM probably 72%" — honest about uncertainty (DESIGN §2.2). The phone owns the
            // number; before the first estimate arrives we show a dash, never a guess.
            Text(remText)
                .font(.caption)
                .foregroundStyle(.mint)

            Text(String(format: String(localized: "watch.running.whispers"), manager.cuesPlayed, manager.cuesPlanned))
                .font(.caption2)
                .foregroundStyle(.secondary)

            Text(String(format: String(localized: "watch.running.epochs"), manager.epochCount))
                .font(.caption2)
                .foregroundStyle(.secondary)

            Spacer(minLength: 4)

            HoldToStopButton { manager.stop(reason: .userHold) }
        }
        .padding(.horizontal, 8)
    }

    private var remText: String {
        guard let pRem = manager.pRem else { return String(localized: "watch.running.remUnknown") }
        return String(format: String(localized: "watch.running.rem"), Int((pRem * 100).rounded()))
    }
}

/// Hold, do not tap (DESIGN §10 · L2.2 oracle W9 "the stop button must be held for 1 s"):
/// a sleepy hand must not end the night by accident.
///
/// `onLongPressGesture(minimumDuration:)` rather than the hand-rolled `DragGesture` +
/// `Timer` of L1.1: SwiftUI's own gesture is the thing that defines "held for a second"
/// on watchOS (it survives small finger movement, it cancels when the view disappears, and
/// it does not keep a `Timer` alive on the run loop if the wrist drops mid-press — the
/// L1.1 version leaked one in exactly that case). The filling bar is now pure animation
/// driven by `onPressingChanged`, so it is decoration: even if it were wrong, the action
/// still fires only after {@link holdSeconds} of real press.
private struct HoldToStopButton: View {
    /// One second, the number the L2.2 oracle names.
    private static let holdSeconds: Double = 1.0

    let action: () -> Void
    @State private var pressing = false

    /// Two separate literals rather than a ternary inside `String(localized:)`, so each key
    /// is a plain string literal the Xcode string-catalogue extractor can see.
    private var label: String {
        pressing ? String(localized: "watch.stop.holding") : String(localized: "watch.stop.idle")
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.red.opacity(0.22))
            GeometryReader { geometry in
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.red.opacity(0.55))
                    .frame(width: pressing ? geometry.size.width : 0)
                    .animation(
                        pressing ? .linear(duration: HoldToStopButton.holdSeconds) : .linear(duration: 0.15),
                        value: pressing
                    )
            }
            Text(label)
                .font(.footnote.weight(.semibold))
        }
        .frame(height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .onLongPressGesture(minimumDuration: HoldToStopButton.holdSeconds) {
            pressing = false
            WKInterfaceDevice.current().play(.stop)
            action()
        } onPressingChanged: { isPressing in
            pressing = isPressing
        }
        .accessibilityLabel(String(localized: "watch.stop.accessibility"))
    }
}

private struct MorningView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text(String(localized: "watch.morning.title"))
                .font(.headline)
            Text(String(localized: "watch.morning.hint"))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}

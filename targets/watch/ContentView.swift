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
/// Strings: the watch target is a separate binary and cannot read the app's TS i18n
/// catalogue. For L1.1 the labels are English `LocalizedStringKey`s; L2.2 adds
/// `Localizable.xcstrings` with the Thai column taken from `src/i18n/th.ts`
/// (see notes: debt H-2).
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
            Text("Lucid Dream")
                .font(.headline)
            Text("Start this on your iPhone, or tap below.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Start night") {
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
                Text("bpm")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            // "REM probably 72%" — honest about uncertainty (DESIGN §2.2). The phone owns the
            // number; before the first estimate arrives we show a dash, never a guess.
            Text(remText)
                .font(.caption)
                .foregroundStyle(.mint)

            Text("Whispers \(manager.cuesPlayed)/\(manager.cuesPlanned)")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Text("Epochs \(manager.epochCount)")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Spacer(minLength: 4)

            HoldToStopButton { manager.stop(reason: .userHold) }
        }
        .padding(.horizontal, 8)
    }

    private var remText: String {
        guard let pRem = manager.pRem else { return "REM --" }
        return "REM ~\(Int((pRem * 100).rounded()))%"
    }
}

/// Hold, do not tap (DESIGN §10): a sleepy hand must not end the night by accident.
private struct HoldToStopButton: View {
    private static let holdSeconds: Double = 1.5

    let action: () -> Void
    @State private var progress: Double = 0
    @State private var timer: Timer?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.red.opacity(0.22))
            GeometryReader { geometry in
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.red.opacity(0.55))
                    .frame(width: geometry.size.width * progress)
            }
            Text(progress > 0 ? "Keep holding…" : "Hold to stop")
                .font(.footnote.weight(.semibold))
        }
        .frame(height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in startHold() }
                .onEnded { _ in cancelHold() }
        )
        .accessibilityLabel("Hold to stop the night")
    }

    private func startHold() {
        guard timer == nil else { return }
        let step = 0.05
        let created = Timer.scheduledTimer(withTimeInterval: step, repeats: true) { _ in
            progress += step / HoldToStopButton.holdSeconds
            if progress >= 1 {
                cancelHold()
                action()
            }
        }
        RunLoop.main.add(created, forMode: .common)
        timer = created
    }

    private func cancelHold() {
        timer?.invalidate()
        timer = nil
        progress = 0
    }
}

private struct MorningView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("Good morning")
                .font(.headline)
            Text("Tell your dream on your iPhone.")
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

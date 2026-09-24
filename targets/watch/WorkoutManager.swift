import Foundation
import HealthKit

/// The night session on the watch.
///
/// Why a workout session at all: it is the only sanctioned way to get per-second heart
/// rate for hours with the screen off (DESIGN §8.1). `.mindAndBody` is used rather than
/// a sleep-ish activity because it does not close rings, does not congratulate anybody,
/// and is the quietest thing in HealthKit.
///
/// The watch never estimates REM (DESIGN §8.2: the estimator lives on the phone so the
/// model can be changed without an App Store release). It only aggregates and sends.
@MainActor
final class WorkoutManager: NSObject, ObservableObject {
    enum Phase {
        case ready
        case running
        case morning
    }

    @Published private(set) var phase: Phase = .ready
    /// Latest heart rate, shown big on the watch (DESIGN §10, watch screen A).
    @Published private(set) var heartRate: Double?
    /// Number of epochs sent this night.
    @Published private(set) var epochCount: Int = 0
    /// Cues the phone says it has played, so the watch can show "2/8".
    @Published private(set) var cuesPlayed: Int = 0
    @Published private(set) var cuesPlanned: Int = 0
    /// The phone owns the REM estimate; `nil` until the phone sends one.
    @Published private(set) var pRem: Double?
    @Published private(set) var errorText: String?

    private let store = HKHealthStore()
    private let motion = MotionManager()
    private let link = PhoneLink.shared

    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var epochTimer: Timer?

    /// Heart-rate samples collected inside the epoch in progress.
    private var epochSamples: [Double] = []

    private let heartRateType = HKQuantityType(.heartRate)
    private let heartRateUnit = HKUnit.count().unitDivided(by: .minute())

    override init() {
        super.init()
        link.activate()
        link.onCommand = { [weak self] command in
            Task { @MainActor in
                switch command {
                case "start": await self?.start()
                case "stop": self?.stop(reason: .phoneCommand)
                default: break
                }
            }
        }
    }

    // MARK: - Permissions

    func requestAuthorization() async {
        let share: Set = [HKQuantityType.workoutType()]
        let read: Set<HKObjectType> = [heartRateType]
        do {
            try await store.requestAuthorization(toShare: share, read: read)
        } catch {
            errorText = "HK_AUTH:\(error.localizedDescription)"
        }
    }

    // MARK: - Night

    func start() async {
        guard session == nil else { return } // idempotent

        await requestAuthorization()

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .mindAndBody
        configuration.locationType = .indoor

        do {
            let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(
                healthStore: store,
                workoutConfiguration: configuration
            )
            session.delegate = self
            builder.delegate = self

            self.session = session
            self.builder = builder

            let startDate = Date()
            session.startActivity(with: startDate)
            try await builder.beginCollection(at: startDate)

            motion.start()
            startEpochTimer()
            phase = .running
            errorText = nil
        } catch {
            errorText = "WORKOUT_START:\(error.localizedDescription)"
            cleanUp()
        }
    }

    enum StopReason {
        case userHold
        case phoneCommand
    }

    /// Stopping is deliberately hold-to-confirm in the UI (DESIGN §10): a sleepy tap
    /// must not end the night by accident.
    func stop(reason: StopReason) {
        guard let session else { return }
        epochTimer?.invalidate()
        epochTimer = nil
        motion.stop()

        let endDate = Date()
        session.end()
        Task { [builder] in
            try? await builder?.endCollection(at: endDate)
            _ = try? await builder?.finishWorkout()
        }

        phase = .morning
        _ = reason
        cleanUp()
    }

    private func cleanUp() {
        session = nil
        builder = nil
        epochSamples = []
    }

    // MARK: - Epochs

    private func startEpochTimer() {
        epochTimer?.invalidate()
        let timer = Timer(timeInterval: Double(epochSeconds), repeats: true) { [weak self] _ in
            Task { @MainActor in self?.closeEpoch() }
        }
        // `.common` so the timer keeps firing while the watch UI is scrolling or asleep
        RunLoop.main.add(timer, forMode: .common)
        epochTimer = timer
    }

    /// Aggregate, send, reset. Called every 30 s on the main actor.
    private func closeEpoch() {
        let samples = epochSamples
        epochSamples = []

        let mean: Double? = samples.isEmpty ? nil : samples.reduce(0, +) / Double(samples.count)
        var sd: Double?
        if let mean, samples.count > 1 {
            let variance = samples.reduce(0) { $0 + pow($1 - mean, 2) } / Double(samples.count - 1)
            sd = sqrt(variance)
        }

        let payload = EpochPayload(
            t: epochIndex(for: Date().addingTimeInterval(-Double(epochSeconds))),
            hrMean: mean,
            hrSd: sd,
            motion: motion.drainEpochMean(),
            battery: currentBatteryLevel()
        )

        link.send(payload)
        epochCount += 1
    }

    /// `WKInterfaceDevice.batteryLevel` needs battery monitoring enabled; the app turns
    /// it on at launch (see `LucidWatchApp`). Returns `nil` when the OS has no reading.
    private func currentBatteryLevel() -> Double? {
        let level = Double(WatchBattery.level())
        return level < 0 ? nil : level
    }

    /// Called by `PhoneLink` when the phone reports progress, so the watch face can show
    /// "REM ~72% · 2/8" without computing anything itself.
    func applyPhoneStatus(pRem: Double?, cuesPlayed: Int, cuesPlanned: Int) {
        self.pRem = pRem
        self.cuesPlayed = cuesPlayed
        self.cuesPlanned = cuesPlanned
    }
}

// MARK: - HealthKit delegates

extension WorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        Task { @MainActor in
            if toState == .ended || toState == .stopped {
                self.phase = .morning
            }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in
            self.errorText = "WORKOUT_FAILED:\(error.localizedDescription)"
            self.phase = .morning
        }
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        guard collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType),
              let latest = statistics.mostRecentQuantity()?.doubleValue(for: heartRateUnit)
        else { return }

        Task { @MainActor in
            // Out-of-range beats are dropped here and again on the phone (§0.5 S8).
            guard latest >= 25, latest <= 220 else { return }
            self.heartRate = latest
            self.epochSamples.append(latest)
        }
    }
}

import CoreMotion
import Foundation

/// Wrist movement, aggregated on the watch so the phone only ever sees one number per
/// 30 seconds (DESIGN §8.2).
///
/// 20 Hz accelerometer, gravity removed, `|a|` averaged over the epoch. Averaging on
/// the watch instead of streaming raw samples is what keeps the battery cost low enough
/// to survive a night — if R1 shows the watch below 30% by morning, the first lever is
/// dropping this to 10 Hz (APP-RUN §2, L1.1 → R1).
/// Accelerometer sampling rate, in hertz — the rate DESIGN §8.2 specifies ("accel 20 Hz").
///
/// A file-scope constant on purpose (WO L2.2): the phone's `motion` evidence in
/// `packages/engine` was tuned against the mean of |a| taken at **this** rate, so a night
/// recorded at another rate would store numbers that mean something different while
/// looking identical. One name, one place to change it, and the interval below is derived
/// from it rather than written twice.
let ACCEL_HZ: Double = 20.0

final class MotionManager {
    /// Kept as an alias of {@link ACCEL_HZ} so older call sites keep compiling.
    static let sampleRate: Double = ACCEL_HZ

    private let manager = CMMotionManager()
    private let queue = OperationQueue()

    /// Running sum of |a| and the sample count for the epoch in progress.
    private var energySum: Double = 0
    private var sampleCount: Int = 0
    private let lock = NSLock()

    init() {
        queue.name = "app.dreaming.motion"
        queue.maxConcurrentOperationCount = 1
        // 20 Hz → one sample every 0.05 s. Written as `1.0 / ACCEL_HZ` so the two numbers
        // can never drift apart.
        manager.accelerometerUpdateInterval = 1.0 / ACCEL_HZ
    }

    var isAvailable: Bool {
        manager.isAccelerometerAvailable
    }

    func start() {
        guard manager.isAccelerometerAvailable, !manager.isAccelerometerActive else { return }
        manager.startAccelerometerUpdates(to: queue) { [weak self] data, _ in
            guard let self, let data else { return }
            // CMAcceleration is in g and includes gravity; |a| - 1 removes the constant
            // 1 g pull, so a still wrist reads ~0 whatever the wrist orientation is.
            let magnitude = sqrt(
                data.acceleration.x * data.acceleration.x
                    + data.acceleration.y * data.acceleration.y
                    + data.acceleration.z * data.acceleration.z
            )
            let energy = abs(magnitude - 1.0)

            self.lock.lock()
            self.energySum += energy
            self.sampleCount += 1
            self.lock.unlock()
        }
    }

    func stop() {
        guard manager.isAccelerometerActive else { return }
        manager.stopAccelerometerUpdates()
        lock.lock()
        energySum = 0
        sampleCount = 0
        lock.unlock()
    }

    /// Mean |a| for the epoch that just ended, then reset. `nil` when no sample arrived,
    /// so the phone can tell "wrist perfectly still" apart from "accelerometer dead".
    func drainEpochMean() -> Double? {
        lock.lock()
        defer {
            energySum = 0
            sampleCount = 0
            lock.unlock()
        }
        guard sampleCount > 0 else { return nil }
        return energySum / Double(sampleCount)
    }
}

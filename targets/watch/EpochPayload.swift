import Foundation

/// One 30-second epoch, exactly as the phone's `SensorEpochSchema` expects it
/// (`packages/engine/src/diagnostics.ts`). Keep the two in sync: the phone validates
/// every field and silently drops anything out of range, so a rename here shows up as
/// "no epochs arrived", not as a crash.
struct EpochPayload {
    /// Start of the epoch, in whole seconds since 1970, floored onto the 30 s grid.
    let t: Int
    /// Mean heart rate over the epoch, or `nil` when no beat was delivered.
    let hrMean: Double?
    /// Standard deviation of the heart rate over the epoch.
    let hrSd: Double?
    /// Mean |a| accelerometer energy over the epoch, in g, gravity removed.
    let motion: Double?
    /// Watch battery, 0...1. The single most important number for the R1 decision.
    let battery: Double?

    /// `WCSession` only accepts property-list types, so everything is a plain
    /// `NSNumber`/`Int`/`Double` and absent values are simply left out of the dictionary.
    var dictionary: [String: Any] {
        var payload: [String: Any] = ["t": t]
        if let hrMean { payload["hrMean"] = hrMean }
        if let hrSd { payload["hrSd"] = hrSd }
        if let motion { payload["motion"] = motion }
        if let battery { payload["battery"] = battery }
        return payload
    }
}

/// Length of one epoch. Must match `EPOCH_SECONDS` in `packages/engine/src/clock.ts`.
let epochSeconds: Int = 30

/// Floor a date onto the epoch grid, so the phone can dedupe by value.
func epochIndex(for date: Date, now epoch: Int = epochSeconds) -> Int {
    let seconds = Int(date.timeIntervalSince1970)
    return seconds - (seconds % epoch)
}

import ExpoModulesCore
import HealthKit

/**
 Read-only HealthKit bridge (WO L2.9's native half, built in L2.2n · DESIGN §5).

 What it is for: the morning after a night, Apple's own sleep staging is the closest thing we
 have to a reference answer for our REM estimate (`src/health/appleSleep.ts` →
 `remMetrics` in `packages/engine`). It is never used *during* a night — the night runs on live
 epochs from the watch, and HealthKit's stages only exist hours later anyway.

 ## Two honest limitations, both deliberate

 1. **"Did the user grant read access?" cannot be answered.** HealthKit hides read denial on
    purpose: a query on a denied type returns an *empty* result, not an error, so that an app
    cannot tell "you denied me" from "you have no data" (Apple's own privacy design).
    `requestAuthorization` therefore answers the only question that *is* answerable —
    "has the user now been asked about every type we need?" — via
    `getRequestStatusForAuthorization`. `src/health/appleSleep.ts` already treats an empty read
    exactly like a refusal ("no Apple data yet", never "0%"), which is what makes this safe.
 2. **`asleepUnspecified` samples are skipped, not turned into a stage.** A sample that says
    "asleep, stage unknown" (older watchOS, iPhone-only sleep tracking, third-party writers)
    cannot be mapped to CORE/DEEP/REM without inventing information. Skipping it leaves those
    minutes out of the comparison, which is honest; calling them CORE would silently count them
    as evidence that we were wrong about REM.

 ⚠️ Not compiled — no macOS/Xcode here (APP-RUN §0.3 item 2). R1 checklist in
 `ledger/wo-notes/L2.2n.md`.
 */
public final class LucidHealthModule: Module {
  private let store = HKHealthStore()

  private var readTypes: Set<HKObjectType> {
    var types = Set<HKObjectType>()
    types.insert(HKQuantityType(.heartRate))
    types.insert(HKCategoryType(.sleepAnalysis))
    return types
  }

  public func definition() -> ModuleDefinition {
    Name("LucidHealth")

    /// `false` on iPad and anywhere HealthKit is not present at all.
    Function("isAvailable") { () -> Bool in
      HKHealthStore.isHealthDataAvailable()
    }

    /// Shows the system sheet if it has not been answered yet. Resolves `true` when every type we
    /// need has been asked about (see limitation 1 in the class comment) — never a claim that data
    /// will actually arrive.
    AsyncFunction("requestAuthorization") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve(false)
        return
      }
      self.store.requestAuthorization(toShare: [], read: self.readTypes) { _, error in
        if let error {
          promise.reject(HealthAuthorizationException(error.localizedDescription))
          return
        }
        self.store.getRequestStatusForAuthorization(toShare: [], read: self.readTypes) { status, _ in
          // `.unnecessary` = "there is nothing left to ask about", i.e. the user has answered.
          // `.shouldRequest` after a completed request means the sheet was dismissed without an
          // answer, and `.unknown` means HealthKit could not tell us — both are "not asked yet".
          promise.resolve(status == .unnecessary)
        }
      }
    }

    /// Apple's sleep stages for a window, oldest first.
    ///
    /// `startIso`/`endIso` are ISO-8601 strings with an offset (the app builds them from the
    /// night's own timestamps). Returns `[{ start, end, stage }]` with `stage` one of
    /// `REM`/`CORE`/`DEEP`/`AWAKE`/`IN_BED` — the exact union of `SleepStage` in
    /// `apps/mobile/src/platform/types.ts`. An empty array means "Apple has nothing for that
    /// window", which is a normal answer, not a failure.
    AsyncFunction("readSleepStages") { (startIso: String, endIso: String, promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve([[String: Any]]())
        return
      }
      guard let start = IsoDate.parse(startIso), let end = IsoDate.parse(endIso) else {
        promise.reject(InvalidRangeException("\(startIso) … \(endIso)"))
        return
      }

      // No `.strictStartDate`: the default is "overlaps the window", and a stage that began a
      // minute before lights-out is still the right answer for the minutes inside the night.
      // The app clips to its own 30 s epoch grid (`src/health/appleSleep.ts`).
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
      let query = HKSampleQuery(
        sampleType: HKCategoryType(.sleepAnalysis),
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [sort]
      ) { _, samples, error in
        if let error {
          promise.reject(HealthQueryException(error.localizedDescription))
          return
        }
        let phases: [[String: Any]] = (samples ?? []).compactMap { sample in
          guard let category = sample as? HKCategorySample,
                let stage = SleepStageMapping.name(for: category.value)
          else { return nil }
          return [
            "start": IsoDate.format(category.startDate),
            "end": IsoDate.format(category.endDate),
            "stage": stage,
          ]
        }
        promise.resolve(phases)
      }
      self.store.execute(query)
    }

    /// Heart-rate samples in the same window, oldest first: `[{ atIso, bpm }]`. Used to sanity
    /// check the watch's own per-epoch means against what HealthKit ended up storing.
    AsyncFunction("readHeartRate") { (startIso: String, endIso: String, promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve([[String: Any]]())
        return
      }
      guard let start = IsoDate.parse(startIso), let end = IsoDate.parse(endIso) else {
        promise.reject(InvalidRangeException("\(startIso) … \(endIso)"))
        return
      }

      let unit = HKUnit.count().unitDivided(by: .minute())
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
      let query = HKSampleQuery(
        sampleType: HKQuantityType(.heartRate),
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [sort]
      ) { _, samples, error in
        if let error {
          promise.reject(HealthQueryException(error.localizedDescription))
          return
        }
        let beats: [[String: Any]] = (samples ?? []).compactMap { sample in
          guard let quantity = sample as? HKQuantitySample else { return nil }
          return [
            "atIso": IsoDate.format(quantity.startDate),
            "bpm": quantity.quantity.doubleValue(for: unit),
          ]
        }
        promise.resolve(beats)
      }
      self.store.execute(query)
    }
  }
}

/// `HKCategoryValueSleepAnalysis` → the `SleepStage` union the app uses. The one place this
/// mapping exists on the native side; its twin in prose is the comment on `IosHealthImport`.
private enum SleepStageMapping {
  static func name(for value: Int) -> String? {
    // Unwrapped first: `switch` over an `Optional<HKCategoryValueSleepAnalysis>` would need
    // `case .inBed?` everywhere, and an unknown raw value is the same "drop it" as
    // `asleepUnspecified` anyway.
    guard let stage = HKCategoryValueSleepAnalysis(rawValue: value) else { return nil }
    switch stage {
    case .inBed:
      return "IN_BED"
    case .awake:
      return "AWAKE"
    case .asleepREM:
      return "REM"
    case .asleepCore:
      return "CORE"
    case .asleepDeep:
      return "DEEP"
    case .asleepUnspecified:
      // "Asleep, stage unknown" — see limitation 2 in the module comment. Dropped rather than
      // guessed at.
      return nil
    default:
      return nil
    }
  }
}

/// ISO-8601 in and out. Two parsers because HealthKit windows are built by JavaScript, where
/// `Date.toISOString()` always has milliseconds but a hand-written range may not.
private enum IsoDate {
  private static let withFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let withoutFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  static func parse(_ value: String) -> Date? {
    withFraction.date(from: value) ?? withoutFraction.date(from: value)
  }

  /// Always UTC with milliseconds, which is exactly what `new Date(...)` and `@lucid/data`'s
  /// `isoFromEpochSeconds` round-trip without surprises.
  static func format(_ date: Date) -> String {
    withFraction.string(from: date)
  }
}

internal final class HealthAuthorizationException: GenericException<String> {
  override var reason: String {
    "HealthKit refused the authorization request: \(param)"
  }
}

internal final class HealthQueryException: GenericException<String> {
  override var reason: String {
    "HealthKit query failed: \(param)"
  }
}

internal final class InvalidRangeException: GenericException<String> {
  override var reason: String {
    "Not an ISO-8601 range: \(param)"
  }
}

import Foundation
import WidgetKit

/// The one number the watch face is allowed to show: how many nights in a row this person
/// has run a night (APP-RUN §2 L2.2 "complication streak").
///
/// Who owns the number: **the phone**. The streak is a fact about the SQLite journal
/// (`packages/data`), so the watch never computes it — it stores whatever the phone last
/// told it and shows a dash until it has been told once (DESIGN §2.2: no invented numbers,
/// and the lesson `reference_one_status_two_meanings` — one number must not mean two
/// different things depending on which device you read it on).
///
/// How it gets across: `LucidWatchLinkModule.setStreakNights(_:)` on the phone sends
/// `{"streakNights": n}` through `WCSession` (`updateApplicationContext`, so the newest
/// value survives the watch being asleep), `PhoneLink` writes it here, and
/// `WidgetCenter.shared.reloadAllTimelines()` makes WidgetKit ask the complication for a
/// fresh timeline. The complication itself runs in **another process** and can only read
/// shared storage, which is why this goes through an App Group and not a plain
/// `UserDefaults.standard`.
///
/// ⚠️ App Group containers are per-device: the iPhone's `group.cloud.suksomsri.dreaming` container and
/// the Watch's are two different places that never sync. That is the whole reason the value
/// has to travel over WatchConnectivity first.
enum SharedStore {
    /// Must match `com.apple.security.application-groups` in **both**
    /// `targets/watch/expo-target.config.js` and `targets/watch-complication/expo-target.config.js`
    /// (and the phone side in `apps/mobile/app.config.ts`). Duplicated as a literal in the
    /// complication target too, because Xcode targets do not share Swift code here — keep
    /// the three in sync by hand; a typo shows up as a complication stuck on "—", never as a
    /// crash.
    static let appGroup = "group.cloud.suksomsri.dreaming"

    enum Key {
        static let streakNights = "streak.nights"
        static let streakUpdatedAt = "streak.updatedAt"
    }

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }
}

enum StreakStore {
    /// Store the phone's number and ask WidgetKit for a redraw. Negative values are ignored
    /// rather than clamped: a negative streak means the sender is broken, and showing 0 would
    /// hide that.
    static func write(nights: Int, at date: Date = Date()) {
        guard nights >= 0, let defaults = SharedStore.defaults else { return }
        defaults.set(nights, forKey: SharedStore.Key.streakNights)
        defaults.set(date.timeIntervalSince1970, forKey: SharedStore.Key.streakUpdatedAt)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// `nil` when the phone has never sent a streak on this watch — the complication shows a
    /// dash for that, not a zero.
    static func read() -> Int? {
        guard let defaults = SharedStore.defaults,
              defaults.object(forKey: SharedStore.Key.streakNights) != nil
        else { return nil }
        return defaults.integer(forKey: SharedStore.Key.streakNights)
    }
}

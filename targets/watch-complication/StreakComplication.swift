import SwiftUI
import WidgetKit

/// The watch-face complication: how many nights in a row (APP-RUN §2 L2.2).
///
/// It is a **reader only**. The number is written by the watch app into the shared App
/// Group (`targets/watch/StreakStore.swift`), which in turn only ever repeats what the phone
/// told it — one number, one owner (`reference_one_status_two_meanings`). When nothing has
/// been written yet it shows a dash, never a zero: "we have not been told" and "you have no
/// streak" are different facts and the watch face must not conflate them (DESIGN §2.2).
///
/// Two families, the two that fit the design (DESIGN §10 image 10): `accessoryCircular` for
/// the small round slot and `accessoryRectangular` for the wide one. No `accessoryInline`/
/// `accessoryCorner`: they would repeat the same number in a shape nobody asked for, and
/// every extra family is one more thing to keep honest.
///
/// ⚠️ The strings and the app-group name are duplicated from the watch app on purpose —
/// separate Xcode targets, no shared Swift module here. See the comment in
/// `targets/watch/StreakStore.swift`.

/// Must match `SharedStore.appGroup` in `targets/watch/StreakStore.swift` and the
/// `com.apple.security.application-groups` entitlement in both target configs.
private enum Shared {
    static let appGroup = "group.app.dreaming"
    static let streakKey = "streak.nights"

    /// `nil` = the phone has never sent a streak to this watch.
    static func streakNights() -> Int? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              defaults.object(forKey: streakKey) != nil
        else { return nil }
        return defaults.integer(forKey: streakKey)
    }
}

struct StreakEntry: TimelineEntry {
    let date: Date
    /// `nil` renders the dash.
    let nights: Int?
}

struct StreakProvider: TimelineProvider {
    /// The widget gallery preview. A fixed, obviously-illustrative number.
    func placeholder(in context: Context) -> StreakEntry {
        StreakEntry(date: Date(), nights: 7)
    }

    func getSnapshot(in context: Context, completion: @escaping (StreakEntry) -> Void) {
        completion(StreakEntry(date: Date(), nights: context.isPreview ? 7 : Shared.streakNights()))
    }

    /// One entry, no schedule: the streak only ever changes because the watch app wrote a new
    /// value and called `WidgetCenter.shared.reloadAllTimelines()`. Asking WidgetKit to
    /// refresh us on a timer would spend the widget's budget on redraws of a number that did
    /// not move — and `.never` still lets the reload happen immediately when it does.
    func getTimeline(in context: Context, completion: @escaping (Timeline<StreakEntry>) -> Void) {
        let entry = StreakEntry(date: Date(), nights: Shared.streakNights())
        completion(Timeline(entries: [entry], policy: .never))
    }
}

struct StreakComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: StreakEntry

    private var value: String {
        guard let nights = entry.nights else { return "—" }
        return String(nights)
    }

    /// watchOS 10 and later require every widget to declare its container background — without
    /// it the system may drop the content instead of drawing it. Applied once here so both
    /// families get it and neither can forget.
    var body: some View {
        content
            .containerBackground(for: .widget) { Color.clear }
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: -2) {
                    Text(value)
                        .font(.system(.title3, design: .rounded).weight(.semibold))
                        .monospacedDigit()
                    Text(String(localized: "complication.unit.short"))
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
            }
        default:
            // accessoryRectangular (and anything a future watchOS adds to this slot).
            VStack(alignment: .leading, spacing: 1) {
                Text(String(localized: "complication.title"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let nights = entry.nights {
                    Text(String(format: String(localized: "complication.nights"), nights))
                        .font(.system(.body, design: .rounded).weight(.semibold))
                } else {
                    Text(String(localized: "complication.nights.unknown"))
                        .font(.system(.body, design: .rounded).weight(.semibold))
                }
            }
        }
    }
}

struct StreakComplication: Widget {
    /// Stable across releases: WidgetKit keys the user's placed complications by this string,
    /// so renaming it would silently empty their watch face.
    static let kind = "app.dreaming.complication.streak"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: StreakComplication.kind, provider: StreakProvider()) { entry in
            StreakComplicationView(entry: entry)
        }
        .configurationDisplayName(String(localized: "complication.title"))
        .description(String(localized: "complication.description"))
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}

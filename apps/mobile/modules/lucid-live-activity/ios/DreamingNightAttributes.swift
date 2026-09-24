import ActivityKit
import Foundation

/// The shape of the night's Live Activity.
///
/// # 🔴 This file exists twice, on purpose
///
/// The identical declaration lives in `targets/live-activity/DreamingNightAttributes.swift`
/// (this copy is the app-side one — the two files are byte-identical apart from this
/// paragraph, and `scripts/qc-L2.2.sh`'s reviewer should diff them). The app half
/// (which calls `Activity.request/update/end`) is compiled into a **CocoaPods module**, this
/// half into the **widget extension**; Swift has no way to share a type between the two
/// without introducing a shared framework target, which `@bacons/apple-targets` does not
/// generate. ActivityKit matches the running activity to its `ActivityConfiguration` by the
/// attributes' *type name*, not by module, so two identical declarations are what Apple's own
/// "add the file to both targets" instruction produces anyway.
///
/// Rules for whoever edits it:
///  1. change both copies in the same commit — the field names are the wire format;
///  2. adding a field to `ContentState` is safe; **renaming or removing** one breaks decoding
///     for an activity that is already on screen from a previous app version;
///  3. keep it `Codable` + `Hashable` and keep every field a plain value type. ActivityKit
///     encodes this into a system process; anything clever will simply not arrive.
///
/// Fixed vs changing (ActivityKit's own split):
///  - `theme` never changes during a night — the dream plan is frozen at bedtime
///    (DESIGN §3.2), so it is a static attribute set once by `start()`;
///  - everything the app updates as the night goes on lives in `ContentState`.
///
/// Every string here is **already translated** by the app (`LiveStatusContent.headline`'s own
/// contract in `apps/mobile/src/platform/types.ts`: "this layer never translates"). The widget
/// only ever localises words of its own, from `Localizable.xcstrings`.
struct DreamingNightAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// One short, already-translated line: "เฝ้าอยู่" / "Watching" (engine `LIVE_TEXT_KEYS`).
        public var status: String
        /// Whispers played so far tonight.
        public var cuesPlayed: Int
        /// The ceiling for tonight (DESIGN §5.3 — 8 by default).
        public var cuesPlanned: Int

        public init(status: String, cuesPlayed: Int, cuesPlanned: Int) {
            self.status = status
            self.cuesPlayed = cuesPlayed
            self.cuesPlanned = cuesPlanned
        }
    }

    /// Emoji + theme title on one already-translated line: "🐋 ดำน้ำกับฉลามวาฬ"
    /// (DESIGN §4-05 screen ข).
    public var theme: String

    public init(theme: String) {
        self.theme = theme
    }
}

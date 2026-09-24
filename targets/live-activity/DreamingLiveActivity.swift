import ActivityKit
import SwiftUI
import WidgetKit

/// The lock-screen card and the Dynamic Island for a running night
/// (DESIGN §4-05 screen ข: "🐋 ดำน้ำกับฉลามวาฬ · เฝ้าอยู่ · กระซิบ 2/8 · ปุ่ม หยุด").
///
/// What is deliberately **not** here:
///  - the REM percentage. The mockup's lock screen does not show it, and a number on the lock
///    screen invites reading it at 03:00 — the phone screen has the orb for that (DESIGN §2.1,
///    sleep first).
///  - any decision. The card draws exactly what the app put in the content state.
///
/// The stop button is a `Link` (see {@link DreamingLinks}) that opens the app with the night
/// screen and a `stop=1` flag; `IosLiveStatus` listens for it and calls
/// `NightController.userStop()`. An `AppIntent` button would stop the night *without* opening
/// the app, but it cannot reach the running `NightController` inside the JS runtime — it would
/// have to write a flag a future app launch reads, which is exactly the kind of second source
/// of truth that ends in a night that is "stopped" in one place and running in another.
///
/// Tapping the card itself (or the Dynamic Island) only *opens* the app — it never stops the
/// night. A lock-screen card is exactly what a sleepy hand brushes at 03:00, and the whole
/// point of hold-to-stop (DESIGN §10) is that one accidental touch must not end the night.
struct DreamingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DreamingNightAttributes.self) { context in
            LockScreenView(theme: context.attributes.theme, state: context.state)
                .widgetURL(DreamingLinks.open)
                .activityBackgroundTint(Color("$widgetBackground"))
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.theme)
                        .font(.caption)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(whisperCount(context.state))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Color("$mint"))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.state.status)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        StopLink()
                    }
                }
            } compactLeading: {
                Text(themeEmoji(context.attributes.theme))
            } compactTrailing: {
                Text(whisperCount(context.state))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Color("$mint"))
            } minimal: {
                Text(themeEmoji(context.attributes.theme))
            }
            .widgetURL(DreamingLinks.open)
        }
    }

    /// "2/8" — the shortest honest form of the whisper counter for the Island's tiny slots.
    private func whisperCount(_ state: DreamingNightAttributes.ContentState) -> String {
        "\(state.cuesPlayed)/\(state.cuesPlanned)"
    }

    /// First character of the already-composed theme line ("🐋 ดำน้ำ…" → "🐋"). The emoji and
    /// the title arrive as one string because the app composes the line it wants shown; taking
    /// the first character back out is only ever for the Island's one-glyph slots, and if the
    /// app ever sends a line without an emoji this just shows its first letter rather than
    /// inventing an icon.
    private func themeEmoji(_ theme: String) -> String {
        theme.first.map(String.init) ?? "🌙"
    }
}

enum DreamingLinks {
    /// Scheme is `scheme: 'dreaming'` from `apps/mobile/app.config.ts`.
    ///
    /// 🔴 Why `dreaming://night?stop=1` and not the `dreaming://stop` the work order asked
    /// for: every incoming URL goes through expo-router's linking, and `apps/mobile/app/` has
    /// **no** `stop` route (checked: the routes are `(tabs)`, `night`, `plan/*`, `report/[id]`,
    /// `onboarding/*`, `history`, `diagnostics`, `dev/ui`). An unmatched path makes expo-router
    /// render its auto-generated "Unmatched Route" screen — i.e. the stop button would cover
    /// the night with an error page instead of ending it. Pointing at the route that already
    /// exists lands the user where they should be (the night screen) *and* carries the
    /// intention in the query string. `IosLiveStatus` accepts `dreaming://stop` too, so if a
    /// later work order adds that route nothing here has to change.
    static let stop = URL(string: "dreaming://night?stop=1") ?? URL(fileURLWithPath: "/")

    /// Tapping the card / the Dynamic Island: open the night screen, change nothing.
    static let open = URL(string: "dreaming://night") ?? URL(fileURLWithPath: "/")
}

/// The one button on the card (DESIGN §4-05 screen ข "ปุ่ม หยุด").
private struct StopLink: View {
    var body: some View {
        Link(destination: DreamingLinks.stop) {
            Text(String(localized: "live.stop"))
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.14), in: Capsule())
        }
        .accessibilityLabel(String(localized: "live.stop.accessibility"))
    }
}

private struct LockScreenView: View {
    let theme: String
    let state: DreamingNightAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                // Line 1: 🐋 ดำน้ำกับฉลามวาฬ
                Text(theme)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)

                // Line 2: เฝ้าอยู่
                Text(state.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                // Line 3: กระซิบ 2/8 · เงียบทันทีถ้าคุณตื่น
                Text(whisperLine)
                    .font(.caption2)
                    .foregroundStyle(Color("$mint"))
                    .lineLimit(2)
            }

            Spacer(minLength: 4)

            StopLink()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    /// "กระซิบ 2/8 · เงียบทันทีถ้าคุณตื่น" — the promise the plan card already made
    /// (`plan.tonight.full` in the app's i18n) repeated where the user can see it at 03:00.
    private var whisperLine: String {
        String(format: String(localized: "live.whispers"), Int64(state.cuesPlayed), Int64(state.cuesPlanned))
    }
}

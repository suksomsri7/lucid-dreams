import SwiftUI
import WidgetKit

/// Entry point of the iPhone widget extension.
///
/// Only the Live Activity today — Dreaming has no home-screen widget (nothing about a night is
/// worth a square on the home screen; the lock screen is where a sleeping person's phone is).
/// A future widget would be a second line in `body`, not a second target.
@main
struct DreamingLiveBundle: WidgetBundle {
    var body: some Widget {
        DreamingLiveActivity()
    }
}

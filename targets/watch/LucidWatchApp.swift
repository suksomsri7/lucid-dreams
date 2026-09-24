import SwiftUI

/// watchOS entry point.
///
/// The watch app exists for one reason (DESIGN §8.1): it is the only Apple device that
/// gives per-second heart rate plus wrist motion for a whole night. Everything it does
/// is aggregate-and-send; all judgement lives on the phone in `packages/engine`.
@main
struct LucidWatchApp: App {
    init() {
        // Battery level is one of the two numbers the R1 night has to answer
        // (APP-RUN §2: "watch battery at the start and at the end"), and the reading is
        // only available once monitoring is switched on.
        WatchBattery.enableMonitoring()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

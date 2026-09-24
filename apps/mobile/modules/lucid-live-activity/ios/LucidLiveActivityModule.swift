import ActivityKit
import ExpoModulesCore

/**
 The app half of the night's Live Activity (WO L1.7's "Live Activity (ActivityKit ผ่าน native
 module)", built in L2.2n · DESIGN §3.4 / §4-05 screen ข).

 Three calls, mirroring `LiveStatus` in `apps/mobile/src/platform/types.ts`:
 `start` → `update` (once per state change) → `end`. The view is drawn by the widget extension
 in `targets/live-activity`; this module never draws anything and never decides anything — the
 already-translated status line arrives from JavaScript (`LiveStatusContent.headline`).

 ## Things that are easy to get wrong here, and how this handles them

 - **No state of its own.** ActivityKit activities outlive the app process, so
   `Activity<DreamingNightAttributes>.activities` — the system's own list — is the only source of
   truth. Keeping a `var activity` here would go stale the moment the app was killed and
   relaunched mid-night, leaving a card the user cannot get rid of (and it would be mutable state
   captured by concurrent closures, for no gain).
 - **`areActivitiesEnabled` is a user setting.** It can be off (Settings › Face ID & Passcode ›
   Live Activities, or per app). `isSupported()` reports it honestly so the app can skip the whole
   thing rather than believe a card is on screen (§0.5 S10: never claim what we do not have).
 - **`start` twice must not leave two cards.** If one is already running it is updated instead.
 - **`staleDate: nil` on purpose.** A night can legitimately go three hours without a state change
   (the quiet guard window, DESIGN §5.3); a stale date would grey out a perfectly correct card in
   the middle of the night.
 - **`end` uses `.immediate`.** `.default` keeps the card on the lock screen for up to four hours
   after the night is over.

 ⚠️ Not compiled — no macOS/Xcode here (APP-RUN §0.3 item 2). R1 checklist in
 `ledger/wo-notes/L2.2n.md`.
 */
public final class LucidLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LucidLiveActivity")

    /// `false` when the user (or the device) has Live Activities switched off. Synchronous: the
    /// night-start path should not wait on a promise for a local flag.
    Function("isSupported") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("start") { (theme: String, status: String, cuesPlayed: Int, cuesPlanned: Int) in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        throw ActivitiesDisabledException()
      }

      let content = ActivityContent(
        state: DreamingNightAttributes.ContentState(
          status: status,
          cuesPlayed: cuesPlayed,
          cuesPlanned: cuesPlanned
        ),
        staleDate: nil
      )

      if let running = Activity<DreamingNightAttributes>.activities.first {
        await running.update(content)
        return
      }

      do {
        _ = try Activity.request(
          attributes: DreamingNightAttributes(theme: theme),
          content: content,
          // No push updates: every number comes from the phone itself while the app is alive
          // (DESIGN §7 — nothing about a night has to leave the device for a lock screen).
          pushType: nil
        )
      } catch {
        throw ActivityRequestFailedException(error.localizedDescription)
      }
    }

    /// One update per state change (the engine's `LIVE` action). Does nothing when no card is
    /// running: a night must never fail because the lock screen is showing nothing.
    AsyncFunction("update") { (status: String, cuesPlayed: Int, cuesPlanned: Int) in
      guard let running = Activity<DreamingNightAttributes>.activities.first else {
        return
      }
      await running.update(
        ActivityContent(
          state: DreamingNightAttributes.ContentState(
            status: status,
            cuesPlayed: cuesPlayed,
            cuesPlanned: cuesPlanned
          ),
          staleDate: nil
        )
      )
    }

    /// Ends every card of this type immediately. Safe to call when nothing is running.
    AsyncFunction("end") {
      for running in Activity<DreamingNightAttributes>.activities {
        await running.end(
          ActivityContent(state: running.content.state, staleDate: nil),
          dismissalPolicy: .immediate
        )
      }
    }
  }
}

internal final class ActivitiesDisabledException: Exception {
  override var reason: String {
    "Live Activities are turned off for this device or this app"
  }
}

internal final class ActivityRequestFailedException: GenericException<String> {
  override var reason: String {
    "ActivityKit refused to start the night's Live Activity: \(param)"
  }
}

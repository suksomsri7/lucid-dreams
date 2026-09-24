/**
 * Live Activity (lock screen + Dynamic Island) for Dreaming — DESIGN §3.4 / §4-05 screen ข,
 * APP-RUN §2 L1.7 ("Live Activity (ActivityKit ผ่าน native module): ธีม · สถานะ · กระซิบ n/8 ·
 * ปุ่มหยุด (deep link)").
 *
 * `type: 'widget'` is the WidgetKit app-extension for iOS; ActivityKit is in the frameworks
 * `@bacons/apple-targets` already gives that type (`WidgetKit`, `SwiftUI`, `ActivityKit`,
 * `AppIntents`), and the plugin embeds it into the main iPhone app. The *starting* of the
 * activity happens in `apps/mobile/modules/lucid-live-activity` (a pod, i.e. a different
 * Swift module) — which is why `DreamingNightAttributes.swift` exists twice; see the long
 * comment at the top of that file before "fixing" the duplication.
 *
 * App group: `appGroupsByDefault` is true for `type: 'widget'`, so apple-targets copies
 * `com.apple.security.application-groups` from `apps/mobile/app.config.ts`'s `ios.entitlements`
 * (`group.app.dreaming`). Nothing here reads it today — every value the view draws arrives
 * inside the activity's own content state — but the entitlement keeps this target and the app
 * in the same group, which is what ActivityKit's push-token work (L3.x) will need.
 *
 * ESM and TypeScript are not supported in this file — plain CommonJS only.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',
  name: 'DreamingLive',
  displayName: 'Dreaming',

  // iOS 16.2 is the floor for `ActivityConfiguration`; the app itself does not pin a
  // deployment target (Liquid Glass is detected at runtime — see app.config.ts), so this is
  // the one place the ActivityKit requirement is written down. 18.0 is apple-targets' own
  // default for widgets and is well above 16.2, so nothing is lost by keeping it.
  deploymentTarget: '18.0',

  colors: {
    $accent: { color: '#6C4CE0', darkColor: '#9C86F2' },
    // Lock-screen background behind the activity: the exact `night.bg` from
    // `apps/mobile/src/ui/tokens.ts`, so the lock screen and the in-app night screen look
    // like one thing at 03:00.
    $widgetBackground: { color: '#0b0f1a', darkColor: '#0b0f1a' },
    // `night.chipRemText` — the mint the app uses for anything REM-ish.
    $mint: { color: '#5ee6c0', darkColor: '#5ee6c0' },
  },
};

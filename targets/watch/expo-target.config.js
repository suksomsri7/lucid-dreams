/**
 * watchOS target for Dreaming, embedded through `@bacons/apple-targets`.
 *
 * `apps/mobile/app.config.ts` points the plugin at this folder with
 * `{ root: '../../targets' }`, so the Swift sources stay outside the generated
 * `ios/` project (Continuous Native Generation — `expo prebuild` can be re-run at
 * any time without losing them).
 *
 * ESM and TypeScript are not supported in this file — plain CommonJS only.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'watch',
  name: 'LucidWatch',
  displayName: 'Dreaming',

  // watchOS 11 covers Series 6 and later, which is everything that can run a long
  // mindAndBody workout session overnight without dying (DESIGN §8.1).
  deploymentTarget: '10.0', // ลดจาก 11.0 (25 ก.ย.): นาฬิกาเจ้าของ SE2 ยังอยู่ watchOS 10.6.2 · ถ้า compile ติด availability ให้กลับเป็น 11.0

  /**
   * The watch app's icon (WO L3.7 §B1). Path is resolved relative to *this folder*
   * (`with-widget.js`: `props.icon = path.join(props.directory, props.icon)`), and the file it
   * points at is the same 1024² M icon `apps/mobile/assets/icon.png` is — byte for byte, same
   * md5 — so phone and watch cannot drift apart.
   *
   * ⚠️ This key is **required**, dropping the `AppIcon.appiconset` into this folder by hand is
   * not enough: `@bacons/apple-targets` only writes
   * `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` into the target's build settings when
   * `props.icon` is set (`build/configuration-list.js`, `...(icon && { … })` in
   * `createWatchAppConfigurationList`). Without it Xcode compiles the catalog but never marks
   * the set as the app icon, and the watch app ships with the generic placeholder.
   *
   * What the plugin then does with it (`build/icon/with-ios-icon.js`, `type: 'watch'` branch):
   * it regenerates a 1024×1024 `App-Icon-1024x1024@1x.png` next to this file and rewrites that
   * folder's `Contents.json` to point at it. So `icon-1024.png` stays as the checked-in source
   * and the generated twin appears beside it after the first `expo prebuild`.
   */
  icon: './Assets.xcassets/AppIcon.appiconset/icon-1024.png',

  // WidgetKit is here for `StreakStore.swift`'s `WidgetCenter.shared.reloadAllTimelines()`
  // — the watch app itself draws no widget, it only tells WidgetKit that the number behind
  // the complication in `targets/watch-complication` changed (WO L2.2).
  frameworks: ['SwiftUI', 'HealthKit', 'CoreMotion', 'WatchConnectivity', 'WidgetKit'],

  entitlements: {
    // The watch reads live heart rate through HKLiveWorkoutBuilder and writes the
    // mindAndBody workout itself, so it needs both sides of HealthKit.
    'com.apple.developer.healthkit': true,
    'com.apple.developer.healthkit.access': [],
    // Required for a workout session to keep running while the wrist is down.
    'com.apple.developer.healthkit.background-delivery': true,
    // Shared with `targets/watch-complication` only: the complication runs in its own
    // process and can read the streak nowhere else (see `StreakStore.swift`). The iPhone's
    // container of the same name is a *different* place — App Groups do not sync between
    // devices — which is why the number travels over WatchConnectivity first.
    // ⚠️ `type: 'watch'` is not in apple-targets' app-groups-by-default list, so this has to
    // be written out here; the complication target inherits it from the main app instead.
    'com.apple.security.application-groups': ['group.cloud.suksomsri.dreaming'],
  },

  colors: {
    $accent: { color: '#6C4CE0', darkColor: '#9C86F2' },
  },
};

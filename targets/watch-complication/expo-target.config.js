/**
 * watchOS complication for Dreaming — "nights in a row", on the watch face
 * (APP-RUN §2 L2.2 "complication streak" · DESIGN §10, image 10).
 *
 * `type: 'watch-widget'` is `@bacons/apple-targets`' WidgetKit-on-watchOS target: an
 * app-extension with `WATCHOS_DEPLOYMENT_TARGET`, embedded into the **watch app** (not the
 * iPhone app) by the plugin's `isWatchOSExtensionTarget()` branch. Modern watchOS
 * complications are WidgetKit widgets with `accessory*` families — `CLKComplication` has
 * been deprecated since watchOS 9, so nothing here uses ClockKit.
 *
 * Why its own folder rather than a subfolder of `targets/watch`: the plugin discovers
 * targets with the glob `targets/<one level>/expo-target.config.@(json|js)`, so a nested
 * folder would never be picked up — and Xcode's synchronized-folder membership would have
 * compiled the complication's sources into the watch app as well.
 *
 * `bundleIdentifier` starts with a dot, which `with-widget.ts` appends to the **main app's**
 * id, giving `cloud.suksomsri.dreaming.watch.streak`. That prefix matters: an embedded binary
 * must sit under its host's identifier, and the host here is the watch app
 * (`cloud.suksomsri.dreaming.watch`, the default for `type: 'watch'`).
 *
 * ESM and TypeScript are not supported in this file — plain CommonJS only.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'watch-widget',
  name: 'LucidWatchComplication',
  displayName: 'Dreaming',
  bundleIdentifier: '.watch.streak', // เดิม '.watch.complication' — Apple ปฏิเสธชื่อนั้นตอนจด App ID (25 ก.ย.) จึงใช้ .watch.streak

  // Same floor as the watch app itself (targets/watch/expo-target.config.js).
  deploymentTarget: '10.0', // ลดจาก 11.0 (25 ก.ย.): นาฬิกาเจ้าของ SE2 ยังอยู่ watchOS 10.6.2 · ถ้า compile ติด availability ให้กลับเป็น 11.0

  frameworks: ['WidgetKit', 'SwiftUI'],

  entitlements: {
    // The only thing this extension is allowed to touch: the App Group the watch app writes
    // the streak into (`targets/watch/StreakStore.swift`). Written out rather than left to
    // apple-targets' "sync app groups from the main app" default, because the group that
    // matters here is the **watch's** container, and being explicit means a reviewer can see
    // the three copies (phone config, watch config, this file) line up.
    'com.apple.security.application-groups': ['group.cloud.suksomsri.dreaming'],
  },

  colors: {
    $accent: { color: '#6C4CE0', darkColor: '#9C86F2' },
  },
};

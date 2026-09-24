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
  deploymentTarget: '11.0',

  frameworks: ['SwiftUI', 'HealthKit', 'CoreMotion', 'WatchConnectivity'],

  entitlements: {
    // The watch reads live heart rate through HKLiveWorkoutBuilder and writes the
    // mindAndBody workout itself, so it needs both sides of HealthKit.
    'com.apple.developer.healthkit': true,
    'com.apple.developer.healthkit.access': [],
    // Required for a workout session to keep running while the wrist is down.
    'com.apple.developer.healthkit.background-delivery': true,
  },

  colors: {
    $accent: { color: '#6C4CE0', darkColor: '#9C86F2' },
  },
};

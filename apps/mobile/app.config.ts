/// <reference types="node" />
// This file runs under plain Node at `expo prebuild`/config-eval time (never bundled
// into the app), so it needs `@types/node` — the rest of `apps/mobile` deliberately does
// not pull it in globally (`expo/types`, referenced via `expo-env.d.ts`, covers the
// handful of Node-ish ambients the RN code itself needs, like `process.env`). Confirmed
// this one-file reference does not change `pnpm typecheck`'s result for any other file.
import fs from 'node:fs';
import path from 'node:path';

import { IOSConfig, withEntitlementsPlist, withXcodeProject, type ConfigPlugin } from '@expo/config-plugins';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const INFO_PLIST_LOCALES = ['en', 'th'] as const;

/**
 * Copies `locales/<lang>/InfoPlist.strings` into the generated Xcode project and **registers it**
 * (APP-RUN §0.5 S10 · WO L1.3, debt closed in L2.2n) so the system permission prompts iOS shows
 * are actually localised, not just the base `ios.infoPlist` English text below.
 *
 * L1.3 stopped at placing the files and left the Xcode wiring as a debt, on the grounds that
 * hand-rolled `.pbxproj` surgery without a Mac to test against was riskier than an honest gap.
 * What changed: this now uses `IOSConfig.XcodeUtils.addResourceFileToGroup` — the *same* helper
 * `@expo/config-plugins`' own `IOSConfig.Locales.withLocales` uses for exactly this file, on
 * exactly this path shape (`<project>/Supporting/<lang>.lproj/InfoPlist.strings`). So it is no
 * longer surgery, it is the supported call; the risk that argued for the debt is gone.
 *
 * Why not simply switch to Expo's `locales` config field, which would do all of this for free:
 * it reads **JSON** files, and `scripts/qc-L1.3.sh` (O4.5) checks for
 * `apps/mobile/locales/th/InfoPlist.strings`. Keeping the `.strings` files as the source of truth
 * keeps that oracle honest and keeps the file in the format a translator recognises; the copy
 * step below is the only difference from what Expo would have done.
 *
 * Note it is a resource file per locale rather than a `PBXVariantGroup`: a variant group is
 * Xcode's way of *displaying* the set as one item, while what makes iOS use them is each
 * `<lang>.lproj/InfoPlist.strings` being in the target's Resources build phase — which is what
 * this does, and what Expo's own implementation does.
 *
 * Defined inline here rather than in its own `plugins/*.ts` file: `expo/config`'s loader
 * transpiles this single file on the fly but does not run a second require through the
 * same TS-aware loader for a sibling relative import, so `require('./plugins/...')`
 * failed at prebuild with `Cannot find module` (confirmed by running the prebuild below
 * before moving the code here).
 */
const withInfoPlistLocales: ConfigPlugin = (config) =>
  withXcodeProject(config, (modConfig) => {
    const { platformProjectRoot, projectName, projectRoot } = modConfig.modRequest;
    if (!projectName) return modConfig;

    // Same directory Expo's own `withLocales` writes into, so the two can never end up with two
    // competing `en.lproj` folders in one project.
    const supportingDirectory = path.join(platformProjectRoot, projectName, 'Supporting');

    for (const locale of INFO_PLIST_LOCALES) {
      const source = path.join(projectRoot, 'locales', locale, 'InfoPlist.strings');
      if (!fs.existsSync(source)) continue;

      const targetDir = path.join(supportingDirectory, `${locale}.lproj`);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(source, path.join(targetDir, 'InfoPlist.strings'));

      const groupName = `${projectName}/Supporting/${locale}.lproj`;
      const group = IOSConfig.XcodeUtils.ensureGroupRecursively(modConfig.modResults, groupName);
      // Adding the same file twice would give Xcode two copies of one resource and a build
      // warning, so re-running prebuild over an existing project has to be a no-op here.
      // `PBXGroup['children']` is typed loosely by `xcode`'s own typings (the elements come back
      // as `any`), so the parameter is annotated here rather than left to inference — `tsc`'s
      // `noImplicitAny` would otherwise stop the build.
      const alreadyThere = group?.children.some(
        (child: { comment?: string }) => child.comment === 'InfoPlist.strings',
      );
      if (alreadyThere) continue;

      modConfig.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: path.join(`${locale}.lproj`, 'InfoPlist.strings'),
        groupName,
        project: modConfig.modResults,
        isBuildFile: true,
        verbose: true,
      });
    }

    return modConfig;
  });

/**
 * Data Protection entitlement (WO L1.7ui, closes part of the debt `ExpoSqliteDriver.ts`'s
 * `applyDataProtection()` logs: "relying on the iOS default class … until the native
 * config plugin lands" / `ledger/wo-notes/L1.8.md`).
 *
 * `com.apple.developer.default-data-protection` sets the **default** protection class
 * every file the app creates gets, unless something more specific overrides it later —
 * `NSFileProtectionCompleteUntilFirstUserAuthentication` (not the stronger `Complete`,
 * which would make the database unreadable exactly while the phone is locked and a
 * night session is running, DESIGN §0.5 S4). Unlike `withInfoPlistLocales` above, this
 * uses a standard Expo config-plugin modifier (`withEntitlementsPlist` merges a plist,
 * no `.pbxproj` surgery), so it is safe to apply for real without a Mac to verify a
 * build against — `expo prebuild -p ios --no-install` (this WO's §0 QC run) confirms
 * the generated `ios/<project>/<project>.entitlements` gets the key.
 *
 * Still leaves the per-file explicit `setProtectionAsync` gap `ExpoSqliteDriver.ts`
 * documents (expo-file-system 57 has no such API yet) — this plugin only makes the
 * *default* class explicit and verifiable, which is what the comment there asked for.
 */
const withDataProtection: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (modConfig) => {
    modConfig.modResults['com.apple.developer.default-data-protection'] =
      'NSFileProtectionCompleteUntilFirstUserAuthentication';
    return modConfig;
  });

/**
 * Expo config for Dreaming (iOS first, Android-ready — APP-RUN §0.2 rule 8).
 *
 * All permission copy below is the English base Expo puts in `Info.plist` directly.
 * The real, localised prompt text (what iOS actually shows the user, TH+EN — APP-RUN
 * §0.5 S10) lives in `locales/{en,th}/InfoPlist.strings` and is copied into the
 * generated project by `withInfoPlistLocales` below (WO L1.3).
 */

const IOS_BUNDLE_ID = 'app.dreaming.ios'; // placeholder until the new Apple account exists (APP-RUN §0.3)
const ANDROID_PACKAGE = 'app.dreaming.android'; // Phase 2 — no Android build in Phase 1

/**
 * What Apple calls "required reason APIs" and "collected data types" (S10).
 *
 * Kept deliberately short and defensible — an over-declared manifest is a claim about the app
 * that is not true, and the whole point of the file is that Apple (and the owner) can trust it:
 *
 * - **UserDefaults · CA92.1** — the watch app and the complication share the streak through the
 *   App Group's `UserDefaults` (`targets/watch/StreakStore.swift`). CA92.1 is exactly "access to
 *   an app group container shared with other apps/extensions from the same developer"; the
 *   plain-container reason 1C8F.1 would be the wrong one.
 * - **File timestamps · C617.1** — `src/audio/anchor.ts` asks `File.exists` before re-rendering a
 *   cached anchor WAV, and `src/data/*` opens the SQLite files. All inside the app's own
 *   container, which is what C617.1 covers.
 *
 * Deliberately **not** declared as collected data, and why (APP-RUN §0.5 S4):
 * - *health* — heart rate and sleep stages never leave the device; "collected" in Apple's
 *   definition means transmitted off device, and declaring it would say we send health data to a
 *   server, which would be false;
 * - *audio* — the morning recording is transcribed on device and deleted; nothing is uploaded
 *   ("ไม่ส่งเสียงขึ้นเซิร์ฟเวอร์เลย").
 * What *is* transmitted, and is therefore declared: the dream text the user chooses to send to
 * `/ai/*` (only with `consentAi`), and the device token that identifies the install.
 * This differs from the work order, which asked for "data types: health, audio" — see
 * `ledger/wo-notes/L2.2n.md` §disagreements.
 */
const PRIVACY_MANIFEST = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
    },
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
      NSPrivacyAccessedAPITypeReasons: ['C617.1'],
    },
  ],
  NSPrivacyCollectedDataTypes: [
    {
      // The dream text sent to the advisor, only when the user turned that on.
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
    {
      // The random 256-bit device token every request carries (APP-RUN §0.5 S2).
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
  ],
};

const MICROPHONE_PERMISSION =
  'Dreaming records your dream in the morning so it can be written down. The recording stays on this iPhone.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Dreaming',
  slug: 'dreaming',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'dreaming',
  userInterfaceStyle: 'automatic',
  // `newArchEnabled` หายไปจากสคีมาของ SDK 57 — New Architecture เป็นทางเดียวแล้ว ไม่มีสวิตช์
  // พื้นแอปไล่สีอ่อนมาก (DESIGN §2.8) — ค่าตรงกับ `appBackground.linearFrom` ใน
  // `src/ui/tokens.ts` (L1.2) นี่คือค่าที่เห็นแวบเดียวตอนโหลด ก่อน `AppBackground` ขึ้นทับ
  backgroundColor: '#f6f5fb',

  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    buildNumber: '1',
    supportsTablet: false,
    // ไม่ล็อก deployment target ไว้ที่ iOS 26 โดยเจตนา (มติ Fable 24 ก.ย.):
    // Liquid Glass ตรวจตอนรันด้วย `isLiquidGlassAvailable()` และ iOS 18 ถอยเป็น blur
    // ได้เอง (DESIGN §2.8) — ใช้ค่าต่ำสุดตามค่าเริ่มต้นของ Expo ก็พอ
    // ⛔ อย่าเพิ่ม `deploymentTarget` ที่นี่ (มันไม่ใช่ฟิลด์ของ ExpoConfig ด้วย)
    // เติมตอนมีบัญชี Apple Developer ใหม่ (APP-RUN §0.3 ข้อ 2) — apple-targets ต้องใช้
    appleTeamId: process.env.EXPO_APPLE_TEAM_ID ?? undefined,
    infoPlist: {
      // เสียงพื้น (bed) ต้องเล่นต่อเนื่องทั้งคืนแม้จอดับ (DESIGN §8.2 · APP-RUN §0.5 S7)
      // double quotes on purpose: the L1.1 oracle (S4.1) greps for the literal "audio"
      //
      // `bluetooth-central` (WO L2.3) keeps the heart-rate strap's notifications coming while
      // the phone is locked all night — without it CoreBluetooth stops delivering the moment the
      // app is suspended, and the night would run blind from lights-out. Listed here *and* added
      // by the `react-native-ble-plx` config plugin below (`modes: ['central']`); the plugin
      // de-duplicates, and having it visible in this file is what makes the entitlement
      // reviewable without reading a plugin's source.
      UIBackgroundModes: ["audio", "bluetooth-central"],
      NSHealthShareUsageDescription:
        'Dreaming reads your sleep and heart rate from Health so it can tell when you are dreaming and only whisper then.',
      NSHealthUpdateUsageDescription:
        'Dreaming saves the mindfulness session your Apple Watch runs while you sleep.',
      NSMicrophoneUsageDescription: MICROPHONE_PERMISSION,
      NSSpeechRecognitionUsageDescription:
        'Dreaming turns your morning recording into text on this iPhone, so you do not have to type your dream.',
      NSBluetoothAlwaysUsageDescription:
        'Dreaming connects to your heart rate strap or armband, and to your headphones, while you sleep.',
      NSUserNotificationsUsageDescription:
        'Dreaming sends a short reality check during the day and a reminder in the evening.',
      // การนอนมาก่อน (DESIGN §2.1): แอปไม่มี UI กลางคืน จอดับได้
      UIRequiresFullScreen: false,
      ITSAppUsesNonExemptEncryption: false,
      // S10 (APP-RUN §0.5): the app supports Thai + English (DESIGN §2.7 "สองภาษาเท่ากัน")
      // — the actual translated permission strings live in `locales/{en,th}/InfoPlist.strings`
      // and are copied into the generated project by `withInfoPlistLocales` below.
      CFBundleLocalizations: ['en', 'th'],
      // ActivityKit refuses `Activity.request` without this (WO L2.2n · DESIGN §4-05 จอ ข).
      // The widget that draws the card is `targets/live-activity`; this key belongs to the
      // **app**, which is the side that starts the activity.
      NSSupportsLiveActivities: true,
    },
    entitlements: {
      'com.apple.developer.healthkit': true,
      'com.apple.developer.healthkit.access': [],
      /**
       * One App Group for the whole family (WO L2.2n). Two separate jobs, same name:
       *  - on the **phone**, `@bacons/apple-targets` copies this list into the Live Activity
       *    widget's entitlements automatically (`appGroupsByDefault` is true for `type: 'widget'`),
       *    which is what a later push-token flow will need;
       *  - on the **watch**, `targets/watch` and `targets/watch-complication` declare it
       *    themselves, and it is the only way the complication can read the streak the watch app
       *    stores (`targets/watch/StreakStore.swift`).
       * ⚠️ The phone's container and the watch's container are different places — App Groups do
       * not sync across devices. Nothing is shared *between* iPhone and Watch by this key.
       * ⚠️ The group must also exist on the Apple Developer portal before the first real build,
       * or signing fails (reference_watch_target_entitlements).
       */
      'com.apple.security.application-groups': ['group.app.dreaming'],
      /*
       * Deliberately NOT here: `com.apple.developer.focus-status`.
       * `modules/lucid-focus` can read Focus state, but the entitlement needs a capability enabled
       * on the App ID (which does not exist yet — APP-RUN §0.3 item 2) and shipping an entitlement
       * the provisioning profile lacks fails the build, sometimes silently. Without it the module
       * reports `known: false` and `src/platform/dnd.ts` answers "audio is allowed", which is the
       * documented fallback. See `ledger/wo-notes/L2.2n.md`.
       */
    },
    /**
     * Privacy manifest (APP-RUN §0.5 S10 — the L1.3 note's debt D-5). Expo turns this into
     * `ios/<project>/PrivacyInfo.xcprivacy` and adds it to the app target
     * (`@expo/config-plugins`' `IOSConfig.PrivacyInfo.withPrivacyInfo`, applied by
     * prebuild-config's default plugin list), merging with anything already there. Every pod
     * ships its own manifest and Apple merges them all, so this file only has to cover **our**
     * code: the app, the four local modules, the watch app and the two widgets.
     *
     * A checked-in copy of the generated file lives at `apps/mobile/PrivacyInfo.xcprivacy` for
     * review; this object is the source of truth (see that file's own header).
     */
    privacyManifests: PRIVACY_MANIFEST,
  },

  android: {
    // เฟส 2 เท่านั้น — ไม่มี Android build ใน Phase 1
    // (`edgeToEdgeEnabled` หายไปจากสคีมาของ SDK 57 แล้ว เพราะ edge-to-edge เปิดตายตัว)
    package: ANDROID_PACKAGE,
  },

  web: {
    bundler: 'metro',
    // SPA เดียว → `expo export --platform web` ได้ dist/index.html ที่ QC ใช้ถ่ายภาพ (APP-RUN §0.2 rule 2)
    output: 'single',
  },

  plugins: [
    'expo-router',
    // ขอสิทธิ์ไมค์ผ่าน config plugin ของ expo-audio (ข้อความจริงอยู่ใน infoPlist ด้านบน)
    ['expo-audio', { microphonePermission: MICROPHONE_PERMISSION }],
    /**
     * BLE heart-rate strap / armband (WO L2.3 · DESIGN §8.1).
     *
     * `isBackgroundEnabled` + `modes: ['central']` is what makes an all-night connection legal:
     * the first adds Android's background-scan manifest bits (Phase 2, harmless now), the second
     * adds `bluetooth-central` to `UIBackgroundModes` — the same key spelled out above.
     * `bluetoothAlwaysPermission` is deliberately **not** passed: the plugin keeps whatever
     * `NSBluetoothAlwaysUsageDescription` is already in `infoPlist` (checked in the plugin's own
     * `withBluetoothPermissions.js`), and ours is the localised, reviewed one.
     */
    ['react-native-ble-plx', { isBackgroundEnabled: true, modes: ['central'] }],
    // ฝัง watchOS target จาก `targets/watch` ที่ราก repo (นอกโฟลเดอร์แอป) → ต้องบอก root
    [
      '@bacons/apple-targets',
      {
        root: '../../targets',
        appleTeamId: process.env.EXPO_APPLE_TEAM_ID,
      },
    ],
    // S10 permission-string localisation (WO L1.3) — see `withInfoPlistLocales` above.
    // `@expo/config-types`'s `ExpoConfig['plugins']` type only lists `string | [string,
    // any]` entries, even though `expo/config`'s actual plugin resolver accepts a bare
    // `ConfigPlugin` function at runtime (confirmed by the prebuild run in
    // `ledger/wo-notes/L1.3.md` — the file really does land). Cast to bridge that
    // type-vs-runtime gap rather than widen the whole `plugins` array's type.
    withInfoPlistLocales as unknown as string,
    // Data Protection entitlement (WO L1.7ui) — see `withDataProtection` above.
    withDataProtection as unknown as string,
  ],

  extra: {
    /**
     * Base URL of `apps/api` (`POST /device`, `POST /ai/plan` — WO L1.7ui wiring the
     * real dream advisor). `EXPO_PUBLIC_API_BASE_URL` overrides it per environment
     * (staging/prod, once those exist); the default matches `apps/api/src/main.ts`'s
     * own default (`PORT` env, defaults to 8787) for local dev against
     * `node --import tsx src/main.ts`.
     */
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8787',
    /**
     * โมดูลที่ใช้ได้เฉพาะ iOS — ห้าม import นอก `src/platform/ios/`
     * (APP-RUN §0.2 rule 8 · ตรวจโดย scripts/fitness.mts และ oracle S3.7)
     *
     * `expo-glass-effect` เป็น **expo module ที่ autolink เอง ไม่ใช่ config plugin**
     * (แพ็กเกจไม่มี app.plugin.js) → ใส่ใน `plugins` ไม่ได้ จะทำให้ prebuild ล้ม
     * จึงประกาศไว้ที่นี่เพื่อให้เห็นชัดว่าโปรเจกต์ใช้ของนี้
     */
    iosOnlyModules: ['expo-glass-effect', 'react-native-ble-plx'],
    router: {},
  },
});

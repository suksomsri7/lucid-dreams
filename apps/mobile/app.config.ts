/// <reference types="node" />
// This file runs under plain Node at `expo prebuild`/config-eval time (never bundled
// into the app), so it needs `@types/node` — the rest of `apps/mobile` deliberately does
// not pull it in globally (`expo/types`, referenced via `expo-env.d.ts`, covers the
// handful of Node-ish ambients the RN code itself needs, like `process.env`). Confirmed
// this one-file reference does not change `pnpm typecheck`'s result for any other file.
import fs from 'node:fs';
import path from 'node:path';

import { withDangerousMod, withEntitlementsPlist, type ConfigPlugin } from '@expo/config-plugins';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const INFO_PLIST_LOCALES = ['en', 'th'] as const;

/**
 * Copies `locales/<lang>/InfoPlist.strings` into the generated Xcode project's
 * `<lang>.lproj/InfoPlist.strings` (APP-RUN §0.5 S10 · WO L1.3) so the system
 * permission prompts iOS shows are actually localised, not just the base
 * `ios.infoPlist` English text below.
 *
 * Deliberately scoped to *file placement* only — it does not register the files as a
 * `PBXVariantGroup` in the generated `.pbxproj` (the step that makes a real Xcode build
 * embed and use them). There is no Mac/Xcode on this VPS to test that against, and
 * getting pbxproj surgery wrong risks a broken project file that only surfaces the next
 * time someone attempts a real iOS build — worse than the current, honestly documented
 * gap. Verified instead by running `expo prebuild -p ios --no-install` and confirming
 * both `.strings` files land on disk (`ledger/wo-notes/L1.3.md` §"S10"); full Xcode
 * target wiring is left as a debt for whoever does the first real device build (R1) or
 * L3.6 (which already owns the rest of Store compliance, e.g. `PrivacyInfo.xcprivacy`).
 *
 * Defined inline here rather than in its own `plugins/*.ts` file: `expo/config`'s loader
 * transpiles this single file on the fly but does not run a second require through the
 * same TS-aware loader for a sibling relative import, so `require('./plugins/...')`
 * failed at prebuild with `Cannot find module` (confirmed by running the prebuild below
 * before moving the code here).
 */
const withInfoPlistLocales: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const { platformProjectRoot, projectName, projectRoot } = modConfig.modRequest;
      if (!projectName) return modConfig;

      for (const locale of INFO_PLIST_LOCALES) {
        const source = path.join(projectRoot, 'locales', locale, 'InfoPlist.strings');
        if (!fs.existsSync(source)) continue;

        const targetDir = path.join(platformProjectRoot, projectName, `${locale}.lproj`);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(source, path.join(targetDir, 'InfoPlist.strings'));
      }

      return modConfig;
    },
  ]);

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
 * Expo config for Lucid Dream (iOS first, Android-ready — APP-RUN §0.2 rule 8).
 *
 * All permission copy below is the English base Expo puts in `Info.plist` directly.
 * The real, localised prompt text (what iOS actually shows the user, TH+EN — APP-RUN
 * §0.5 S10) lives in `locales/{en,th}/InfoPlist.strings` and is copied into the
 * generated project by `withInfoPlistLocales` below (WO L1.3).
 */

const IOS_BUNDLE_ID = 'app.luciddream.ios'; // placeholder until the new Apple account exists (APP-RUN §0.3)
const ANDROID_PACKAGE = 'app.luciddream.android'; // Phase 2 — no Android build in Phase 1

const MICROPHONE_PERMISSION =
  'Lucid Dream records your dream in the morning so it can be written down. The recording stays on this iPhone.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Lucid Dream',
  slug: 'lucid-dream',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'luciddream',
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
      UIBackgroundModes: ["audio"],
      NSHealthShareUsageDescription:
        'Lucid Dream reads your sleep and heart rate from Health so it can tell when you are dreaming and only whisper then.',
      NSHealthUpdateUsageDescription:
        'Lucid Dream saves the mindfulness session your Apple Watch runs while you sleep.',
      NSMicrophoneUsageDescription: MICROPHONE_PERMISSION,
      NSSpeechRecognitionUsageDescription:
        'Lucid Dream turns your morning recording into text on this iPhone, so you do not have to type your dream.',
      NSBluetoothAlwaysUsageDescription:
        'Lucid Dream connects to your heart rate strap or armband, and to your headphones, while you sleep.',
      NSUserNotificationsUsageDescription:
        'Lucid Dream sends a short reality check during the day and a reminder in the evening.',
      // การนอนมาก่อน (DESIGN §2.1): แอปไม่มี UI กลางคืน จอดับได้
      UIRequiresFullScreen: false,
      ITSAppUsesNonExemptEncryption: false,
      // S10 (APP-RUN §0.5): the app supports Thai + English (DESIGN §2.7 "สองภาษาเท่ากัน")
      // — the actual translated permission strings live in `locales/{en,th}/InfoPlist.strings`
      // and are copied into the generated project by `withInfoPlistLocales` below.
      CFBundleLocalizations: ['en', 'th'],
    },
    entitlements: {
      'com.apple.developer.healthkit': true,
      'com.apple.developer.healthkit.access': [],
    },
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
    iosOnlyModules: ['expo-glass-effect'],
    router: {},
  },
});

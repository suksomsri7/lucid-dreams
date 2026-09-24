import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo config for Lucid Dream (iOS first, Android-ready — APP-RUN §0.2 rule 8).
 *
 * All permission copy below is English and plain, because iOS shows these strings
 * verbatim in the system prompt. The Thai versions live in `src/i18n/th.ts` and are
 * shown by our own pre-permission screens (APP-RUN §0.5 S10 wants TH+EN copy).
 * Info.plist itself can be localised later with `InfoPlist.strings` in R1+.
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
  ],

  extra: {
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

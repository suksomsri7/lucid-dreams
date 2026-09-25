#!/bin/bash
# ข้อสอบ L3.13 — R1 hotfix #4: พูดแทนพิมพ์ (Speech-to-Text บน iOS) — IosSpeechToText เดิมเป็น stub คืน false ("This device cannot do that yet")
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
m=apps/mobile; src=$m/src; f=$src/platform/ios/IosSpeechToText.ts
echo "L3.13 oracle @ $root"
chk T1.1 "$(grep -qsE '"expo-speech-recognition"' $m/package.json && echo 1 || echo 0)" "dep expo-speech-recognition (SDK 57 → 57.x)"
chk T1.2 "$(grep -qsE "'expo-speech-recognition'" $m/app.config.ts && echo 1 || echo 0)" "plugin ใน app.config (microphonePermission/speechRecognitionPermission = ข้อความเดิม)"
chk T1.3 "$([ -f $f ] && grep -qsE "export class IosSpeechToText" $f && echo 1 || echo 0)" "src/platform/ios/IosSpeechToText.ts แยกไฟล์"
chk T1.4 "$(grep -qsE "IosSpeechToText" $src/platform/ios/IosPeripherals.ts $src/platform/native.ios.ts 2>/dev/null && ! grep -qsE "expo-speech-recognition is added in L1.6" $src/platform/ios/IosPeripherals.ts && echo 1 || echo 0)" "stub เดิมถูกแทน (ไม่มีข้อความ 'added in L1.6')"
chk T1.5 "$(grep -qsE "ExpoSpeechRecognitionModule|expo-speech-recognition" $f && echo 1 || echo 0)" "ใช้ expo-speech-recognition"
chk T1.6 "$(grep -qsE "isRecognitionAvailable|getStateAsync|supportsOnDeviceRecognition" $f && echo 1 || echo 0)" "isAvailable ถามความสามารถจริง"
chk T1.7 "$(grep -qsE "requestPermissionsAsync" $f && echo 1 || echo 0)" "requestPermissions ขอ ไมค์+Speech จริง"
chk T1.8 "$(grep -qsE "requiresOnDeviceRecognition" $f && echo 1 || echo 0)" "ตั้ง requiresOnDeviceRecognition เมื่อรองรับ (DESIGN §0.5 S4: เสียงไม่ออกเครื่อง) + ถอยเป็น server เมื่อภาษาไม่รองรับ on-device"
chk T1.9 "$(grep -qsE "interimResults" $f && grep -qsE "isFinal|partial" $f && echo 1 || echo 0)" "ส่ง partial + final ผ่าน onResult (SpeechResult)"
chk T1.10 "$(grep -qsE "addListener\('(result|error|end)'|addSpeechRecognitionListener" $f && echo 1 || echo 0)" "ฟัง event result/error/end"
chk T1.11 "$(grep -qsE "lang: *options\.locale|lang: locale" $f && echo 1 || echo 0)" "ภาษาตาม options.locale (th-TH/en-US)"
chk T1.12 "$(grep -qsE "'advisor\.mic\.(denied|listening|unavailable)'" $src/i18n/th.ts && grep -qsE "'advisor\.mic\.(denied|listening|unavailable)'" $src/i18n/en.ts && echo 1 || echo 0)" "i18n สถานะไมค์: ถูกปฏิเสธ (เปิด Settings) · กำลังฟัง · ไม่รองรับ"
chk T1.13 "$(grep -qsE "openSettings" $src/advisor/AdvisorRoom.tsx && echo 1 || echo 0)" "ถูกปฏิเสธ → ปุ่มเปิด Settings"
chk T1.14 "$(grep -qsE "listening|micActive" $src/advisor/AdvisorRoom.tsx && grep -qsE "Animated|pulse" $src/advisor/AdvisorRoom.tsx $src/ui/Composer.tsx && echo 1 || echo 0)" "ไมค์มีสถานะกำลังฟัง (ปุ่มเต้น/เปลี่ยนสี) + แตะอีกครั้งหยุด"
chk T1.15 "$(grep -qsE "speechToText" $src/morning/useMorning.ts && echo 1 || echo 0)" "หน้าเช้าใช้ตัวเดียวกัน (ไม่แตะ logic เพิ่ม)"
chk T2.1 "$(cd $m && pnpm -s typecheck >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm typecheck"
chk T2.2 "$(pnpm -s fitness >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm fitness"
chk T2.3 "$(grep -rqsE "[ก-๙]" $f && echo 0 || echo 1)" "ไม่มีไทยนอก i18n"
chk T2.4 "$(cd $m && rm -rf ios && timeout 300 npx expo prebuild -p ios --no-install >/dev/null 2>&1; r=$?; git -C "$root" checkout -- targets/watch/Assets.xcassets/AppIcon.appiconset/Contents.json 2>/dev/null; rm -f "$root"/targets/watch/Assets.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png; [ $r -eq 0 ] && echo 1 || echo 0)" "prebuild ios ผ่าน"
chk T2.5 "$(cd $m && NODE_OPTIONS=--max-old-space-size=3584 timeout 500 npx expo export --platform ios --output-dir /tmp/claude-0/l313-ios >/dev/null 2>&1 && echo 1 || echo 0)" "expo export ios ผ่าน"
echo "L3.13 $pass / $((pass+fail))"; [ $fail -eq 0 ] && st=PASS || st=FAIL
echo "JSON_SUMMARY {\"wo\":\"L3.13\",\"pass\":$pass,\"fail\":$fail,\"status\":\"$st\",\"failed\":\"${notes[*]}\"}"
[ $fail -eq 0 ]

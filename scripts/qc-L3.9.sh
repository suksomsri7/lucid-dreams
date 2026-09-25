#!/bin/bash
# ข้อสอบ L3.9 — R1 hotfix #1 (จอ Devices ตอน onboarding): ปุ่มค้นหาชีพจรเด้งกลับ · ไม่เห็นหูฟัง (ไม่มีตัวอ่าน audio route) · ชีต Sound ทำอะไรไม่ได้ · นาฬิกาไม่มีคำแนะนำติดตั้ง
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
m=apps/mobile; app=$m/app; src=$m/src; mod=$m/modules/lucid-audio-route
echo "L3.9 oracle @ $root"
# 1 ค้นหาอุปกรณ์ชีพจรจาก onboarding ต้องไม่ถูก redirect
chk H1.1 "$([ -f $app/onboarding/find-devices.tsx ] && echo 1 || echo 0)" "app/onboarding/find-devices.tsx (route ใต้ onboarding ไม่โดนด่าน hasOnboarded)"
chk H1.2 "$(grep -qsE "router\.push\('/onboarding/find-devices'\)" $app/onboarding/devices.tsx && echo 1 || echo 0)" "onboarding/devices.tsx push /onboarding/find-devices"
chk H1.3 "$(grep -qsE "FindDevicesScreen|from '\.\./\.\./src/devices/FindDevices" $app/onboarding/find-devices.tsx $app/plan/find-devices.tsx && echo 1 || echo 0)" "จอสแกน BLE แชร์คอมโพเนนต์เดียว (ไม่ก๊อปโค้ด)"
# 2 audio route จริงจาก AVAudioSession
chk H2.1 "$([ -f $mod/ios/LucidAudioRouteModule.swift ] && [ -f $mod/expo-module.config.json ] && [ -f $mod/index.ts ] && echo 1 || echo 0)" "local module lucid-audio-route (swift + config + index.ts)"
chk H2.2 "$(grep -qsE "AVAudioSession.*currentRoute|currentRoute\.outputs" $mod/ios/LucidAudioRouteModule.swift && echo 1 || echo 0)" "อ่าน AVAudioSession.currentRoute.outputs"
chk H2.3 "$(grep -qsE "routeChangeNotification" $mod/ios/LucidAudioRouteModule.swift && grep -qsE "sendEvent|Events\(" $mod/ios/LucidAudioRouteModule.swift && echo 1 || echo 0)" "ส่ง event เมื่อ route เปลี่ยน (เสียบ/ถอดหูฟัง)"
chk H2.4 "$(grep -qsE "portType|portName" $mod/ios/LucidAudioRouteModule.swift && echo 1 || echo 0)" "คืน portType + portName"
chk H2.5 "$(grep -qsE "lucid-audio-route|LucidAudioRoute|audioRoute" $src/platform/ios/IosAudioPlayer.ts && echo 1 || echo 0)" "IosAudioPlayer.getStatus().route มาจากโมดูลจริง"
chk H2.6 "$(grep -qsE "bluetoothA2DP|BluetoothA2DP" $src/platform/ios/IosAudioPlayer.ts $src/devices/registry.ts $src/platform/ios/audioRoute.ts 2>/dev/null && echo 1 || echo 0)" "จำแนกหูฟัง (BT A2DP/HFP · headphones · usb · airplay)"
chk H2.7 "$(grep -qsE "builtInSpeaker|BuiltInSpeaker" $src/platform/ios/IosAudioPlayer.ts $src/devices/registry.ts $src/platform/ios/audioRoute.ts 2>/dev/null && echo 1 || echo 0)" "จำแนกลำโพงในเครื่อง"
chk H2.8 "$(grep -qsE "audioSpeaker|useSpeaker|speakerAllowed" $src/devices/prefs.ts && grep -qsE "audioSpeaker|useSpeaker|speakerAllowed" $src/devices/registry.ts && echo 1 || echo 0)" "ลำโพงนับเป็นอุปกรณ์ AUDIO เฉพาะเมื่อผู้ใช้เลือก (prefs)"
chk H2.9 "$(grep -qsE "'devices\.speaker\.name'" $src/i18n/th.ts && grep -qsE "'devices\.speaker\.name'" $src/i18n/en.ts && echo 1 || echo 0)" "ชื่อ 'ลำโพง iPhone' ผ่าน i18n"
chk H2.10 "$(grep -qsE "AppState" $app/onboarding/devices.tsx $app/plan/devices.tsx $src/devices/registry.ts && echo 1 || echo 0)" "กลับจาก Settings แล้วรีเฟรชเอง (AppState active)"
chk H2.11 "$(grep -rqsE "App-Prefs" $src $app && echo 0 || echo 1)" "ไม่ใช้ URL scheme ส่วนตัว App-Prefs (App Store ปฏิเสธ)"
# 3 ชีต Sound ทำงานได้
chk H3.1 "$(grep -qsE "onPress" $app/onboarding/devices.tsx && grep -qsE "setAudioSpeaker|audioSpeaker|useSpeaker" $app/onboarding/devices.tsx && echo 1 || echo 0)" "แถว 'ลำโพง' กดแล้วเลือกใช้ลำโพงได้"
chk H3.2 "$(grep -qsE "openSettings" $app/onboarding/devices.tsx && echo 1 || echo 0)" "แถว 'หูฟัง Bluetooth' เปิด Settings ให้จับคู่"
chk H3.3 "$(grep -qsE "'onboarding\.devices\.search\.audio\.(speakerOn|speakerHint|openSettings)'" $src/i18n/th.ts && echo 1 || echo 0)" "i18n ใหม่ของชีต (th)"
chk H3.4 "$(grep -qsE "'onboarding\.devices\.search\.audio\.(speakerOn|speakerHint|openSettings)'" $src/i18n/en.ts && echo 1 || echo 0)" "i18n ใหม่ของชีต (en)"
# 4 นาฬิกา: paired แต่ยังไม่ติดตั้งแอป → บอกวิธี
chk H4.1 "$(grep -qsE "appInstalled" $app/onboarding/devices.tsx $src/devices/registry.ts $app/plan/devices.tsx && echo 1 || echo 0)" "แยกกรณี paired แต่ appInstalled=false"
chk H4.2 "$(grep -qsE "'devices\.watch\.installHint'" $src/i18n/th.ts && grep -qsE "'devices\.watch\.installHint'" $src/i18n/en.ts && echo 1 || echo 0)" "ข้อความ 'ติดตั้ง Dreaming บนนาฬิกาผ่านแอป Watch' th/en"
# 6 Settings → Find a device (เจ้าของเจอ "Coming soon" ทั้ง 5 แถว 25 ก.ย. 15:20)
chk H6.1 "$(grep -qsE "onboarding\.devices\.search\.comingSoon|comingSoon" $app/\(tabs\)/settings.tsx && echo 0 || echo 1)" "settings.tsx ไม่มี Coming soon แล้ว"
chk H6.2 "$([ -f $src/devices/DeviceSearchSheet.tsx ] && grep -qsE "DeviceSearchSheet" $app/\(tabs\)/settings.tsx && grep -qsE "DeviceSearchSheet" $app/onboarding/devices.tsx && echo 1 || echo 0)" "ชีตค้นหาอุปกรณ์ตัวเดียว ใช้ทั้ง Settings และ onboarding"
chk H6.3 "$(grep -qsE "find-devices" $src/devices/DeviceSearchSheet.tsx && echo 1 || echo 0)" "สายคาดอก/ปลอกแขน → จอสแกน BLE"
chk H6.4 "$(grep -qsE "setPhoneOnMattress|phoneOnMattress" $src/devices/DeviceSearchSheet.tsx && echo 1 || echo 0)" "มือถือบนที่นอน = สวิตช์เปิด/ปิดจริง"
chk H6.5 "$(grep -qsE "'devices\.search\.(strap|armband|mattress|bluetooth|speaker)'" $src/i18n/th.ts && grep -qsE "'devices\.search\.(strap|armband|mattress|bluetooth|speaker)'" $src/i18n/en.ts && echo 1 || echo 0)" "i18n ชีตกลาง devices.search.* th/en"
chk H6.6 "$(grep -rqsE "comingSoon" $src/devices/DeviceSearchSheet.tsx && echo 0 || echo 1)" "ไม่มี Coming soon ในชีตกลาง"
# 7 เสียงเปิดแอปเงียบ (เจ้าของ 25 ก.ย. 16:50): playOneShot ไม่เคยตั้ง audio mode/activate session · ตัดหาง 8 s
chk H7.1 "$(python3 - <<'PY'
import re
s=open('apps/mobile/src/platform/ios/IosAudioPlayer.ts').read()
i=s.find('async playOneShot('); body=s[i:i+2500]
print(1 if ('configureSession()' in body and 'setIsAudioActiveAsync(true)' in body) else 0)
PY
)" "playOneShot ตั้ง audio mode (playsInSilentMode) + activate session ก่อนเล่น"
chk H7.2 "$(grep -qsE "duration" $src/platform/ios/IosAudioPlayer.ts && grep -qsE "ONE_SHOT_MAX_MS|oneShotTimeout" $src/platform/ios/IosAudioPlayer.ts && echo 1 || echo 0)" "timeout ของ one-shot มาจากความยาวไฟล์ (ไม่ตัดระฆัง 9.8 s ที่ 8 s)"
chk H7.3 "$(grep -qsE "BRAND_MIN_VOLUME" $src/audio/brand.ts && echo 1 || echo 0)" "เสียงเปิดแอปมีพื้นระดับเสียง 0.5 (ลำโพงกลางวัน)"
chk H7.4 "$(grep -qsE "lastError|audioError|status\.error" $m/app/diagnostics.tsx $src/diagnostics/*.ts* 2>/dev/null && echo 1 || echo 0)" "หน้า Diagnostics แสดง error ล่าสุดของตัวเล่นเสียง + ปุ่มทดสอบเสียง"
chk H7.5 "$(grep -qsE "'diagnostics\.audio\.(test|lastError|none)'" $src/i18n/th.ts && grep -qsE "'diagnostics\.audio\.(test|lastError|none)'" $src/i18n/en.ts && echo 1 || echo 0)" "i18n diagnostics.audio.* th/en"
# 5 สุขภาพ
chk H5.1 "$(cd $m && pnpm -s typecheck >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm typecheck"
chk H5.2 "$(pnpm -s fitness >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm fitness"
chk H5.3 "$(grep -rqsE "[ก-๙]" $mod $src/platform/ios/IosAudioPlayer.ts 2>/dev/null && echo 0 || echo 1)" "ไม่มีไทยนอก i18n"
chk H5.4 "$(cd $m && rm -rf ios && timeout 300 npx expo prebuild -p ios --no-install >/dev/null 2>&1 && grep -q "LucidAudioRoute" ios/Podfile* ios/*.xcodeproj/project.pbxproj 2>/dev/null; r=$?; git -C "$root" checkout -- targets/watch/Assets.xcassets/AppIcon.appiconset/Contents.json 2>/dev/null; rm -f "$root"/targets/watch/Assets.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png; [ $r -eq 0 ] && echo 1 || echo 0)" "prebuild ios ผ่าน + โมดูล autolink"
chk H5.5 "$(cd $m && NODE_OPTIONS=--max-old-space-size=3584 timeout 500 npx expo export --platform ios --output-dir /tmp/claude-0/l39-ios >/dev/null 2>&1 && echo 1 || echo 0)" "expo export ios ผ่าน"
echo "L3.9 $pass / $((pass+fail))"; [ $fail -eq 0 ] && st=PASS || st=FAIL
echo "JSON_SUMMARY {\"wo\":\"L3.9\",\"pass\":$pass,\"fail\":$fail,\"status\":\"$st\",\"failed\":\"${notes[*]}\"}"
[ $fail -eq 0 ]

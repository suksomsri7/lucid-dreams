#!/bin/bash
# ข้อสอบ L1.3 — onboarding + ยินยอม + อุปกรณ์ 3 หมวด (Fable เขียนก่อน · builder ห้ามแก้)
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
ob=apps/mobile/app/onboarding
[ -d "$ob" ] || { echo "SKIPPED: ยังไม่มี $ob"; echo 'JSON_SUMMARY {"wo":"L1.3","status":"SKIPPED"}'; exit 0; }
echo "L1.3 oracle @ $root"
chk O1.1 "$(ls $ob/index.tsx $ob/welcome.tsx 2>/dev/null | wc -l | awk '{print ($1>0)}')" "จอต้อนรับ"
chk O1.2 "$(ls $ob/devices.tsx 2>/dev/null | wc -l)" "จอ อุปกรณ์"
src=apps/mobile/src
chk O2.1 "$(grep -rqsE "consentSafety|acceptSafety" $src apps/mobile/app && echo 1 || echo 0)" "ติ๊กรับทราบถูกบันทึก (consentSafety)"
chk O2.2 "$(grep -rqsE "policyVersion|POLICY_VERSION" $src apps/mobile/app && echo 1 || echo 0)" "เวอร์ชันนโยบาย + เวลา"
chk O2.3 "$(grep -rqsE "consentAi" $src apps/mobile/app && echo 1 || echo 0)" "สวิตช์ AI (ค่าเริ่มต้นปิด)"
chk O2.4 "$(grep -rqsE "consentAi[^\n]*false|false[^\n]*consentAi" $src/onboarding* $src/store* $src/state* apps/mobile/app/onboarding 2>/dev/null && echo 1 || echo 0)" "consentAi default false"
# 3 หมวดอุปกรณ์
chk O3.1 "$(grep -rqsE "'HEART'|\"HEART\"" $src packages/engine/src 2>/dev/null && echo 1 || echo 0)" "หมวด HEART"
chk O3.2 "$(grep -rqsE "'AUDIO'|\"AUDIO\"" $src packages/engine/src 2>/dev/null && echo 1 || echo 0)" "หมวด AUDIO"
chk O3.3 "$(grep -rqsE "'EYE'|\"EYE\"" $src packages/engine/src 2>/dev/null && echo 1 || echo 0)" "หมวด EYE (ไม่บังคับ)"
chk O3.4 "$(grep -rqsE "DeviceRegistry|deviceRegistry" $src packages/engine/src 2>/dev/null && echo 1 || echo 0)" "DeviceRegistry"
chk O3.5 "$(grep -rqsE "requestAuthorization|HealthKit|healthkit" $src/platform/ios 2>/dev/null && echo 1 || echo 0)" "ขอสิทธิ์ HealthKit ในชั้น platform/ios"
# S6/S10 คำห้าม
bad=$(grep -rhoiE "cure|treat(ment)?|diagnos|รักษา|วินิจฉัย|บำบัด" $src/i18n/th.ts $src/i18n/en.ts 2>/dev/null | grep -viE "ไม่ใช่|not a|no medical|ไม่วินิจฉัย|ไม่รักษา|ไม่ใช่การรักษา" | wc -l)
chk O4.1 "$([ "$bad" = 0 ] && echo 1 || echo 0)" "ไม่มีคำอ้างทางการแพทย์ใน i18n ($bad)"
for k in NSHealthShareUsageDescription NSMicrophoneUsageDescription NSBluetoothAlwaysUsageDescription NSUserNotificationsUsageDescription; do
  chk "O4.$k" "$(grep -qs "$k" apps/mobile/app.config.ts && echo 1 || echo 0)" "$k"; done
chk O4.5 "$(ls apps/mobile/ios-locales/th.lproj/InfoPlist.strings apps/mobile/locales/th/InfoPlist.strings 2>/dev/null | wc -l | awk '{print ($1>0)}')" "InfoPlist.strings ไทย (S10)"
thai_leak=$(grep -rlsP "[\x{0E00}-\x{0E7F}]" apps/mobile/app apps/mobile/src 2>/dev/null | grep -v "/i18n/" | wc -l)
chk O5.1 "$([ "$thai_leak" = 0 ] && echo 1 || echo 0)" "ไม่มีสตริงไทยนอก i18n"
chk O5.2 "$(grep -rqsE "onboardingDone|hasOnboarded" $src apps/mobile/app && echo 1 || echo 0)" "จำว่าผ่าน onboarding แล้ว (ไม่ถามซ้ำ)"
if [ -d node_modules ]; then
  (timeout 600 pnpm -s typecheck >/tmp/l13-tsc.log 2>&1); chk O6.1 "$([ $? = 0 ] && echo 1 || echo 0)" "typecheck"
  (timeout 300 npx tsx scripts/fitness.mts >/tmp/l13-fit.log 2>&1); chk O6.2 "$([ $? = 0 ] && echo 1 || echo 0)" "fitness"
  chk O6.3 "$([ -f apps/mobile/dist/index.html ] && echo 1 || echo 0)" "web export"
fi
echo; echo "ผล: ผ่าน $pass / $((pass+fail))"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L1.3\",\"pass\":$pass,\"fail\":$fail,\"failed\":\"${notes[*]}\"}"; [ $fail = 0 ]

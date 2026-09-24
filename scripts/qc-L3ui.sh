#!/bin/bash
# ข้อสอบ L3.1 (เช้าในห้องเดียวกัน) · L3.3 (คืนควบคุม + reality check + เตือน) · L3.5 (บันทึก) · L3.6 (ตั้งค่า + Boost night + compliance) — โครงสร้าง · parity ตรวจแยก
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
app=apps/mobile/app; src=apps/mobile/src
[ -d "$src/morning" ] || [ -f "$app/morning.tsx" ] || { echo "SKIPPED: ยังไม่มี morning"; echo 'JSON_SUMMARY {"wo":"L3ui","status":"SKIPPED"}'; exit 0; }
echo "L3.1/3.3/3.5/3.6 oracle @ $root"
# L3.1 เช้า
chk M1.1 "$(grep -rqsE "MorningFlow|morning" $src/advisor $src/morning 2>/dev/null && echo 1 || echo 0)" "flow เช้าในห้องที่ปรึกษา"
chk M1.2 "$(grep -rqsE "speechToText" $src/morning $src/advisor 2>/dev/null && echo 1 || echo 0)" "เล่าด้วยเสียง (SpeechToText)"
chk M1.3 "$(grep -rqsE "typeInstead|พิมพ์แทน|morning\.type" $src/i18n/th.ts $src/morning 2>/dev/null && echo 1 || echo 0)" "พิมพ์แทนได้"
chk M1.4 "$(grep -rqsE "cantRemember|forgot|จำไม่ได้" $src/i18n/th.ts && echo 1 || echo 0)" "ชิป จำไม่ได้"
chk M1.5 "$(grep -rqsE "reports\.save" $src && echo 1 || echo 0)" "บันทึก MorningReport"
chk M1.6 "$(grep -rqsE "cueWoke" $src/morning 2>/dev/null && echo 1 || echo 0)" "ถาม 'เสียงปลุกไหม' (เฉพาะคืนที่ยิง)"
chk M1.7 "$(grep -rqsE "<Scale" $src/morning 2>/dev/null && echo 1 || echo 0)" "ตอบ 0–10 ด้วย Scale"
chk M1.8 "$(grep -rqsE "morningResultMessage" $src && echo 1 || echo 0)" "ข้อความผลจาก engine"
chk M1.9 "$(grep -rqsE "sanitizeAiScore|/ai/score" $src && echo 1 || echo 0)" "เรียก /ai/score + sanitize"
chk M1.10 "$(grep -rqsE "consentAi" $src/morning $src/api 2>/dev/null && echo 1 || echo 0)" "ไม่ส่ง transcript ถ้า consentAi=false"
# L3.3 คืนควบคุม + แจ้งเตือน
chk M3.1 "$(grep -rqsE "controlNight|isControlNight|CONTROL" $src/night/session.ts 2>/dev/null $src/settings 2>/dev/null && echo 1 || echo 0)" "สุ่มคืนควบคุมตอนเริ่มคืน"
chk M3.2 "$(grep -rqsE "0\.25|controlRatio" $src/night 2>/dev/null $src/settings 2>/dev/null && echo 1 || echo 0)" "สัดส่วน 1 ใน 4"
chk M3.3 "$(grep -rqsE "expo-notifications|scheduleNotificationAsync" $src && echo 1 || echo 0)" "expo-notifications"
chk M3.4 "$(grep -rqsE "realityCheck" $src && echo 1 || echo 0)" "reality check กลางวัน"
chk M3.5 "$(grep -rqsE "09|21|quietHours|window" $src/notifications 2>/dev/null && echo 1 || echo 0)" "ช่วง 09–21 ไม่ชนช่วงนอน"
chk M3.6 "$(grep -rqsE "realityChecks?\.record|RealityCheck" $src && echo 1 || echo 0)" "บันทึก RealityCheck"
# L3.5 บันทึก
chk M5.1 "$(grep -rqsE "stats\(" $app/\(tabs\)/journal.tsx $src/journal 2>/dev/null && echo 1 || echo 0)" "ตัวเลข 3 ตัวจาก repo.stats"
chk M5.2 "$(grep -rqsE "<Hyp" $app/\(tabs\)/journal.tsx $src/journal 2>/dev/null && echo 1 || echo 0)" "กราฟ 30 คืน (Hyp)"
chk M5.3 "$(grep -rqsE "notEnoughControl|ยังเทียบไม่ได้" $src/i18n/th.ts && echo 1 || echo 0)" "< 4 คืนควบคุม = 'ยังเทียบไม่ได้'"
chk M5.4 "$(grep -rqsE "lastNights\(" $src && echo 1 || echo 0)" "รายการคืน → รายงาน"
# L3.6 ตั้งค่า
chk M6.1 "$(grep -rqsE "guardHours" $app/\(tabs\)/settings.tsx $src/settings 2>/dev/null && echo 1 || echo 0)" "Sleep Guard ตั้งได้"
chk M6.2 "$(grep -rqsE "Math\.max\(2|MIN_GUARD|guardHours.*2" $src/settings 2>/dev/null $app/\(tabs\)/settings.tsx && echo 1 || echo 0)" "ต่ำสุด 2 ชม. ใน UI"
chk M6.3 "$(grep -rqsE "boostNight|WBTB" $src && echo 1 || echo 0)" "Boost night (ปิดเริ่มต้น)"
chk M6.4 "$(grep -rqsE "boostNight[^\n]*false|false[^\n]*boostNight" $src/settings 2>/dev/null && echo 1 || echo 0)" "Boost night default false"
chk M6.5 "$(grep -rqsE "deleteAll\(" $src && echo 1 || echo 0)" "ลบทั้งหมด"
chk M6.6 "$(grep -rqsE "typeToConfirm|พิมพ์ .ลบ.|confirmWord" $src/i18n/th.ts $src/settings 2>/dev/null && echo 1 || echo 0)" "ยืนยัน 2 ขั้น (พิมพ์ 'ลบ')"
chk M6.7 "$(grep -rqsE "resetWatermark|resetAnchor" $src && echo 1 || echo 0)" "รีเซ็ตลายน้ำ (เตือนฝึกใหม่)"
chk M6.8 "$(ls apps/mobile/PrivacyInfo.xcprivacy apps/mobile/ios-privacy/PrivacyInfo.xcprivacy 2>/dev/null | wc -l | awk '{print ($1>0)}')" "PrivacyInfo.xcprivacy"
chk M6.9 "$(grep -rqsE "DELETE.*device|deleteDevice|/device" $src/api 2>/dev/null && echo 1 || echo 0)" "ลบทั้งหมด → DELETE /device"
thai_leak=$(grep -rlsP "[\x{0E00}-\x{0E7F}]" $app $src 2>/dev/null | grep -v "/i18n/" | wc -l); chk M7.1 "$([ "$thai_leak" = 0 ] && echo 1 || echo 0)" "ไม่มีสตริงไทยนอก i18n"
if [ -d node_modules ]; then
  (timeout 600 pnpm -s typecheck >/tmp/l3ui-tsc.log 2>&1); chk M8.1 "$([ $? = 0 ] && echo 1 || echo 0)" "typecheck"
  (timeout 300 npx tsx scripts/fitness.mts >/tmp/l3ui-fit.log 2>&1); chk M8.2 "$([ $? = 0 ] && echo 1 || echo 0)" "fitness"
  chk M8.3 "$([ -f apps/mobile/dist/index.html ] && echo 1 || echo 0)" "web export"
fi
echo; echo "ผล: ผ่าน $pass / $((pass+fail))"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L3ui\",\"pass\":$pass,\"fail\":$fail,\"failed\":\"${notes[*]}\"}"; [ $fail = 0 ]

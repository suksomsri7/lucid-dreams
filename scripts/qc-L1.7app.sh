#!/bin/bash
# ข้อสอบ L1.6/L1.7 ส่วนแอป — หน้าแผน → ตรวจอุปกรณ์ → ทดสอบหูซ้าย → หูขวา → เริ่ม · เครื่องเล่นเสียง (bed+cue) · Live Activity · ambience
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
app=apps/mobile/app; src=apps/mobile/src
[ -f "$app/plan.tsx" ] || [ -d "$app/plan" ] || { echo "SKIPPED: ยังไม่มี $app/plan"; echo 'JSON_SUMMARY {"wo":"L1.7app","status":"SKIPPED"}'; exit 0; }
echo "L1.6/1.7 app oracle @ $root"
chk T1.1 "$(ls $app/plan.tsx $app/plan/index.tsx 2>/dev/null | wc -l | awk '{print ($1>0)}')" "หน้าแผนคืนนี้"
chk T1.2 "$(ls $app/ready/devices.tsx $app/plan/devices.tsx 2>/dev/null | wc -l | awk '{print ($1>0)}')" "หน้าตรวจอุปกรณ์ (ขั้น 1/3)"
chk T1.3 "$(ls $app/ready/ear-left.tsx $app/plan/ear-left.tsx 2>/dev/null | wc -l | awk '{print ($1>0)}')" "หน้าทดสอบหูซ้าย (2/3)"
chk T1.4 "$(ls $app/ready/ear-right.tsx $app/plan/ear-right.tsx 2>/dev/null | wc -l | awk '{print ($1>0)}')" "หน้าทดสอบหูขวา (3/3)"
chk T2.1 "$(grep -rqsE "evaluateReadiness" $src && echo 1 || echo 0)" "ใช้ evaluateReadiness จาก engine"
chk T2.2 "$(grep -rqsE "createMemorizationTest" $src && echo 1 || echo 0)" "ใช้ createMemorizationTest จาก engine"
chk T2.3 "$(grep -rqsE "pan" $src/platform/types.ts && echo 1 || echo 0)" "AudioPlayer รองรับ pan ซ้าย/ขวา"
chk T2.4 "$(grep -rqsE "cueGate" $src && echo 1 || echo 0)" "player เรียก cueGate ก่อนเล่น cue (ด่านชั้นแอป)"
chk T2.5 "$(ls $src/audio/*.ts 2>/dev/null | wc -l | awk '{print ($1>0)}')" "โมดูล audio ฝั่งแอป"
chk T2.6 "$(ls apps/mobile/assets/audio/*.m4a apps/mobile/assets/audio/*.wav 2>/dev/null | wc -l | awk '{print ($1>=4)}')" "ambience ≥ 4 ไฟล์ (underwater/wind/rain/silence)"
chk T2.7 "$(grep -rqsE "renderSignaturePcm|signature" $src/audio 2>/dev/null && echo 1 || echo 0)" "เรนเดอร์ลายน้ำเสียงจาก engine"
chk T2.8 "$(grep -rqsE "LiveStatus|liveStatus" $src/platform/ios 2>/dev/null && echo 1 || echo 0)" "Live Activity ผ่าน LiveStatus"
chk T2.9 "$(grep -rqsE "interruption|INTERRUPTION" $src/platform/ios 2>/dev/null && echo 1 || echo 0)" "จัดการ interruption (สายเข้า)"
chk T2.10 "$(grep -rqsE "earTests\.record|earTests" $src && echo 1 || echo 0)" "บันทึก EarTest ลง repo"
chk T2.11 "$(grep -rqsE "MAX_VOLUME|ANCHOR_VOLUME_MAX|0\.35" $src/platform/ios/IosAudioPlayer.ts && echo 1 || echo 0)" "เพดาน 0.35 ที่ player"
chk T2.12 "$(grep -rqsE "NSFileProtection|completeUntilFirstUserAuthentication|data-protection" apps/mobile/app.config.ts apps/mobile/plugins 2>/dev/null && echo 1 || echo 0)" "Data Protection config plugin (หนี้ L1.8)"
thai_leak=$(grep -rlsP "[\x{0E00}-\x{0E7F}]" $app $src 2>/dev/null | grep -v "/i18n/" | wc -l); chk T3.1 "$([ "$thai_leak" = 0 ] && echo 1 || echo 0)" "ไม่มีสตริงไทยนอก i18n"
chk T3.2 "$(grep -rqsE "ready\.|earTest\." $src/i18n/th.ts && echo 1 || echo 0)" "i18n ready.*/earTest.*"
if [ -d node_modules ]; then
  (timeout 600 pnpm -s typecheck >/tmp/l17-tsc.log 2>&1); chk T4.1 "$([ $? = 0 ] && echo 1 || echo 0)" "typecheck"
  (timeout 300 npx tsx scripts/fitness.mts >/tmp/l17-fit.log 2>&1); chk T4.2 "$([ $? = 0 ] && echo 1 || echo 0)" "fitness"
  chk T4.3 "$([ -f apps/mobile/dist/index.html ] && echo 1 || echo 0)" "web export"
fi
echo; echo "ผล: ผ่าน $pass / $((pass+fail))"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L1.7app\",\"pass\":$pass,\"fail\":$fail,\"failed\":\"${notes[*]}\"}"; [ $fail = 0 ]

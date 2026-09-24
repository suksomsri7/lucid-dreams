#!/bin/bash
# ข้อสอบ L2.8 (จอกลางคืน + Live Activity + คำสั่งนาฬิกา) · L2.9 (นำเข้าสเตจ Apple + เทียบ) · L2.10 (หน้ารายงานเมื่อคืน) — โครงสร้าง · parity ตรวจแยกด้วยภาพคู่
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
app=apps/mobile/app; src=apps/mobile/src
[ -f "$app/night.tsx" ] || [ -f "$app/report/[id].tsx" ] || { echo "SKIPPED: ยังไม่มี night/report"; echo 'JSON_SUMMARY {"wo":"L2.8-10","status":"SKIPPED"}'; exit 0; }
echo "L2.8–L2.10 oracle @ $root"
# L2.8 จอกลางคืน
chk R8.1 "$([ -f $app/night.tsx ] && echo 1 || echo 0)" "route /night"
chk R8.2 "$(grep -rqsE "NightBackground|night" $app/night.tsx 2>/dev/null && echo 1 || echo 0)" "ธีมมืดอัตโนมัติ"
chk R8.3 "$(grep -rqsE "createNightController" $src && echo 1 || echo 0)" "ใช้ createNightController จาก engine"
chk R8.4 "$(grep -rqsE "onLongPress|delayLongPress|holdToStop|HoldButton" $app/night.tsx $src/ui 2>/dev/null && echo 1 || echo 0)" "กดค้างเพื่อหยุด"
chk R8.5 "$(grep -rqsE "liveStatus\.(update|start|end)" $src && echo 1 || echo 0)" "Live Activity อัปเดตจาก state"
chk R8.6 "$(grep -rqsE "setBrightness|Brightness" $src/platform 2>/dev/null && echo 1 || echo 0)" "ลดความสว่างหน้าจอ (ผ่าน platform)"
chk R8.7 "$(grep -rqsE "'stop'|\"stop\"" $src/platform/ios/WatchSensorSource.ts $src/platform/ios/watchBridge.ts 2>/dev/null && echo 1 || echo 0)" "รับคำสั่ง stop จากนาฬิกา"
chk R8.8 "$(grep -rqsE "userStop\(\)" $src && echo 1 || echo 0)" "ปุ่มหยุด → controller.userStop()"
# L2.9 Apple sleep
chk R9.1 "$(grep -rqsE "asleepREM|HKCategoryValueSleepAnalysis|sleepAnalysis" $src/platform/ios 2>/dev/null && echo 1 || echo 0)" "อ่านสเตจ Apple ผ่าน HealthImport"
chk R9.2 "$(grep -rqsE "applePhases\.saveMany" $src && echo 1 || echo 0)" "บันทึก AppleSleepPhase"
chk R9.3 "$(grep -rqsE "remMetrics" $src && echo 1 || echo 0)" "คำนวณ precision/recall ด้วย engine remMetrics"
chk R9.4 "$(grep -rqsE "retry|09:00|12:00|18:00|scheduleImport" $src/health 2>/dev/null $src/night 2>/dev/null && echo 1 || echo 0)" "ลองดึงซ้ำเมื่อยังไม่พร้อม"
chk R9.5 "$(grep -rqsE "noAppleData|apple\.none|ไม่มีข้อมูล" $src/i18n/en.ts $src/i18n/th.ts 2>/dev/null && echo 1 || echo 0)" "ข้อความ 'ไม่มีข้อมูล Apple' (ไม่ใช่ 0%)"
# L2.10 รายงานเมื่อคืน
chk R10.1 "$([ -f "$app/report/[id].tsx" ] && echo 1 || echo 0)" "route /report/[id]"
chk R10.2 "$(grep -rqsE "nightReport\(" $src && echo 1 || echo 0)" "ดึง repo.nightReport"
chk R10.3 "$(grep -rqsE "<Band" "$app/report/[id].tsx" $src/report 2>/dev/null && echo 1 || echo 0)" "แถบทั้งคืน (Band)"
chk R10.4 "$(grep -rqsE "EventRow" "$app/report/[id].tsx" $src/report 2>/dev/null && echo 1 || echo 0)" "รายการเหตุการณ์ (EventRow)"
chk R10.5 "$(grep -rqsE "exportNight|exportCsv|exportJson" $src && echo 1 || echo 0)" "ส่งออกคืนนี้"
chk R10.6 "$(grep -rqsE "CONTROL" "$app/report/[id].tsx" $src/report 2>/dev/null && echo 1 || echo 0)" "ป้ายคืนควบคุม + 'ถ้ายิง'"
chk R10.7 "$(grep -rqsE "formatLocal|toLocale|Intl\.DateTimeFormat" $src/report 2>/dev/null "$app/report/[id].tsx" && echo 1 || echo 0)" "เวลาแสดงตามโซนเครื่อง"
thai_leak=$(grep -rlsP "[\x{0E00}-\x{0E7F}]" $app $src 2>/dev/null | grep -v "/i18n/" | wc -l); chk R11.1 "$([ "$thai_leak" = 0 ] && echo 1 || echo 0)" "ไม่มีสตริงไทยนอก i18n"
if [ -d node_modules ]; then
  (timeout 600 pnpm -s typecheck >/tmp/l28-tsc.log 2>&1); chk R12.1 "$([ $? = 0 ] && echo 1 || echo 0)" "typecheck"
  (timeout 300 npx tsx scripts/fitness.mts >/tmp/l28-fit.log 2>&1); chk R12.2 "$([ $? = 0 ] && echo 1 || echo 0)" "fitness"
  chk R12.3 "$([ -f apps/mobile/dist/index.html ] && echo 1 || echo 0)" "web export"
fi
echo; echo "ผล: ผ่าน $pass / $((pass+fail))"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L2.8-10\",\"pass\":$pass,\"fail\":$fail,\"failed\":\"${notes[*]}\"}"; [ $fail = 0 ]

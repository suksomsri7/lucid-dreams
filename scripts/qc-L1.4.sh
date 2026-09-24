#!/bin/bash
# ข้อสอบ L1.4 — ห้องที่ปรึกษา UI (บทสนทนา · ชิปธีม · composer พิมพ์/ไมค์ · การ์ดแผนย่อ · ประวัติ)
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
adv=apps/mobile/src/advisor; src=apps/mobile/src
[ -d "$adv" ] || { echo "SKIPPED: ยังไม่มี $adv"; echo 'JSON_SUMMARY {"wo":"L1.4","status":"SKIPPED"}'; exit 0; }
echo "L1.4 oracle @ $root"
chk A1.1 "$(grep -rqsE "kind: *'(ai|me)'|'ai' *\| *'me'" $adv packages/engine/src 2>/dev/null && echo 1 || echo 0)" "message กินด 'ai'|'me'"
chk A1.2 "$(grep -rqsE "fromVoice|source: *'voice'" $adv && echo 1 || echo 0)" "ข้อความจากเสียงมีธง fromVoice"
chk A1.3 "$(grep -rqsE "themeChips|THEME_CHIPS|suggestedThemes" $adv $src 2>/dev/null && echo 1 || echo 0)" "ชิปธีม 6"
chk A1.4 "$(grep -rqsE "'other'|customTheme" $adv && echo 1 || echo 0)" "ชิป อื่น ๆ เปิดคีย์บอร์ด"
chk A1.5 "$(grep -rqsE "SpeechToText|speechToText" $adv apps/mobile/app 2>/dev/null && echo 1 || echo 0)" "ไมค์ผ่าน SpeechToText interface"
chk A1.6 "$(grep -rqsE "PlanCardCompact|CompactPlan" $adv apps/mobile/src/ui 2>/dev/null && echo 1 || echo 0)" "การ์ดแผนย่อ (3 แถว)"
chk A1.7 "$(ls apps/mobile/app/history* apps/mobile/app/\(tabs\)/journal.tsx 2>/dev/null | wc -l | awk '{print ($1>0)}')" "ประวัติ"
chk A1.8 "$(grep -rqsE "inverted" $adv apps/mobile/app/\(tabs\)/index.tsx 2>/dev/null && echo 1 || echo 0)" "รายการบทสนทนา inverted"
chk A1.9 "$(grep -rqsE "clarify" $adv packages/engine/src 2>/dev/null && echo 1 || echo 0)" "รองรับ clarify ≤ 1"
chk A1.10 "$(grep -rqsE "MAX_CLARIFY *= *1|clarifyCount *>= *1|clarified" $adv packages/engine/src 2>/dev/null && echo 1 || echo 0)" "จำกัด clarify 1 ครั้ง"
thai_leak=$(grep -rlsP "[\x{0E00}-\x{0E7F}]" apps/mobile/app apps/mobile/src 2>/dev/null | grep -v "/i18n/" | wc -l)
chk A2.1 "$([ "$thai_leak" = 0 ] && echo 1 || echo 0)" "ไม่มีสตริงไทยนอก i18n"
chk A2.2 "$(grep -rqsE "advisor\." apps/mobile/src/i18n/th.ts && echo 1 || echo 0)" "i18n advisor.*"
if [ -d packages/engine/test ]; then (cd packages/engine && timeout 300 npx vitest run --reporter=dot >/tmp/l14-vitest.log 2>&1); chk A3.1 "$([ $? = 0 ] && echo 1 || echo 0)" "vitest engine (advisor state ถ้าอยู่ใน engine)"; fi
if [ -d node_modules ]; then
  (timeout 600 pnpm -s typecheck >/tmp/l14-tsc.log 2>&1); chk A3.2 "$([ $? = 0 ] && echo 1 || echo 0)" "typecheck"
  (timeout 300 npx tsx scripts/fitness.mts >/tmp/l14-fit.log 2>&1); chk A3.3 "$([ $? = 0 ] && echo 1 || echo 0)" "fitness"
  chk A3.4 "$([ -f apps/mobile/dist/index.html ] && echo 1 || echo 0)" "web export"
fi
echo; echo "ผล: ผ่าน $pass / $((pass+fail))"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L1.4\",\"pass\":$pass,\"fail\":$fail,\"failed\":\"${notes[*]}\"}"; [ $fail = 0 ]

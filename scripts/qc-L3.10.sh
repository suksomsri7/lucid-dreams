#!/bin/bash
# ข้อสอบ L3.10 — R1 hotfix #2 (ห้องที่ปรึกษา): ปุ่ม ▶ ในการ์ดแผนไม่ทำงาน · กดชิปแล้วไม่มีสัญญาณกำลังคิด → กดซ้ำ บทสนทนาซ้อน
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
m=apps/mobile; src=$m/src; adv=$src/advisor
echo "L3.10 oracle @ $root"
# 1 ปุ่ม ▶
chk P1.1 "$(grep -qsE "onPlayAnchor=\{" $adv/AdvisorRoom.tsx && echo 1 || echo 0)" "AdvisorRoom ส่ง onPlayAnchor ให้ PlanCardCompact (เดิมไม่ส่ง)"
chk P1.2 "$(grep -qsE "playAnchorOnce|playAnchorPreview" $adv/AdvisorRoom.tsx $src/audio/player.ts && grep -qsE "PREVIEW_VOLUME|previewVolume" $src/audio/player.ts $adv/AdvisorRoom.tsx && echo 1 || echo 0)" "ระดับเสียงพรีวิว = ค่าฟังชัด (ไม่ใช่ 0.15 ของกลางคืน)"
chk P1.3 "$(grep -qsE "playing|isPlaying|anchorBusy" $adv/PlanCardCompact.tsx && echo 1 || echo 0)" "ปุ่มมีสถานะกำลังเล่น/กำลังโหลด (ActivityIndicator หรือไอคอนเปลี่ยน)"
chk P1.4 "$(grep -qsE "ActivityIndicator|Spinner" $adv/PlanCardCompact.tsx && echo 1 || echo 0)" "แสดงตัวหมุนตอนโหลดไฟล์เสียงครั้งแรก"
chk P1.5 "$(grep -qsE "disabled=\{" $adv/PlanCardCompact.tsx && echo 1 || echo 0)" "กันกดซ้ำระหว่างเล่น"
# 2 กำลังคิด
chk P2.1 "$(grep -qsE "busy: boolean|thinking: boolean|pending: boolean" $adv/useAdvisor.ts && echo 1 || echo 0)" "useAdvisor คืน busy"
chk P2.2 "$(grep -qsE "if \(busy|busyRef\.current|inFlight" $adv/useAdvisor.ts && echo 1 || echo 0)" "say/pickChip/edit ถูกละเว้นขณะ busy (กันบทสนทนาซ้อน)"
chk P2.3 "$([ -f $src/ui/TypingBubble.tsx ] || grep -qsE "TypingBubble|typing" $src/ui/Bubble.tsx && echo 1 || echo 0)" "ฟองกำลังคิด (จุด 3 จุดขยับ)"
chk P2.4 "$(grep -qsE "TypingBubble|typing" $adv/AdvisorRoom.tsx && echo 1 || echo 0)" "AdvisorRoom แสดงฟองกำลังคิดทันทีที่กด"
chk P2.5 "$(grep -qsE "Animated" $src/ui/TypingBubble.tsx $src/ui/Bubble.tsx 2>/dev/null && echo 1 || echo 0)" "จุดขยับด้วย Animated (ไม่ใช่ข้อความนิ่ง)"
chk P2.6 "$(grep -qsE "busy" $adv/AdvisorRoom.tsx && grep -qsE "onPress=\{.*busy|disabled=\{busy|rowLocked \|\| busy" $adv/AdvisorRoom.tsx && echo 1 || echo 0)" "ชิป + ปุ่มส่ง + ไมค์ ปิดขณะ busy"
chk P2.7 "$(grep -qsE "selected: true|selected = true|markSelected|selected:" $adv/adapter.ts && grep -qsE "pickChip" $adv/adapter.ts && echo 1 || echo 0)" "ชิปที่เลือกถูกล็อกทันที (selected) ไม่ใช่รอคำตอบ"
chk P2.8 "$(grep -qsE "'advisor\.thinking'" $src/i18n/th.ts && grep -qsE "'advisor\.thinking'" $src/i18n/en.ts && echo 1 || echo 0)" "a11y label ฟองกำลังคิด th/en"
chk P2.9 "$(grep -qsE "'advisor-thinking'" $adv/AdvisorRoom.tsx $src/dev/fixtures.ts && grep -qsE "'advisor-thinking'" scripts/visual-all.js && echo 1 || echo 0)" "fixture advisor-thinking + route ใน visual-all"
# 3 สุขภาพ
chk P3.1 "$(cd $m && pnpm -s typecheck >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm typecheck"
chk P3.2 "$(pnpm -s fitness >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm fitness"
chk P3.3 "$(grep -rqsE "[ก-๙]" $adv $src/ui/TypingBubble.tsx 2>/dev/null && echo 0 || echo 1)" "ไม่มีไทยนอก i18n"
chk P3.4 "$(cd $m && NODE_OPTIONS=--max-old-space-size=3584 timeout 500 npx expo export --platform ios --output-dir /tmp/claude-0/l310-ios >/dev/null 2>&1 && echo 1 || echo 0)" "expo export ios ผ่าน"
echo "L3.10 $pass / $((pass+fail))"; [ $fail -eq 0 ] && st=PASS || st=FAIL
echo "JSON_SUMMARY {\"wo\":\"L3.10\",\"pass\":$pass,\"fail\":$fail,\"status\":\"$st\",\"failed\":\"${notes[*]}\"}"
[ $fail -eq 0 ]

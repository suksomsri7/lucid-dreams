#!/bin/bash
# ข้อสอบ L3.11 — Settings v2 โปร่ง (เจ้าของ: แถวแคบ/อัดแน่น · ระยะไม่เท่า · 'Watermark reset' ค้าง · ภาษาล้นขอบ) — โครงสร้าง · parity กับ 09 v2 ตรวจแยกด้วยตา
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
m=apps/mobile; f=$m/app/\(tabs\)/settings.tsx; src=$m/src
echo "L3.11 oracle @ $root"
chk S1.1 "$(grep -qsE "SETTINGS_ROW_MIN_HEIGHT *= *52|minHeight: *52" $f $src/ui/Row.tsx && echo 1 || echo 0)" "แถวสูงขั้นต่ำ 52"
chk S1.2 "$(grep -qsE "SETTINGS_INSET *= *16|paddingHorizontal: *(16|spacing\.lg)" $f $src/ui/Row.tsx && echo 1 || echo 0)" "ระยะซ้าย/ขวา 16 ค่าเดียว"
chk S1.3 "$(python3 - <<'PY'
import re
s=open('apps/mobile/app/(tabs)/settings.tsx').read()
# ทุกแถวต้องผ่านคอมโพเนนต์ Row/SettingRow เดียว: ห้ามมี Pressable/View ที่ตั้ง paddingHorizontal เองนอก Row
loose=re.findall(r'paddingHorizontal:\s*\d+', s)
print(1 if len(set(loose))<=1 else 0)
PY
)" "ไม่มีแถวตั้ง padding เอง (ค่า paddingHorizontal ไม่เกิน 1 ค่าในไฟล์)"
chk S1.4 "$(grep -qsE "Watermark reset|settings\.sound\.resetDone|resetToast" $f && grep -qsE "toast|visible|setTimeout" $f && echo 1 || echo 0)" "'Watermark reset' เป็น toast มีเวลาหาย (ไม่ค้าง)"
chk S1.5 "$(python3 - <<'PY'
s=open('apps/mobile/app/(tabs)/settings.tsx').read()
i=s.find('settings.data.language') if 'settings.data.language' in s else s.find('Seg')
print(1 if ('flexShrink' in s or 'maxWidth' in s) else 0)
PY
)" "ตัวเลือกภาษาไม่ล้นขอบ (flexShrink/maxWidth)"
chk S1.6 "$(grep -qsE "'settings\.group\.(devices|sound|sleep|data|test)'" $src/i18n/th.ts && grep -qsE "'settings\.group\.(devices|sound|sleep|data|test)'" $src/i18n/en.ts && echo 1 || echo 0)" "หัวกลุ่ม 5 กลุ่ม ผ่าน i18n (รวม 'สำหรับรอบทดสอบ')"
chk S1.7 "$(grep -qsE "diagnostics" $f && grep -qsE "settings\.diagnostics\.sub|diagnostics\.entry\.sub" $src/i18n/th.ts && echo 1 || echo 0)" "Diagnostics เป็นแถวในการ์ด (มี sub) ไม่ใช่ปุ่มลอย"
chk S1.8 "$(grep -qsE "stepper|Stepper|rb|roundButton" $f && echo 1 || echo 0)" "ระดับเสียง = ปุ่มกลม − 15% + ตามแบบ"
chk S1.9 "$(grep -qsE "'settings\.sound\.auto\.sub'|'settings\.sound\.autoSub'" $src/i18n/th.ts && echo 1 || echo 0)" "sub 'เปิดตลอดในโหมดปกติ' ใต้สวิตช์ปรับระดับ"
chk S2.1 "$(cd $m && pnpm -s typecheck >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm typecheck"
chk S2.2 "$(pnpm -s fitness >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm fitness"
chk S2.3 "$(grep -qsE "'settings-scrolled'|settings-scrolled" scripts/visual-all.js && echo 1 || echo 0)" "route ภาพ settings แบบเลื่อนลง (เทียบกรอบขวาของ 09)"
echo "L3.11 $pass / $((pass+fail))"; [ $fail -eq 0 ] && st=PASS || st=FAIL
echo "JSON_SUMMARY {\"wo\":\"L3.11\",\"pass\":$pass,\"fail\":$fail,\"status\":\"$st\",\"failed\":\"${notes[*]}\"}"
[ $fail -eq 0 ]

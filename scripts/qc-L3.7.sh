#!/bin/bash
# ข้อสอบ L3.7 — แบรนด์: ไอคอน M + หน้าเปิดแอป (intro) + เสียงสมอ 1 รอบ (โหลดเสร็จ · กด Start tonight) · parity ตรวจแยก (ภาพ 11)
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
m=apps/mobile; app=$m/app; src=$m/src
echo "L3.7 oracle @ $root"
# ── ไอคอน
chk B1.1 "$(python3 -c "
from PIL import Image;im=Image.open('$m/assets/icon.png');print(1 if im.size==(1024,1024) and im.mode=='RGB' else 0)" 2>/dev/null)" "assets/icon.png 1024² ไม่มี alpha"
chk B1.2 "$(grep -qsE "icon: *'\./assets/icon\.png'" $m/app.config.ts && echo 1 || echo 0)" "app.config icon → assets/icon.png"
chk B1.3 "$(grep -qsE "adaptiveIcon" $m/app.config.ts && grep -qsE "foregroundImage: *'\./assets/adaptive-icon\.png'" $m/app.config.ts && echo 1 || echo 0)" "android adaptiveIcon (โค้ดรองรับอนาคต rule 8)"
chk B1.4 "$([ -s targets/watch/Assets.xcassets/AppIcon.appiconset/icon-1024.png ] && [ -s targets/watch/Assets.xcassets/AppIcon.appiconset/Contents.json ] && echo 1 || echo 0)" "watch AppIcon 1024"
# ── native splash (expo-splash-screen) ต่อเนื่องเข้า intro JS
chk B2.1 "$(grep -qsE '"expo-splash-screen"' $m/package.json && echo 1 || echo 0)" "dep expo-splash-screen"
chk B2.2 "$(grep -qsE "'expo-splash-screen'" $m/app.config.ts && grep -qsE "splash-icon\.png" $m/app.config.ts && echo 1 || echo 0)" "plugin expo-splash-screen ใช้ assets/splash-icon.png"
chk B2.3 "$(grep -qsE "preventAutoHideAsync" $app/_layout.tsx $src/intro/*.ts* 2>/dev/null && echo 1 || echo 0)" "preventAutoHideAsync (ไม่กระพริบระหว่าง native splash → intro)"
chk B2.4 "$(grep -qsE "hideAsync|hide\(\)" $app/_layout.tsx $src/intro/*.ts* 2>/dev/null && echo 1 || echo 0)" "ซ่อน native splash เมื่อ intro ขึ้นแล้ว"
# ── intro overlay (โลโก้ + เอฟเฟกต์)
chk B3.1 "$([ -d $src/intro ] && ls $src/intro/*.tsx >/dev/null 2>&1 && echo 1 || echo 0)" "src/intro/ มีคอมโพเนนต์"
chk B3.2 "$(grep -qsE "<Intro|Intro[A-Za-z]*Overlay|from '\.\./src/intro'" $app/_layout.tsx && echo 1 || echo 0)" "_layout เรียก Intro"
chk B3.3 "$(grep -rqsE "react-native-svg|from 'react-native-svg'" $src/intro && echo 1 || echo 0)" "โลโก้วาดด้วย react-native-svg (คมทุกขนาด)"
chk B3.4 "$(grep -rqsE "M208 198 H528 L208 518 H528" $src/intro && grep -rqsE "M578 388 H818 L578 628 H818" $src/intro && grep -rqsE "M300 662 H500 L300 852 H500" $src/intro && echo 1 || echo 0)" "path Zzz ตรงกับไอคอน M (โครงเจ้าของ)"
chk B3.5 "$(grep -rqsE "Animated|react-native-reanimated" $src/intro && echo 1 || echo 0)" "มีแอนิเมชัน (จางเข้า/ขยาย/วงแสง)"
chk B3.6 "$(grep -rqsE "loop|withRepeat|Animated\.loop" $src/intro && echo 1 || echo 0)" "วงแสงหายใจวนลูป"
chk B3.7 "$(grep -rqsE "INTRO_MAX_MS *= *([0-9]{3,4})" $src/intro && python3 -c "
import re,glob;v=[int(x) for f in glob.glob('$src/intro/*.ts*') for x in re.findall(r'INTRO_MAX_MS *= *(\d+)',open(f).read())];print(1 if v and max(v)<=6000 else 0)" || echo 0)" "เพดานรอ INTRO_MAX_MS ≤ 6000 (ไม่ค้างถ้า hydrate ช้า)"
chk B3.8 "$(grep -rqsE "INTRO_MIN_MS *= *([0-9]{3,4})" $src/intro && echo 1 || echo 0)" "เวลาขั้นต่ำให้เห็นเอฟเฟกต์ INTRO_MIN_MS"
chk B3.9 "$(grep -rqsE "intro" $src/dev/fixtures.ts && echo 1 || echo 0)" "fixture=intro ค้างหน้า intro ไว้ถ่ายภาพ"
chk B3.10 "$(grep -qsE "'intro'" scripts/visual-all.js && echo 1 || echo 0)" "visual-all.js มี route intro"
chk B3.11 "$(grep -rqsE "Platform\.OS === 'web'" $src/intro $app/_layout.tsx && echo 1 || echo 0)" "บนเว็บ intro ขึ้นเฉพาะ fixture=intro (ไม่บังภาพ QC จออื่น)"
chk B3.12 "$(grep -qsE "'intro\.wordmark'" $src/i18n/th.ts && grep -qsE "'intro\.wordmark'" $src/i18n/en.ts && echo 1 || echo 0)" "wordmark ผ่าน i18n"
# ── เสียงสมอ 1 รอบ
chk B4.1 "$([ -f $src/audio/brand.ts ] && grep -qsE "export async function playBrandAnchor" $src/audio/brand.ts && grep -qsE "playAnchorOnce" $src/audio/brand.ts && echo 1 || echo 0)" "src/audio/brand.ts playBrandAnchor → playAnchorOnce (pan 0)"
chk B4.2 "$(grep -rqsE "playBrandAnchor" $src/intro && echo 1 || echo 0)" "intro เล่นเสียงเมื่อโหลดเสร็จ"
chk B4.3 "$(grep -qsE "playBrandAnchor" $src/advisor/AdvisorRoom.tsx && echo 1 || echo 0)" "Start tonight เล่นเสียง 1 รอบ"
chk B4.4 "$(python3 - <<'PY'
import re
s=open('apps/mobile/src/advisor/AdvisorRoom.tsx').read()
i=s.find('playBrandAnchor('); j=s.find("router.push('/plan')")
print(1 if 0<=i<j else 0)
PY
)" "เล่นเสียงก่อน push('/plan') (ไม่ await ค้าง)"
chk B4.5 "$(grep -rqsE "playedThisLaunch|introPlayed|hasPlayed" $src/intro $src/audio/brand.ts && echo 1 || echo 0)" "เล่นครั้งเดียวต่อการเปิดแอป (ไม่ซ้ำตอน re-render)"
chk B4.6 "$(grep -qsE "volume" $src/audio/brand.ts && grep -qsE "0\.15|settings|getVolume|anchorVolume" $src/audio/brand.ts && echo 1 || echo 0)" "ระดับเสียง = ค่าที่ผู้ใช้ตั้ง (ถอย 0.15)"
# ── สุขภาพโค้ด
chk B5.1 "$(cd $m && pnpm -s typecheck >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm typecheck"
chk B5.2 "$(pnpm -s fitness >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm fitness"
chk B5.3 "$(grep -rqsE "[ก-๙]" $src/intro $src/audio/brand.ts 2>/dev/null && echo 0 || echo 1)" "ไม่มีข้อความไทยนอก i18n ใน intro/brand"
echo "L3.7 $pass / $((pass+fail))"; [ $fail -eq 0 ] && st=PASS || st=FAIL
echo "JSON_SUMMARY {\"wo\":\"L3.7\",\"pass\":$pass,\"fail\":$fail,\"status\":\"$st\",\"failed\":\"${notes[*]}\"}"
[ $fail -eq 0 ]

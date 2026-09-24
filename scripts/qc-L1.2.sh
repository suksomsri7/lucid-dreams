#!/bin/bash
# ข้อสอบ L1.2 — ระบบดีไซน์กระจก + โครง 3 แท็บ + i18n (Fable เขียนก่อน builder · builder ห้ามแก้)
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ "$2" = 1 ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
has(){ [ -e "$1" ] && echo 1 || echo 0; }
ui=apps/mobile/src/ui
[ -d "$ui" ] || { echo "SKIPPED: ยังไม่มี $ui"; echo 'JSON_SUMMARY {"wo":"L1.2","status":"SKIPPED"}'; exit 0; }
echo "L1.2 oracle @ $root"
# U1 คอมโพเนนต์ครบ (ไฟล์หรือ export)
for c in GlassSurface GlassCard Chip Button Composer Bubble Scale Seg Switch Band EventRow Hyp FloatingTabBar; do
  chk "U1.$c" "$(grep -rqsE "export (function|const) $c\b" $ui && echo 1 || echo 0)" "export $c"
done
# U2 โทเคนตรง _base.part
tok=$ui/tokens.ts; chk U2.0 "$(has $tok)" "tokens.ts"
for v in "#6b5cff" "#0e9f7a" "#d9483b" "#111318" "#5b6170" "#8b91a0" "#0b0f1a"; do chk "U2.$v" "$(grep -qsi -- "$v" $tok && echo 1 || echo 0)" "token $v"; done
chk U2.r "$(grep -qsE "radius" $tok && echo 1 || echo 0)" "มีชุด radius"
# U3 ห้ามสีนอกโทเคนใน ui/ และ app/
leak=$(grep -rhoE "#[0-9a-fA-F]{6}\b" $ui apps/mobile/app 2>/dev/null | grep -v -f <(grep -oE "#[0-9a-fA-F]{6}" $tok 2>/dev/null | sort -u) | sort -u | wc -l)
chk U3.1 "$([ "$leak" = 0 ] && echo 1 || echo 0)" "ไม่มี hex สีนอก tokens.ts ($leak ค่า)"
# U4 แท็บบาร์ลอย 3 แท็บ + route dev/ui
chk U4.1 "$(grep -qsE "FloatingTabBar" apps/mobile/app/\(tabs\)/_layout.tsx && echo 1 || echo 0)" "tabs ใช้ FloatingTabBar"
chk U4.2 "$(grep -cE "name=\"(index|journal|settings)\"" apps/mobile/app/\(tabs\)/_layout.tsx 2>/dev/null | awk '{print ($1==3)}')" "3 แท็บ index/journal/settings"
chk U4.3 "$(ls apps/mobile/app/dev/ui* 2>/dev/null | wc -l | awk '{print ($1>0)}')" "route /dev/ui"
# U5 i18n
chk U5.1 "$(node -e "const th=require('fs').readFileSync('apps/mobile/src/i18n/th.ts','utf8'),en=require('fs').readFileSync('apps/mobile/src/i18n/en.ts','utf8');const k=s=>[...s.matchAll(/^\s*['\"]?([A-Za-z0-9_.]+)['\"]?\s*:/gm)].map(m=>m[1]).sort();const a=k(th),b=k(en);process.stdout.write(JSON.stringify(a)===JSON.stringify(b)&&a.length>10?'1':'0')")" "คีย์ th/en ตรงกันและ > 10"
thai_leak=$(grep -rlsP "[\x{0E00}-\x{0E7F}]" apps/mobile/app apps/mobile/src 2>/dev/null | grep -v "/i18n/" | wc -l)
chk U5.2 "$([ "$thai_leak" = 0 ] && echo 1 || echo 0)" "ไม่มีสตริงไทยนอก i18n"
chk U5.3 "$(grep -rqsE "setLocale|useLocale" apps/mobile/src/i18n && echo 1 || echo 0)" "สลับภาษา runtime"
# U6 รันจริง
if [ -d node_modules ]; then
  (timeout 600 pnpm -s typecheck >/tmp/l12-tsc.log 2>&1); chk U6.1 "$([ $? = 0 ] && echo 1 || echo 0)" "typecheck"
  (timeout 300 npx tsx scripts/fitness.mts >/tmp/l12-fit.log 2>&1); chk U6.2 "$([ $? = 0 ] && echo 1 || echo 0)" "fitness"
  chk U6.3 "$(has apps/mobile/dist/index.html)" "web export (builder รันผ่าน heavy.sh)"
fi
echo; echo "ผล: ผ่าน $pass / $((pass+fail))"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L1.2\",\"pass\":$pass,\"fail\":$fail,\"failed\":\"${notes[*]}\"}"; [ $fail = 0 ]

#!/bin/bash
# ข้อสอบ L1.1 — spike โครงโปรเจกต์ (Fable เขียนก่อน builder · builder ห้ามแก้)
# ใช้: ./scripts/qc-L1.1.sh [root]   → พิมพ์ผลทีละข้อ + JSON_SUMMARY ท้ายสุด
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; skip=0; notes=()
chk(){ local id="$1" ok="$2" msg="$3"; if [ -n "$ok" ] && [ -z "${ok//1/}" ]; then pass=$((pass+1)); echo "  ✅ $id $msg"; else fail=$((fail+1)); echo "  ❌ $id $msg"; notes+=("$id"); fi; }
has(){ [ -e "$1" ] && echo 1 || echo 0; }
grepq(){ grep -qs -- "$2" "$1" && echo 1 || echo 0; }

if [ ! -f package.json ]; then echo "SKIPPED: ยังไม่มี package.json (ยังไม่มีโค้ด)"; echo 'JSON_SUMMARY {"wo":"L1.1","status":"SKIPPED"}'; exit 0; fi
echo "L1.1 oracle @ $root"

# S1 โครง monorepo
chk S1.1 "$(has pnpm-workspace.yaml)" "pnpm-workspace.yaml"
chk S1.2 "$(has apps/mobile/package.json)" "apps/mobile"
chk S1.3 "$(has packages/engine/package.json)" "packages/engine"
chk S1.4 "$(has apps/api/package.json)" "apps/api (ว่างได้)"
chk S1.5 "$(has targets/watch)" "targets/watch (Swift)"
chk S1.6 "$([ -e apps/mobile/app.json ] || [ -e apps/mobile/app.config.ts ] && echo 1 || echo 0)" "app.json|app.config.ts"
chk S1.7 "$(grepq apps/mobile/package.json expo-router)" "expo-router"
chk S1.8 "$(has apps/mobile/tsconfig.json)$(grepq apps/mobile/tsconfig.json '"strict": true')" "TS strict มือถือ"

# S2 engine เป็น TS ล้วน
eng_rn=$(grep -rlsE "from ['\"](react-native|expo|expo-[a-z-]+)" packages/engine/src 2>/dev/null | wc -l)
chk S2.1 "$([ "$eng_rn" = 0 ] && echo 1 || echo 0)" "engine ไม่ import react-native/expo ($eng_rn ไฟล์)"
chk S2.2 "$(grepq packages/engine/package.json vitest)" "engine มี vitest"
chk S2.3 "$(has packages/engine/src/index.ts)" "engine/src/index.ts"
chk S2.4 "$(has packages/engine/src/diagnostics.ts)" "diagnostics schema (zod) ใน engine"

# S3 แพลตฟอร์ม interface + stub android (Android-ready)
for i in SensorSource AudioPlayer LiveStatus HealthImport SpeechToText; do
  chk "S3.$i" "$(grep -rqs "interface $i\|type $i\b" apps/mobile/src/platform 2>/dev/null && echo 1 || echo 0)" "interface $i"
done
chk S3.6 "$(has apps/mobile/src/platform/ios)$(has apps/mobile/src/platform/android)" "platform/ios + platform/android"
ios_leak=$(grep -rlsE "from ['\"](expo-glass-effect|react-native-watch-connectivity|@bacons/apple-targets)" apps/mobile/src apps/mobile/app 2>/dev/null | grep -v "/platform/ios/" | wc -l)
chk S3.7 "$([ "$ios_leak" = 0 ] && echo 1 || echo 0)" "โมดูล iOS-only อยู่ใน platform/ios เท่านั้น ($ios_leak หลุด)"

# S4 config เบื้องหลัง/สิทธิ์/glass/watch
cfg=$(ls apps/mobile/app.json apps/mobile/app.config.ts 2>/dev/null | head -1)
chk S4.1 "$(grepq "$cfg" '"audio"')" "UIBackgroundModes audio"
chk S4.2 "$(grepq "$cfg" 'expo-glass-effect')$(grepq apps/mobile/package.json 'expo-glass-effect')" "expo-glass-effect"
chk S4.3 "$(grepq "$cfg" 'apple-targets')" "@bacons/apple-targets plugin"
chk S4.4 "$(grepq "$cfg" 'NSHealthShareUsageDescription')" "ข้อความขอสิทธิ์ HealthKit"
chk S4.5 "$(grepq "$cfg" 'NSMicrophoneUsageDescription')" "ข้อความขอสิทธิ์ไมค์"
chk S4.6 "$(grepq "$cfg" 'NSBluetoothAlwaysUsageDescription')" "ข้อความขอสิทธิ์ Bluetooth"
chk S4.7 "$(grepq "$cfg" 'Lucid Dream')" "ชื่อแอป Lucid Dream"
chk S4.8 "$(ls targets/watch/*.swift targets/watch/**/*.swift 2>/dev/null | wc -l | awk '{print ($1>0)}')" "มีไฟล์ Swift นาฬิกา"
chk S4.9 "$(grep -rqs 'HKWorkoutSession\|HKLiveWorkoutBuilder' targets/watch 2>/dev/null && echo 1 || echo 0)" "workout session ในโค้ดนาฬิกา"
chk S4.10 "$(grep -rqs 'WCSession' targets/watch 2>/dev/null && echo 1 || echo 0)" "WCSession ในโค้ดนาฬิกา"

# S5 หน้า Diagnostics + i18n
chk S5.1 "$(ls apps/mobile/app/**/diagnostics* apps/mobile/app/diagnostics* 2>/dev/null | wc -l | awk '{print ($1>0)}')" "route diagnostics"
chk S5.2 "$(has apps/mobile/src/i18n/th.ts)$(has apps/mobile/src/i18n/en.ts)" "i18n th+en"
thai_leak=$(grep -rlsP "[\x{0E00}-\x{0E7F}]" apps/mobile/app apps/mobile/src 2>/dev/null | grep -v "/i18n/" | wc -l)
chk S5.3 "$([ "$thai_leak" = 0 ] && echo 1 || echo 0)" "ไม่มีสตริงไทยนอก i18n ($thai_leak ไฟล์)"

# S6 สคริปต์/CI
chk S6.1 "$(has scripts/fitness.mts)" "scripts/fitness.mts"
chk S6.2 "$(has .github/workflows/ci.yml)" "CI workflow"
chk S6.3 "$(has scripts/heavy.sh)$(has scripts/autosave.sh)$(has scripts/backup-bundle.sh)" "heavy/autosave/backup"
chk S6.4 "$(has .gitignore)$(grepq .gitignore node_modules)" ".gitignore มี node_modules"
chk S6.5 "$(grep -rqsE "sk-ant-|AKIA[0-9A-Z]{16}" --include=*.ts --include=*.tsx --include=*.json --include=*.swift --exclude-dir=node_modules . 2>/dev/null && echo 0 || echo 1)" "ไม่มี secret ในโค้ด"

# S7 รันจริง (ถ้ามี node_modules)
if [ -d node_modules ]; then
  (cd packages/engine && timeout 300 npx vitest run --reporter=dot >/tmp/l11-vitest.log 2>&1); chk S7.1 "$([ $? = 0 ] && echo 1 || echo 0)" "vitest engine ผ่าน (log /tmp/l11-vitest.log)"
  (timeout 600 pnpm -s tsc -b 2>/tmp/l11-tsc.log || timeout 600 pnpm -r -s exec tsc --noEmit >/tmp/l11-tsc.log 2>&1); chk S7.2 "$([ $? = 0 ] && echo 1 || echo 0)" "tsc ผ่าน (log /tmp/l11-tsc.log)"
  (timeout 300 npx tsx scripts/fitness.mts >/tmp/l11-fit.log 2>&1); chk S7.3 "$([ $? = 0 ] && echo 1 || echo 0)" "fitness ผ่าน (log /tmp/l11-fit.log)"
  chk S7.4 "$(has apps/mobile/dist/index.html)" "expo export web มี dist/index.html (builder รันผ่าน heavy.sh)"
else
  skip=4; echo "  ⏭ S7.* ข้าม (ยังไม่มี node_modules)"
fi

total=$((pass+fail)); echo; echo "ผล: ผ่าน $pass / $total (ข้าม $skip)"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L1.1\",\"pass\":$pass,\"fail\":$fail,\"skip\":$skip,\"failed\":\"${notes[*]}\"}"
[ $fail = 0 ]

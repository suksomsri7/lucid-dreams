#!/bin/bash
# ข้อสอบ L3.14 — เสียงครบคืน: ประโยคปลูกภาพพูดจริง (George /ai/tts) · ducking เสียงพื้นตอนพูด/ตอน cue · เสียงบรรยากาศจริง
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
m=apps/mobile; src=$m/src; f=$src/audio/seedRemote.ts
echo "L3.14 oracle @ $root"
chk N1.1 "$([ -f $f ] && grep -qsE "export async function ensureSeedLineUri" $f && grep -qsE "export async function prefetchSeedLines" $f && echo 1 || echo 0)" "seedRemote.ts: ensureSeedLineUri + prefetchSeedLines"
chk N1.2 "$(grep -qsE "/ai/tts" $f $src/api/client.ts && grep -qsE "fetchTtsAudio|postTts" $src/api/client.ts && echo 1 || echo 0)" "เรียก POST /ai/tts ผ่าน api/client (device token · voice 'whisper')"
chk N1.3 "$(grep -qsE "SEED_AUDIO_VERSION" $f && grep -qsE "Paths\.cache" $f && grep -qsE "\.mp3" $f && echo 1 || echo 0)" "แคชไฟล์ต่อ (ข้อความ·ภาษา·เวอร์ชัน) ใน Paths.cache"
chk N1.4 "$(grep -qsE "Platform\.OS === 'web'" $f && grep -qsE "catch" $f && echo 1 || echo 0)" "เว็บไม่ยิง network · ล้ม = null ไม่ throw"
chk N1.5 "$(grep -qsE "prefetchSeedLines" $src/advisor/useAdvisor.ts $src/advisor/AdvisorRoom.tsx $src/store/night.ts 2>/dev/null && echo 1 || echo 0)" "prefetch ตอนสร้างแผน/Start tonight"
chk N1.6 "$(grep -qsE "prefetchSeedLines" $src/night/session.ts && echo 1 || echo 0)" "prefetch ตอนเริ่มคืน (โอกาสสุดท้าย)"
# เล่นจริงตอน SEED
chk N2.1 "$(grep -qsE "ensureSeedLineUri" $src/night/session.ts && grep -qsE "playOneShot" $src/night/session.ts && echo 1 || echo 0)" "SEED action เล่นคลิปจริง (playOneShot)"
chk N2.2 "$(grep -qsE "SEED_VOLUME *= *0\.(3|35|4)" $src/night/session.ts $src/audio/*.ts && echo 1 || echo 0)" "ระดับเสียงประโยคปลูกภาพ 0.30–0.40 (คนยังตื่น)"
chk N2.3 "$(grep -qsE "duck|DUCK" $src/night/session.ts $src/audio/*.ts && grep -qsE "setVolume" $src/night/session.ts $src/audio/*.ts && echo 1 || echo 0)" "ducking เสียงพื้น: ลดตอนพูด/cue แล้วคืนค่าเดิม"
chk N2.4 "$(grep -qsE "BED_DUCK_SEED *= *0\.0[4-8]|BED_DUCK_CUE *= *0\.0[2-4]" $src/night/session.ts $src/audio/*.ts && echo 1 || echo 0)" "ค่า duck: seed ≈0.06 · cue ≈0.03"
chk N2.5 "$(grep -qsE "played: *(seedPlayed|played|ok)" $src/night/session.ts && echo 1 || echo 0)" "บันทึก played จริง/ไม่จริงของ SEED ลง DB"
chk N2.6 "$(grep -qsE "bedVolume|currentBedVolume" $src/night/session.ts && echo 1 || echo 0)" "จำระดับเสียงพื้นล่าสุด (จาก SET_BED_VOLUME) เพื่อคืนค่าหลัง duck"
chk N2.7 "$(grep -qsE "PLAY_CUE" $src/night/session.ts && grep -qsE "duck" $src/night/session.ts && echo 1 || echo 0)" "cue กลางคืนก็ duck เสียงพื้น"
# เสียงบรรยากาศจริง (Fable ใส่ไฟล์แล้ว)
chk N3.1 "$(python3 -c "
import subprocess,sys
ok=1
for k in ['wind','rain','underwater']:
    d=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0','apps/mobile/assets/audio/ambience-%s.m4a'%k],capture_output=True,text=True).stdout.strip() or 0)
    if d<45: ok=0
print(ok)")" "ambience 3 ไฟล์ยาว ≥45 s (ไม่ใช่ placeholder 25 s เบา)"
chk N3.2 "$(grep -qsE "loop = true" $src/platform/ios/IosAudioPlayer.ts && echo 1 || echo 0)" "เสียงพื้นวนลูป"
# สุขภาพ
chk N4.1 "$(cd $m && pnpm -s typecheck >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm typecheck"
chk N4.2 "$(pnpm -s fitness >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm fitness"
chk N4.3 "$(grep -rqsE "[ก-๙]" $f && echo 0 || echo 1)" "ไม่มีไทยนอก i18n"
chk N4.4 "$(cd $m && NODE_OPTIONS=--max-old-space-size=3584 timeout 500 npx expo export --platform ios --output-dir /tmp/claude-0/l314-ios >/dev/null 2>&1 && echo 1 || echo 0)" "expo export ios ผ่าน"
echo "L3.14 $pass / $((pass+fail))"; [ $fail -eq 0 ] && st=PASS || st=FAIL
echo "JSON_SUMMARY {\"wo\":\"L3.14\",\"pass\":$pass,\"fail\":$fail,\"status\":\"$st\",\"failed\":\"${notes[*]}\"}"
[ $fail -eq 0 ]

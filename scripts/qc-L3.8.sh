#!/bin/bash
# ข้อสอบ L3.8 — แอปดึง "เสียงสมอเต็ม" (ระฆัง+กระซิบ George) จาก /ai/anchor มาเก็บในเครื่อง แล้วใช้กับ cue กลางคืน + เสียงแบรนด์
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
m=apps/mobile; src=$m/src
echo "L3.8 oracle @ $root"
f=$src/audio/anchorRemote.ts
chk F1.1 "$([ -f $f ] && echo 1 || echo 0)" "src/audio/anchorRemote.ts"
chk F1.2 "$(grep -qsE "export async function ensureFullAnchorUri" $f && echo 1 || echo 0)" "ensureFullAnchorUri(signature, lang) → file uri | null"
chk F1.3 "$(grep -qsE "/ai/anchor" $f $src/api/client.ts && echo 1 || echo 0)" "เรียก POST /ai/anchor"
chk F1.4 "$(grep -qsE "authorization|Bearer" $src/api/client.ts && grep -qsE "fetchAnchorAudio|postAnchor|anchorAudio" $src/api/client.ts && echo 1 || echo 0)" "ผ่าน api/client.ts (device token เดียวกัน)"
chk F1.5 "$(grep -qsE "x-anchor-hash" $f $src/api/client.ts && echo 1 || echo 0)" "ตรวจ header x-anchor-hash ตรงกับ signature.hash (ไม่รับไฟล์ผิดคน)"
chk F1.6 "$(grep -qsE "Paths\.cache|Directory\(" $f && grep -qsE "\.mp3" $f && echo 1 || echo 0)" "เก็บเป็นไฟล์ mp3 ในแคชแอป"
chk F1.7 "$(grep -qsE "ANCHOR_REMOTE_VERSION|FULL_ANCHOR_VERSION" $f && echo 1 || echo 0)" "เวอร์ชันในชื่อไฟล์ (เปลี่ยนเสียงบนเซิร์ฟเวอร์ = โหลดใหม่)"
chk F1.8 "$(grep -qsE "timeout|AbortController" $f $src/api/client.ts && echo 1 || echo 0)" "มี timeout (ห้ามค้างตอนเข้านอน)"
chk F1.9 "$(grep -qsE "Platform\.OS === 'web'" $f && echo 1 || echo 0)" "เว็บ (QC) ไม่ยิง network"
chk F1.10 "$(grep -qsE "catch" $f && echo 1 || echo 0)" "ล้ม = คืน null ไม่ throw"
# ใช้งาน
chk F2.1 "$(grep -qsE "ensureFullAnchorUri|fullAnchor" $src/audio/player.ts && echo 1 || echo 0)" "playAnchorOnce pan 0 ใช้ไฟล์เต็มถ้ามี ถอยเป็นระฆัง WAV"
chk F2.2 "$(grep -qsE "pan === 0|pan !== 0" $src/audio/player.ts && echo 1 || echo 0)" "หูซ้าย/ขวา (pan ≠ 0) ยังใช้ระฆังสั้น WAV เดิม"
chk F2.3 "$(grep -qsE "prefetchFullAnchor|ensureFullAnchorUri" $src/night/session.ts $src/store/night.ts $src/advisor/useAdvisor.ts $src/advisor/AdvisorRoom.tsx 2>/dev/null && echo 1 || echo 0)" "prefetch ตอนสร้างแผน/Start tonight (คืนต้องออฟไลน์ได้)"
chk F2.4 "$(grep -qsE "prefetchFullAnchor|ensureFullAnchorUri" $src/intro/*.tsx $src/audio/brand.ts $m/app/_layout.tsx 2>/dev/null && echo 1 || echo 0)" "prefetch ตอนเปิดแอป (พื้นหลัง ไม่บล็อก intro)"
chk F2.5 "$(grep -qsE "readiness|fullAnchorReady|anchorReady" $m/app/plan/devices.tsx $src/readiness 2>/dev/null $src/plan 2>/dev/null && echo 1 || echo 0)" "หน้าตรวจอุปกรณ์แสดงสถานะ 'เสียงกระซิบพร้อม/กำลังโหลด' (ไม่บล็อก)"
chk F2.6 "$(grep -qsE "'plan\.anchor\.(ready|loading|offline)'" $src/i18n/th.ts && grep -qsE "'plan\.anchor\.(ready|loading|offline)'" $src/i18n/en.ts && echo 1 || echo 0)" "i18n plan.anchor.ready/loading/offline ทั้ง th/en"
chk F2.7 "$(grep -qsE "clearFullAnchorCache|clearAnchorCache" $src/audio/anchorRemote.ts $src/audio/anchor.ts && grep -qsE "resetAnchorSeed" $src/audio/anchor.ts && echo 1 || echo 0)" "รีเซ็ตลายน้ำ = ลบไฟล์เต็มด้วย"
chk F2.8 "$(grep -qsE "DiagnosticsExport|audioEvent|recordAudioEvent|'FULL_ANCHOR'|fullAnchor" $src/night/session.ts && echo 1 || echo 0)" "คืนบันทึกว่า cue เล่นไฟล์เต็มหรือถอยระฆัง (diagnostics)"
# สุขภาพ
chk F3.1 "$(cd $m && pnpm -s typecheck >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm typecheck"
chk F3.2 "$(pnpm -s fitness >/dev/null 2>&1 && echo 1 || echo 0)" "pnpm fitness"
chk F3.3 "$(grep -rqsE "[ก-๙]" $src/audio/anchorRemote.ts && echo 0 || echo 1)" "ไม่มีไทยนอก i18n"
chk F3.4 "$(cd $m && NODE_OPTIONS=--max-old-space-size=3584 timeout 500 npx expo export --platform ios --output-dir /tmp/claude-0/l38-ios >/dev/null 2>&1 && echo 1 || echo 0)" "expo export --platform ios ผ่าน (กันซ้ำรอย sql.js)"
echo "L3.8 $pass / $((pass+fail))"; [ $fail -eq 0 ] && st=PASS || st=FAIL
echo "JSON_SUMMARY {\"wo\":\"L3.8\",\"pass\":$pass,\"fail\":$fail,\"status\":\"$st\",\"failed\":\"${notes[*]}\"}"
[ $fail -eq 0 ]

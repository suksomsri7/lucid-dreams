#!/bin/bash
# ข้อสอบ L2.2 — watchOS (3 หน้า · workout · epoch · WCSession · ปุ่มหยุดกดค้าง) + สะพานฝั่งมือถือ (native module LucidWatchLink) — โครงสร้าง (คอมไพล์ Swift ตรวจที่ R1)
root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$root" || exit 2
pass=0; fail=0; notes=()
chk(){ if [ -n "$2" ] && [ -z "${2//1/}" ]; then pass=$((pass+1)); echo "  ✅ $1 $3"; else fail=$((fail+1)); echo "  ❌ $1 $3"; notes+=("$1"); fi; }
w=targets/watch
echo "L2.2 oracle @ $root"
chk W1 "$(grep -rqsE "case ready|case running|case morning" $w && echo 1 || echo 0)" "3 หน้า ready/running/morning"
chk W2 "$(grep -rqsE "HKWorkoutSession" $w && echo 1 || echo 0)" "HKWorkoutSession"
chk W3 "$(grep -rqsE "mindAndBody" $w && echo 1 || echo 0)" "mindAndBody"
chk W4 "$(grep -rqsE "HKLiveWorkoutBuilder" $w && echo 1 || echo 0)" "HKLiveWorkoutBuilder (HR ต่อวินาที)"
chk W5 "$(grep -rqsE "CMMotionManager" $w && echo 1 || echo 0)" "CMMotionManager"
chk W6 "$(grep -rqsE "20\.0|1\.0 ?/ ?20|updateInterval" $w/MotionManager.swift && echo 1 || echo 0)" "accel 20 Hz"
chk W7 "$(grep -rqsE "transferUserInfo" $w && echo 1 || echo 0)" "คิว transferUserInfo เมื่อไม่ reachable"
chk W8 "$(grep -rqsE "hrSd|motion|battery" $w/EpochPayload.swift && echo 1 || echo 0)" "payload {t,hrMean,hrSd,motion,battery}"
chk W9 "$(grep -rqsE "minimumDuration|onLongPressGesture" $w && echo 1 || echo 0)" "ปุ่มหยุดกดค้าง"
chk W10 "$(grep -rqsE "25|220" $w/WorkoutManager.swift && echo 1 || echo 0)" "ทิ้ง HR นอกช่วง"
chk W11 "$(grep -rqsE "DispatchQueue.main|@MainActor" $w/PhoneLink.swift && echo 1 || echo 0)" "@Published บน main"
chk W12 "$(grep -rqsE "WidgetKit|complication|CLKComplication" $w && echo 1 || echo 0)" "complication streak"
chk W13 "$(grep -rqsE "String\(localized|NSLocalizedString|LocalizedStringKey" $w && echo 1 || echo 0)" "สตริงนาฬิกา localizable (หนี้ L1.1)"
chk W14 "$(ls $w/*.lproj/Localizable.strings $w/Localizable.xcstrings 2>/dev/null | wc -l | awk '{print ($1>0)}')" "ไฟล์แปล th/en ของนาฬิกา"
# ฝั่งมือถือ
chk W15 "$(ls apps/mobile/modules/lucid-watch-link/ios/*.swift 2>/dev/null | wc -l | awk '{print ($1>0)}')" "native module LucidWatchLink (Swift) ฝั่ง iPhone"
chk W16 "$(grep -rqsE "WCSession" apps/mobile/modules/lucid-watch-link/ios 2>/dev/null && echo 1 || echo 0)" "iPhone รับ epoch ผ่าน WCSession"
chk W17 "$(grep -rqsE "didReceiveUserInfo" apps/mobile/modules/lucid-watch-link/ios 2>/dev/null && echo 1 || echo 0)" "รับคิว userInfo ย้อนหลัง"
chk W18 "$(grep -rqsE "sendCommand|'stop'|\"stop\"" apps/mobile/src/platform/ios/watchBridge.ts 2>/dev/null && echo 1 || echo 0)" "ส่งคำสั่ง start/stop ไปนาฬิกา"
chk W19 "$(grep -rqsE "normalizeEpochs|SensorEpochSchema" apps/mobile/src/platform/ios/WatchSensorSource.ts && echo 1 || echo 0)" "dedupe/ตรวจสคีมาฝั่งมือถือ (S8)"
chk W20 "$(grep -rqsE "modules/lucid-watch-link|expo-module.config" apps/mobile/modules/lucid-watch-link/expo-module.config.json 2>/dev/null && echo 1 || echo 0)" "expo-module.config.json"
echo; echo "ผล: ผ่าน $pass / $((pass+fail))"; [ $fail -gt 0 ] && echo "ตก: ${notes[*]}"
echo "JSON_SUMMARY {\"wo\":\"L2.2\",\"pass\":$pass,\"fail\":$fail,\"failed\":\"${notes[*]}\"}"; [ $fail = 0 ]

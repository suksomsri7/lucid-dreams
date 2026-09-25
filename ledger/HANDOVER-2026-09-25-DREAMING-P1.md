# HANDOVER — Dreaming iOS Phase 1 (โค้ดครบ 24/24 · รอ R1) — ปิด L3.F 25 ก.ย. 2569 00:30 UTC

## 1. สิ่งที่ส่งมอบ
- repo `github.com/suksomsri7/lucid-dreams` (main) · โฟลเดอร์ `/root/projects/lucid-dreams` · สำรอง bundle บน `gdrive-own:VPS-Archive/lucid-dreams/`
- **apps/mobile** — BLE HR (ble-plx) + มือถือบนที่นอน + SensorHub · Expo SDK 57 · expo-router · Liquid Glass (expo-glass-effect + blur fallback) · 3 แท็บ (คืนนี้=ที่ปรึกษา · บันทึก · ตั้งค่า) · onboarding · แผน → ตรวจอุปกรณ์ 3 หมวด → ทดสอบหูซ้าย/ขวา → เริ่ม · จอกลางคืน · เช้าในห้องเดียวกัน · รายงานเมื่อคืน · i18n TH/EN
- **packages/engine** (TS ล้วน · vitest 130) — ตัวจำลองคืน · onset · REM estimator · nightController + cueGate + Sleep Guard · wake detector · timer mode · signature v2-C + memorization · readiness 3 หมวด · advisor + DreamPlan · BLE parser + SensorHub · AiScore sanitize · bandit/PersonalModel
- **packages/data** (vitest 16) — SQLite 12 ตาราง · export/import/CSV · deleteAll · diagnostics strip sensitive
- **apps/api** (vitest 65) — Hono + SQLite · device token · rate limit · /ai/plan /ai/score /ai/weekly (OpenRouter claude-haiku-4.5 · fallback gemini-3.7-flash) · /ai/tts + /ai/anchor (fal→ElevenLabs Sarah [whispers] + ระฆัง v2-C) · prod: systemd `lucid-api` · https://dreaming.suksomsri.cloud
- **native** (ยังไม่เคยคอมไพล์ — R1): targets/watch (workout · epoch · WCSession · complication) · targets/live-activity · modules lucid-watch-link / lucid-live-activity / lucid-health / lucid-focus · PrivacyInfo · InfoPlist.strings

## 2. ผลตรวจรวม (L3.F)
| ชุด | ผล |
|---|---|
| engine / data / api | 130/130 · 16/16 · 65/65 |
| typecheck · fitness | ผ่าน |
| oracle โครงสร้าง | L1.1 41 · L1.2 32 · L1.3 22 · L1.4 16 · L1.7app 21 · L2.2 20 · L2.8-10 24 · L3ui 33 = ทั้งหมดผ่าน |
| parity ภาพคู่ | 01 02 03 04(a–d) 05a 06(a,b) 07 08 09 ตรง mockup (ดู `.qc-shots/*/parity-*.png`) · ทุกจอ 15 จอ TH+EN จาก main สุดท้าย: `.qc-shots/L3F/sheet-{th,en}.png` |
| pnpm audit | 13 high / 7 moderate — ทั้งหมดใน devDeps ตอน build (`@xmldom/xmldom` ← @bacons/apple-targets · vitest) ไม่ขึ้นเครื่องผู้ใช้ · ติดตามอัป upstream |

## 3. กุญแจ/บริการ (ไม่อยู่ใน repo)
- `apps/api/.env` (600): OPENROUTER_API_KEY · FAL_KEY · AI_MODEL · TTS_VOICE=Sarah · API_DB_PATH=/var/lib/lucid-api/…
- `/root/.lucid/expo.env` (EXPO_TOKEN บัญชี luciddreams-team) · `/root/.lucid/hostinger.env` · `/root/.lucid/fal.env`
- Apple Developer = ทีมเดิม (SiamDive/SHARK/GoodFood) · bundle id `cloud.suksomsri.dreaming` (+ .watch · .live-activity · .watch-complication) · App Group `group.cloud.suksomsri.dreaming`

## 4. หนี้/ข้อจำกัดที่รู้ (เรียงตามความเสี่ยง)
1. Swift ทั้ง 3 target + 4 pod ยังไม่ผ่าน compiler · App Group/HealthKit capability ต้องสร้างใน developer portal ก่อน build
2. ค่าเริ่มต้นเครื่องยนต์ (เกณฑ์ตื่น 0.15 g · F1 ของ REM · onset floor 15 นาที · maxCues 8) ปรับเทียบจากคืนจำลอง — ต้องปรับจากคืนจริง R2
3. ระดับเสียง anchor:bed บนเครื่องจริง · pan ซ้าย/ขวาผ่าน WAV แยกช่อง · Live Activity/DND/HealthKit ต้องเทสจริง
4. complication streak ยังไม่มีใครเรียก setStreakNights · /ai/weekly ยังไม่มีจอเรียก · weekly ควรตัดคืน CONTROL จนครบ 3 คืน
5. Data Protection ตั้งผ่าน entitlement default-data-protection — ตรวจจริงบนเครื่อง

## 5. เริ่ม session ใหม่
อ่าน `ledger/RESUME.md §0` → `ledger/RUN-STATE.json` → `ledger/R1-CHECKLIST.md`

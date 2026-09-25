# R1 — รอบเครื่องจริงครั้งแรก (หลัง L3.F · เจ้าของสั่ง build)

## ก่อน build (Fable)
- [ ] L3.F ปิด: vitest engine/data/api ทั้งชุด · fitness · เรนเดอร์ทุกจอ TH/EN เทียบ mockup 10 ใบ · pnpm audit
- [ ] `apps/mobile/eas.json` โปรไฟล์ `r1-internal` · `EXPO_TOKEN` จาก `/root/.lucid/expo.env` · `ios.appleTeamId` จากเจ้าของ (ทีมเดิม SiamDive/SHARK/GoodFood) · bundle id `cloud.suksomsri.dreaming` จองใน ASC
- [x] (25 ก.ย. 06:30 UTC) แจ้งเจ้าของ "พร้อม build R1" พร้อมรายการที่รวม · **ไม่ยิง eas build เอง**

## ✅ build #4 ขึ้น TestFlight 25 ก.ย. (0.1.0 build 1) — บทเรียนใน RUN-STATE.r1.lessons

## เจ้าของ (ก่อนสั่ง build)
- [x] Team ID = `3DD2VCN6JQ` (SIAM DIVE CENTER COMPANY LIMITED · 25 ก.ย.) ใส่ `eas.json` env + `/root/.lucid/apple.env` แล้ว
- [x] (25 ก.ย.) App ID ใน developer portal: Explicit `cloud.suksomsri.dreaming` · Description "Dreaming" · เปิด HealthKit + App Groups (`group.cloud.suksomsri.dreaming`) + Push Notifications (expo-notifications ใส่ aps-environment ให้เอง) · ตัวลูก `cloud.suksomsri.dreaming.watch` / `.watch.complication` / `.widget` ให้ EAS สร้างเอง (ถ้า EAS ทำไม่ได้ค่อยสร้างมือ)
- [x] (25 ก.ย. · ชื่อจริง "Dreaming - Lucid" · id 6815932557 · key 4MW5TQGCZ7) App Store Connect (ทีมเดิม): สร้างแอป **Dreaming** · bundle id `cloud.suksomsri.dreaming` (+ `cloud.suksomsri.dreaming.watch` · `cloud.suksomsri.dreaming.widget` ให้ EAS สร้าง provisioning เอง) · ส่ง Team ID + ASC API key (.p8 · Key ID · Issuer ID) ให้ Fable
- [ ] ยืนยันรุ่นเครื่อง: iPhone (iOS 26 เพื่อเห็น glass) · Apple Watch · หูฟังที่จะใส่นอน

## สิ่งที่ต้องยืนยันบนเครื่องจริง (Linux ตรวจไม่ได้) — ผลส่งกลับเป็น diagnostics.json + ภาพหน้าจอ
1. **Swift คอมไพล์ผ่าน** (targets/watch · modules lucid-watch-link / lucid-live-activity / lucid-health) — ถ้าตก EAS log จะบอก ไฟล์/บรรทัด
2. **นาฬิกา**: workout session ทั้งคืน · แบตต้น/ปลาย · epoch ต่อเนื่อง % (Diagnostics) · ปุ่มหยุดกดค้าง · complication
3. **เสียง**: เสียงพื้น 8 ชม. ไม่ถูกฆ่า · รับสายกลางคืนแล้วกลับมาเล่นต่อ · หูฟัง BT อยู่ทั้งคืน · ระดับเสียงสมอ 15% ได้ยินไหม/ปลุกไหม · ทดสอบหูซ้าย/ขวา pan ถูกข้าง · ลายน้ำเต็มจาก /ai/anchor เล่นได้
4. **Liquid Glass จริง** (แถว "กระจกของจริง" = ใช่) · Live Activity ขึ้นบนล็อกสกรีน + ปุ่มหยุดใช้ได้
5. **HealthKit**: ขอสิทธิ์ · อ่านสเตจ Apple ตอนเช้า · รายงานแสดงเส้น REM ของ Apple
6. **ที่ปรึกษา**: พูดด้วยเสียง (Apple Speech) · แผนจาก haiku-4.5 · เริ่มคืน · เช้าเล่าฝัน · คะแนน AI
7. **แจ้งเตือน** reality check กลางวัน + ปุ่ม ทำแล้ว/ไว้ก่อน
8. **Data Protection** ไฟล์ DB (ตรวจด้วย Xcode/ls -lO ถ้ามี Mac) · InfoPlist.strings ไทยขึ้นตอนขอสิทธิ์เมื่อเครื่องเป็นไทย

## หลัง R1 (Fable)
- อ่าน diagnostics: แบตนาฬิกา (< 30% ตอนเช้า ⇒ ลด accel เป็น 10 Hz หรือดัน BLE เป็นทางหลัก) · epoch ต่อเนื่อง · audio drop · ระดับเสียงที่ได้ยิน → ตัดสินสแต็ก + ค่าเริ่มต้น · เพิ่มคืนจริงเป็น fixture ให้ L2.5/L2.6 ปรับเทียบ

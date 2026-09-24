# ข้อสอบ L1.8 — ชั้นข้อมูล (สัญญาที่ builder ต้องทำให้ผ่าน · Fable เขียนก่อน)
โครง: `packages/data` = TS ล้วน + interface `DbDriver { exec(sql, params?): Promise<void>; all<T>(sql, params?): Promise<T[]>; run(sql, params?): Promise<{changes:number}>; transaction<T>(fn): Promise<T> }`
- adapter `sqljs` (dev/test บน VPS · wasm) · adapter `expo-sqlite` อยู่ใน `apps/mobile/src/platform/ios|android/` (ห้ามอยู่ใน packages/data)
- ข้อสอบ = `packages/data/test/*.test.ts` (vitest · ใช้ sqljs) — Fable จะเขียนไฟล์ทดสอบจากรายการนี้หลัง L1.1 merge (ต้องมี paths จริง) · builder ห้ามแก้ test
รายการข้อ (22):
D1 migration ขึ้นครบ 12 ตาราง (UserProfile Theme NightSession SensorEpoch CueEvent WakeEvent AppleSleepPhase MorningReport AiScore RealityCheck PersonalModel EarTest) · D2 รัน migrate ซ้ำ = idempotent · D3 schemaVersion บันทึก
D4 repo: createSession/appendEpoch/appendCue/appendWake/finishSession · D5 CueEvent.response enum WOKE/NONE/HEARD_IN_DREAM/LUCID + played bool · D6 EarTest 2 แถวต่อคืน (L/R) unique(sessionId, side)
D7 MorningReport ฟิลด์ null ได้ทุกช่องยกเว้น sessionId · D8 query ประจำ: nightReport(sessionId) รวมทุกตารางถูกลำดับเวลา · D9 lastNights(n) เรียงล่าสุด · D10 stats(30): lucidRate cue vs control · themeMatchAvg · nights
D11 export JSON ทั้งหมด → import กลับ = เท่าเดิม (deep equal) · D12 export CSV ต่อตาราง header ถูก · D13 deleteAll → ทุกตารางว่าง + schemaVersion คง · D14 diagnostics export: ค่าเริ่มต้นไม่มี transcript/audioPath · เปิดสวิตช์จึงมี
D15 เวลาเก็บเป็น ISO UTC · แสดงตามโซนเครื่อง (helper) · D16 ห้ามเขียนไฟล์เสียงลง DB (path เท่านั้น) · D17 sensitive fields รายชื่อประกาศใน `sensitive.ts` (transcript audioPath aiSummary) · D18 index บน (sessionId,t) ของ SensorEpoch
D19 transaction rollback เมื่อ error · D20 ไม่มี SQL string concat ของค่าผู้ใช้ (grep) · D21 fitness: packages/data ไม่ import RN/expo · D22 ขนาด epoch 8 ชม. (960 แถว) insert < 2 วิ บน sqljs

# RESUME — Lucid Dreams

## §0 สถานะล่าสุด
- 2026-09-25 03:00 UTC · 🎨 ไอคอนรอบ 4 เจ้าของขอไอเดีย **Zzz** → J สาม Z ไต่ขึ้น · K Z เดี่ยว · L พื้นค่ำ Z จาง (`design-icon/icons-zzz.html`) รอเลือก
- 2026-09-25 02:30 UTC · 🎨 ไอคอนรอบ 3 (เจ้าของบอกรอบ 2 เปลี่ยนแค่สี ขอ **มินิมอล คลีน**) → G สองเลนส์ · H หน้ากากซูม · I วงหน้าสวมหน้ากาก (`design-icon/icons-mask2.html`) รอเลือก · บทเรียน: แต่ละแบบต้องต่างที่โครง ไม่ใช่สี
- 2026-09-25 02:00 UTC · 🎨 เจ้าของสั่ง **ไอคอนใหม่ minimal แบบหน้ากากปิดตา** → ทำ 3 แบบ D/E/F (`design-icon/icons-mask.html` · TG 3506–3509) รอเลือก · A/B/C รอบแรกตกไป
- 2026-09-25 01:30 UTC · 🎨 **ไอคอนแอป 3 แบบส่งแล้ว** (`ledger/design-icon/` A พระจันทร์เสี้ยว · B ตาหลับ · C ทรงกลมกระซิบ · TG 3499–3503) · รอเจ้าของเลือก → ทำชุดไอคอน iOS เต็ม (1024 + watch + adaptive) + `app.config icon` · ยังรอ R1 (ASC app + Team ID + ASC key) และยืนยันเสียง anchor (TG 3478) · ⚠️ TG 3504 "--inbox" = ข้อความหลุดจากคำสั่ง ไม่ใช่ข้อความถึงเจ้าของ
- 2026-09-25 00:30 UTC · 🏁 **โค้ด Phase 1 ครบ 24/24 · L3.F ปิดแล้ว** (ทุกชุดเขียว · 15 จอ TH/EN) · handover `HANDOVER-2026-09-25-DREAMING-P1.md` · **ตอนนี้ = รอ R1** ดู `R1-CHECKLIST.md`: เจ้าของสร้างแอป Dreaming ใน ASC + ส่ง Team ID/ASC key → Fable ใส่ `EXPO_APPLE_TEAM_ID` + eas credentials → แจ้งพร้อม → เจ้าของสั่ง `eas build --profile r1-internal` (Fable ห้ามยิงเอง) · session ใหม่เริ่มที่นี่ได้เลย
- 2026-09-24 รอบ 16 · merge 16/24 · กำลังทำ **L2.2n native (Opus) ‖ L3.2s /ai/score (Opus) ‖ L3ui = L3.3/3.4app/3.5/3.6 (Sonnet)** = ชุดสุดท้ายก่อน L3.F/R1 · เตรียม `apps/mobile/eas.json` (r1-internal/testflight) + `ledger/R1-CHECKLIST.md` แล้ว · 🔴 บทเรียน: autosave timer push main แข่งกับ Fable push ได้ (remote rejected ชั่วคราว) → ถ้า push โดน reject ให้ `git fetch` แล้วเทียบก่อน ห้าม force
- 2026-09-24 รอบ 15 (เย็น) · **ชื่อแอป = Dreaming** (โค้ด+เอกสาร+โดเมนเปลี่ยนแล้ว) · merge แล้ว **15/24** (L1.1 L1.8 L1.2 L2.1 L1.6e L1.3 L1.5 L1.5b L1.4 L2.4/2.5 L2.6/2.7 L1.7ui L3e L1.6s L2.8ui) · กำลังทำ **L2.2n native** (Opus) ‖ **L3.1 เช้า** (Sonnet) · เหลือ: L2.3 app BLE · L3.2 server /ai/score · L3.3 · L3.4 app · L3.5 · L3.6 · L3.F → R1 · เซิร์ฟเวอร์ prod ครบ: https://dreaming.suksomsri.cloud (OpenRouter haiku-4.5 · TTS fal Sarah · anchor v2-C) · เสียงลายน้ำสุดท้ายรอเจ้าของฟังยืนยัน (TG 3478) · Hostinger token ใหม่ /root/.lucid/hostinger.env
- 2026-09-24 รอบ 14 · merge แล้ว 7/24 (L1.1 L1.8 L1.2 L2.1 L1.6e L1.3 L1.5) · กำลังทำ L1.4 (Sonnet) ‖ L2.4/2.5 (Opus) · **เซิร์ฟเวอร์ AI รันแล้วบน VPS** `systemd lucid-api` (127.0.0.1:8787 · โหมด mock · .env ที่ apps/api/.env chmod 600) · nginx site `lucid-api` (HTTP · รอ DNS) · 🔴 รอเจ้าของ: DNS A record `lucid` → 72.62.196.201 · OpenRouter key · เลือก TTS
- 2026-09-24 รอบ 13 · ✅ **L1.1 merged main** (SDK 57 · oracle 41/41) · ▶ เริ่ม **L1.2 (Sonnet UI)** ‖ **L1.8 (Opus data)** ขนาน (worktree lucid-dreams-L1.2 / -L1.8) · หนี้จาก L1.1: permission strings EN only + PrivacyInfo (L1.3/L3.6) · ภาษาเริ่มต้นฮาร์ดโค้ด th (L1.2) · สตริงนาฬิกา EN (L2.2) · platform บนเว็บรายงาน 'android' ควรเป็น 'web' (L1.2) · WCSession bridge ฝั่งมือถือ = stub (L2.2)
- 2026-09-24 รอบ 12 · ✅ Expo token (`luciddreams-team`) เก็บ `/root/.lucid/expo.env` · Apple Dev = ทีมเดิม · AI = OpenRouter (key ให้ตอน L1.5 — **ต้องแจ้งเจ้าของเมื่อถึง**) · L1.1 กำลังสร้าง (Opus)
- 2026-09-24 รอบ 11 · ✅ **มติครบ** (ชื่อ Lucid Dream · TestFlight ให้เจ้าของ · คืนควบคุมตามแนะนำ · เสียงสมอ=ลายน้ำ 1 เสียง/ภาษา · Claude key แยก · Apple Dev เปิดใหม่ · Boost ปิด · Android เลื่อนแต่โค้ดรองรับ · ทดสอบเสียงแยกซ้าย/ขวา · ระดับเสียงผู้ใช้=เริ่มต้นเท่านั้น) · repo `github.com/suksomsri7/lucid-dreams` push แล้ว · **▶ เริ่ม RUN L1.1** (ดู `APP-RUN.md §3.1` + `RUN-STATE.json`) · รอเจ้าของ: สมัคร Apple Dev/Expo (APP-RUN §7) + Claude key
- 2026-09-24 รอบ 10 · UX: แยกหน้าตรวจอุปกรณ์ (3 หมวด ชีพจร/เสียง/ดวงตา · แอปบอกว่าพบอะไร) กับหน้าทดสอบเสียง (ถูกแล้วเริ่ม) · ยังไม่ซื้อ Polar · ภาพ 01/04/09 วาดใหม่+ส่ง TG แล้ว · **รอเจ้าของตอบคำถามเคาะ (แชท 24 ก.ย.) → เริ่ม L1.1**
- 2026-09-24 รอบ 9 · ✍️ **แผน RUN เขียนแล้ว `ledger/APP-RUN.md`** (24 WO · Fable คุม/QC/ความปลอดภัย · Opus=engine/Swift/BLE/AI · Sonnet=UI · Haiku=งานกล · ผู้ตรวจอิสระ 8 ใบ · ทนต่อ session ตาย §0.6 · รอบเครื่องจริง R1–R3) · `RUN-STATE.json` = not-started · **สถานะ = รอเจ้าของตอบ APP-RUN §0.3 (repo/Apple/Claude key) + DESIGN §10**
- 2026-09-24 รอบ 8 · เจ้าของแก้ UX 3 ข้อ: (04) ก่อนเริ่มเล่นเสียงสมอสุ่มรอบ ถาม "ได้ยินกี่รอบ" + ตรวจอุปกรณ์ครบก่อนกดเริ่ม · (06) เช้าเลือกพูด/พิมพ์ · เอกสารแก้แล้ว (3219427) · ✅ 04/06 วาดใหม่+ส่ง TG แล้ว · สถานะ = รอเจ้าของตอบ §10 (9 ข้อ)
- 2026-09-24 รอบ 7 · ✅ **ภาพ v2 Liquid Glass 10 ใบตรวจแล้ว ส่ง Telegram แล้ว** พร้อมคำถามเคาะ 9 ข้อ (DESIGN-APP §10) · **สถานะ = รอเจ้าของตอบ §10 → เขียนใบงาน 24 WO (`ledger/APP-RUN.md`) → RUN**
- 2026-09-24 รอบ 6 · เจ้าของสั่ง **UI สไตล์ Liquid Glass** → `_base.part` เป็นกระจกฝ้า+แท็บแคปซูลลอย (b581632) · วาดใหม่ 10 ใบ (Opus 2 ตัว) · สแต็ก: `expo-glass-effect` (iOS 26) ถอยเป็น `expo-blur`
- 2026-09-24 รอบ 5 · เจ้าของสั่ง **แก้แบบใหม่**: ธีมขาว สะอาด ใช้ง่ายที่สุด · หน้าแรก = ที่ปรึกษาความฝัน (บอก → สรุป → เริ่ม) · DESIGN-APP §2–§4 เขียนใหม่ (v2) · ภาพ v1 มืด 13 ใบ → `design-app-v1-dark/` · กำลังวาด v2 10 ใบ (Opus 2 ตัว) → Fable ตรวจ → Telegram
- 2026-09-24 รอบ 4 · เจ้าของสั่ง **ออกแบบแอป iOS** → `DESIGN-APP.md` (22 WO · 3 ระยะ · คำถามเคาะ 8 ข้อ §10) + ภาพ 12 ใบ `design-app/` (Opus 2 ตัววาด · Fable ตรวจทุกภาพก่อนส่ง Telegram) · สถานะ = กำลังวาด/ตรวจภาพ
- 2026-09-24 รอบ 3 · EOG เลื่อน · ยืนยันทดสอบด้วย Watch+หูฟัง BT · เสนอ Week 0 ทดลองมือ + Sprint 1–2 (§1.5)
- 2026-09-24 รอบ 2 · ภาคผนวก A–F (Dream Theme=เมล็ด · WBTB ปิด · ambience · อุปกรณ์ EOG · สแต็ก hybrid)
- 2026-09-24 · ตั้งโปรเจกต์ · เขียนบทวิเคราะห์แนวคิด `CONCEPT-ANALYSIS-2026-09-24.md`
- ยังไม่มีโค้ด · ยังไม่ออกแบบ UI · รอเจ้าของอ่านบทวิเคราะห์แล้วเคาะขอบเขต Phase 1

## §1 ข้อเคาะ (อัปเดต 24 ก.ย. รอบ 2)
1. ✅ ตกไป — เหลือ flow เดียว: ธีม=เมล็ด · เสียงสมอ=สัญญาณรู้ตัว (ภาคผนวก A)
2. ⏳ รอเจ้าของยืนยัน: Hybrid Expo + watchOS Swift target ผ่าน EAS (ภาคผนวก F) · เริ่มพิสูจน์ทฤษฎีด้วย ZMax+Dreamento คู่กัน
3. ✅ หูฟังบลูทูธ (ต้องรุ่นแบตทั้งคืน)
4. ✅ UI ไทย+อังกฤษ · เสียงสมอเลือก 1 ภาษาต่อคน
5. ⏸ EOG **เลื่อนไปอนาคต** (เจ้าของสั่ง 24 ก.ย.) · Phase 1 ทดสอบด้วย Apple Watch + หูฟังบลูทูธเท่านั้น · ground truth = สเตจ Apple ตอนเช้า + รายงานตัวเอง
6. WBTB ปิดเป็นค่าเริ่มต้น ("Boost night") · ambience กล่อมนอนมี (ภาคผนวก B, C)

## §1.5 แผนทดสอบโดยไม่ต้องรอ EOG (เสนอ 24 ก.ย.)
- **Week 0 — ทดลองมือ 7 คืน ไม่เขียนโค้ด**: อัดเสียงสมอ 1 ประโยค · ฝึก 5 นาทีก่อนนอน · ใช้ Shortcuts automation เล่นเสียงเบามากผ่านหูฟังที่ +4.5 / +6 / +7.5 ชม. หลังเข้านอน · เช้าเช็ก 3 อย่าง: ตื่นไหม · จำได้ว่าได้ยินไหม · เวลาที่เล่นตกช่วง REM ของ Apple Sleep ไหม · ตอบ 4 คำถาม
- **Sprint 1 — Night Session ขั้นต่ำ**: แอปนาฬิกา Swift เปิด workout session สตรีม HR/accel ทั้งคืน + บันทึกลงไฟล์ (วัดแบตคืนแรก) · แอปมือถือเล่น ambience + cue ตามเวลา + gate ไม่ยิงถ้าเพิ่งขยับ/HR พุ่ง · หยุดเมื่อตื่น · Morning Recall เสียง→ข้อความ
- **Sprint 2**: REM probability จากข้อมูลจริงที่เก็บ เทียบสเตจ Apple · adaptive volume · คืนควบคุม · แดชบอร์ด

## §2 ขั้นถัดไป (หลังเคาะ) — ทำตาม `APP-RUN.md §6`
- เขียน `ledger/APP-RUN.md` (สัญญา+ข้อสอบต่อ WO · L1.1 spike ก่อน) แบบ KANBAN-RUN/MEMBER-RUN
- ตั้งโปรเจกต์ Expo + watchOS target + expo-glass-effect · ทดสอบ L1.1 บนเครื่องเจ้าของ
- ออกแบบหน้าจอ (ภาพ mockup) ตามหมวด: Onboarding/Training · Night Session · Morning Recall · Journal/Insights · Settings
- ออกแบบ data model + ตัวประเมิน REM probability + ตัวควบคุม cue (state machine)

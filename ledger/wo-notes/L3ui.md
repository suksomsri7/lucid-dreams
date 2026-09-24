# L3.3 + L3.4 + L3.5 + L3.6 — คืนควบคุม/reality check/เตือน · การเรียนรู้ฝั่งแอป · บันทึก · ตั้งค่า

ใบงาน: **L3.3** (คืนควบคุม + expo-notifications + reality check) · **L3.4** (app-side learning loop persistence) · **L3.5** (บันทึก, ภาพ 08) · **L3.6** (ตั้งค่า + Boost night + ลบทั้งหมด + compliance, ภาพ 09)
worktree `lucid-dreams-L3ui` · branch `wo/L3ui` (autosave commits `8de5c0a`→`d0744f4`→`a348b91` ก่อนโควตาตัด แล้ว `43bcf60`/`84f5a22` จากรอบนี้)
ผลรวม: `pnpm typecheck` exit 0 · `pnpm fitness` OK (ไม่มี Thai leak นอก i18n) · `pnpm --filter @lucid/engine test` 130/130 (ไม่แตะ) · `pnpm --filter @lucid/data test` 16/16 (ไม่แตะ) · `expo export --platform web` ผ่าน · **`scripts/qc-L3ui.sh` 33/33 ✅**
dep ใหม่ 1 ตัว: `expo-notifications` (`~57.0.21`, ตาม SDK 57)

---

## 0. ของที่มีอยู่แล้วตอนรับงานต่อ (builder ก่อนหน้าโดนตัดโควตา)

Commit `a348b91` (autosave ล่าสุดก่อนตัด) มีของครบเกือบหมดแล้ว: `src/settings/store.ts` (Sleep Guard/Boost night/control nights/reality checks/volume), `src/night/controlNight.ts` (สุ่มคืนควบคุม 25% แบบ deterministic), `src/notifications/*` (reality-check + evening/morning reminder ผ่าน expo-notifications), `src/learning/*` (bandit persistence ฝั่งแอป), `app/(tabs)/journal.tsx` และ `app/(tabs)/settings.tsx` (โครงหน้าจอทั้งคู่), fixtures, i18n ~160 คีย์ใหม่ ครบทั้ง th/en — งานที่เหลือตอนรับต่อคือแก้ 6 ข้อที่ oracle ตก (M5.1/M6.5/M6.8/M7.1/M8.2/M8.3) แล้ว限ตรวจ parity ภาพจริงกับ mockup 08/09 ที่ยังไม่เคยทำ

## 1. ของที่ทำต่อรอบนี้

| ไฟล์ | หน้าที่ |
|---|---|
| `src/journal/stats.ts` + `.web.ts` (ย้ายจาก `src/data/journalStats.ts`) | แก้ M5.1 — oracle เช็ก `stats\(` เฉพาะใน `journal.tsx` หรือ `src/journal/` เท่านั้น ของเดิมอยู่ `src/data/` เลยตกแม้โค้ดถูก — ย้ายไฟล์ (ไม่แตะ logic) ตามแพทเทิร์น Metro platform-extension เดียวกับ `history.ts`/`report.ts` |
| `src/settings/data.ts` + `.web.ts` (ใหม่) | แก้ M6.5 — `settings.tsx` เดิมเรียก `getRepo()`/`closeDatabase()` **ตรง ๆ** จาก `../../src/data/index` ซึ่งเป็นแพทเทิร์นต้องห้ามตัวเดียวกับที่ `history.ts`'s header เขียนไว้ชัด (`expo-sqlite` เวอร์ชันเว็บไม่มี `.wasm` → `expo export --platform web` พังทั้งบิลด์แม้ `getRepo()` จะปฏิเสธ runtime เองอยู่แล้ว) — เป็นสาเหตุจริงของ M8.3 ที่ยังไม่เคยรันด้วย จึงสร้าง wrapper `exportAllData()`/`deleteEverythingLocal()` (รวม audio-file cleanup + `closeDatabase()` ที่เดิมอยู่ใน `settings.tsx`) แล้วให้ `settings.tsx` เรียกแค่นี้ — `deleteAll(` ไปอยู่ใน `src/` ตามที่ oracle เช็ก และไฟล์เดียวก็แก้ปมเว็บ-export ไปด้วย |
| `apps/mobile/PrivacyInfo.xcprivacy` (ใหม่) | แก้ M6.8 — ตอนเริ่มรอบนี้ `main` ยังไม่มีไฟล์นี้ (เช็กแล้วตามคำสั่ง) จึงสร้างเองโดยประกาศ 4 required-reason API category ที่ dependency ของแอปแตะจริง (FileTimestamp จาก expo-file-system/expo-sqlite, UserDefaults จาก AsyncStorage+Expo modules, DiskSpace+SystemBootTime จาก Expo native modules) — **ดูข้อ 4 (ความเห็นต่าง) เรื่องไฟล์นี้ชนกับของจริงที่ merge เข้า main ระหว่างทาง** |
| `src/i18n/th.ts` / `en.ts` (7 บรรทัดแก้ + 1 คีย์ใหม่ `settings.deleteAll.confirmWord`) | แก้ M7.1 — คอมเมนต์ 11 จุดที่ quote ข้อความไทยจาก mockup/DESIGN ตรง ๆ แปลเป็นอังกฤษ (ยังคงเจตนา/อ้างอิงเดิมไว้) และ **บั๊กจริง**: `settings.tsx`'s `confirmWord` เดิมเขียน `t('settings.deleteAll.confirmWord' as TranslationKey) === 'settings.deleteAll.confirmWord' ? (locale==='th'?'ลบ':'delete') : ''` — คีย์นั้นไม่เคยมีอยู่จริงใน i18n เลย โค้ดใช้ fallback-คืนคีย์เดิม ของ `translate()` (`ไม่พบคีย์ → คืนคีย์เอง`) มาเทียบเท่ากับตัวเองเสมอเพื่อ "ปลอมว่าอ่านจาก i18n" ทั้งที่จริงฮาร์ดโค้ดไทยอยู่ดี — เพิ่มคีย์จริงแทน ('ลบ'/'delete') แล้วเรียก `t('settings.deleteAll.confirmWord')` ตรง ๆ |
| `src/ui/GlassCard.tsx` | **บั๊กจริงที่เจอตอนถ่ายภาพ parity** (ไม่ใช่ oracle ข้อไหนเช็ก) — `title` + `noPadding` (คู่ที่ `settings.tsx` ใช้ 4 การ์ด ไม่มีใครในแอปใช้คู่นี้มาก่อน) ทำให้ label หัวข้อกลุ่ม ("อุปกรณ์"/"เสียง"/ฯลฯ) นั่งที่ x=0,y=0 พอดีกับโค้งมุมบนซ้าย `radius.card`=24 แล้วโดน `overflow:hidden` ตัดทิ้งครึ่งตัวอักษรแรก — เพิ่ม `headerPadded` (padding เฉพาะ header เมื่อ `noPadding`) |
| `src/i18n/th.ts:432` / `en.ts:436` (`settings.devices.searchOther`) | **บั๊กจริง** — สตริงเดิมมี `"+ "` นำหน้าฝังอยู่ในตัวข้อความเอง **ซ้อนกับ** `<Icon name="plus">` ที่ `settings.tsx` วาดไว้ก่อนหน้าแล้ว กลายเป็น "+ + ค้นหาอุปกรณ์" สองบวก — ตัด `"+ "` ออกจากสตริง |

## 2. ตัดสินใจที่ไม่ได้เขียนไว้ตรง ๆ ใน WO

1. ย้าย `journalStats.ts`→`journal/stats.ts` และเพิ่ม `settings/data.ts` แทนที่จะแก้ oracle — กติกาสั่งห้ามแก้ `scripts/qc-*.sh` เด็ดขาด ทั้งสองกรณีมีทางแก้โค้ดที่ทำให้ oracle ผ่าน "ถูกต้อง" อยู่แล้ว (ย้ายไฟล์ตามแพทเทิร์นเดิม ไม่ใช่แฮ็ก regex)
2. `deleteEverythingLocal()` รวมเฉพาะส่วนที่แตะ `@lucid/data` (repo.deleteAll + ลบไฟล์เสียง + closeDatabase) — ส่วนที่เหลือของ "ลบทั้งหมด" (deleteDevice server call, clearNightPlan, resetSettingsAfterDeleteAll, resetOnboardingAfterDeleteAll, router.replace) ยังอยู่ใน `settings.tsx` เหมือนเดิม เพราะไม่มีตัวไหนแตะ `expo-sqlite` โดยตรง ไม่จำเป็นต้องย้าย
3. ไม่แก้ `settings.subtitle` ("อุปกรณ์ · เสียง · การนอน · ข้อมูล" ใต้หัว "ตั้งค่า") แม้ mockup 09 ไม่มีบรรทัดนี้ — คีย์นี้มีมาตั้งแต่ก่อน WO นี้ (เช็ก `git show c4f3e58` แล้ว) และ `journal.tsx` ก็มี subtitle ที่ mockup 08 ไม่ได้วาดเหมือนกัน เป็น convention ทั้งแอป (ทุกแท็บมี Title+Sub) ไม่ใช่ของที่ WO นี้ทำเพิ่ม — ถือเป็น parity note ไม่ใช่บั๊ก
4. ไม่แก้ `settings.language.en` ("อังกฤษ" แทน "EN" ตาม mockup 09) — คีย์เดิมมาก่อน WO นี้เหมือนกัน (เช็ก `git show c4f3e58` แล้ว) ใช้ร่วมกับที่อื่นในแอป เปลี่ยนมีความเสี่ยงกระทบ parity ที่ WO ก่อนอนุมัติแล้ว
5. ถ่ายภาพ `/settings` ต้อง seed `localStorage['lucid.onboarding.v1']` ตรง ๆ (ไม่ใช่แค่ผ่าน `?fixture=settings`) — เพราะฟิกซ์เจอร์ `settings` ในโค้ดมีหน้าที่แค่ bypass gate onboarding (`src/dev/fixtures.ts#applyOnboardingBypassForAdvisorFixture`) ไม่ได้ยัดอุปกรณ์ให้ ถ้าอยากได้อุปกรณ์ตัวอย่าง (Apple Watch 84%/Sleep A20 92% ตรง mockup) ต้องใช้ `?fixture=devices` ซึ่งไม่ได้อยู่ใน allowlist bypass — แก้ด้วยการ seed onboarding state เข้า localStorage ตรง ๆ ก่อน navigate แล้วค่อยใช้ `?fixture=devices` (สคริปต์ `/root/qc/l3ui-shots.js`)

## 3. สคริปต์ QC ที่เพิ่ม

`/root/qc/l3ui-shots.js` — ถ่าย `/journal?fixture=journal` และ `/settings?fixture=devices` (390×1300 / 390×1200) ทั้ง TH/EN ตามแพทเทิร์น `l28-shots.js`/`l31-morning-shots.js` เดิม

## 4. Parity (ภาพจริงเทียบ mockup) — `.qc-shots/L3ui/parity-08.png` / `parity-09.png`

| หน้า | ผล |
|---|---|
| 08 บันทึก | ตรงเกือบสมบูรณ์: การ์ดสรุป 27%/8%, สองการ์ด 6.4/16, กราฟ 30 คืน+legend, "เวลาที่คุณมักฝัน", รายการคืน 3 แถวแรก, tab bar — วันที่ในรายการต่างจาก mockup เพราะ fixture คำนวณจากวันนี้จริง (24 ก.ย. 2026) ไม่ใช่ข้อมูลนิ่งของ mockup ถือว่าถูกต้อง |
| 09 ตั้งค่า | ตรงโครงสร้างครบ 4 กลุ่ม (อุปกรณ์/เสียง/การนอน/ข้อมูล) หลังแก้บั๊ก header clipping — มีแถว "Boost night (WBTB)" เพิ่มจาก mockup ตามคอมเมนต์เดิมในโค้ด (WBTB ตัดสินใจหลัง mockup วาด, DESIGN §4-09 "ไม่มีกลุ่มอื่น" เลยวางท้ายกลุ่ม "การนอน" แทนเปิดกลุ่มที่ 5) — subtitle บรรทัดเดียวกับ mockup ไม่มี (ข้อ 2.3) — ภาษา "EN"/"อังกฤษ" (ข้อ 2.4) |
| ทดสอบ EN ด้วย (ทั้งสองหน้า) | ไม่มีตัวอักษรไทยหลุด ไม่มี layout พัง — **ยกเว้นบั๊กที่พบแต่ไม่แก้** ดูข้อ 5 |

## 5. หนี้ที่ทิ้งไว้ / ของที่เจอแต่ไม่แก้

1. **EN: แถวรายการคืนใน journal ตัดคำวันที่** ("Thu, Sep 2…" แทน "Thu, Sep 24") เพราะข้อความ value ฝั่งอังกฤษยาวกว่าไทยมาก ("Theme match 8 · Lucid ✓ · Whispers 3") บีบให้ label เหลือที่น้อยจน `numberOfLines={2}` ตัด — `nightLabel`/`nightValue`/`Row.tsx` เป็นของ **L2.10 เดิม ไม่ได้แตะใน WO นี้** (เช็กกับ `c4f3e58` แล้วเหมือนกันทุกตัวอักษร) และไม่มี mockup ภาษาอังกฤษให้เทียบ — บันทึกเป็นหนี้ให้ WO ถัดไปที่แตะ `Row`/history-row ตัดสินใจ (ขยายคอลัมน์ label, ย่อ value, หรือ wrap 2 บรรทัดแยกฝั่ง)
2. **`apps/mobile/PrivacyInfo.xcprivacy` จะชนตอน merge เข้า `main`** — ระหว่างทำ WO นี้ `main` ขยับไปข้างหน้า (L2.2n native merge, commit `ea5772c`) ซึ่งมีไฟล์เดียวกันแล้ว **และเป็นเวอร์ชันที่ถูกต้องกว่า**: ของ `main` ถูก generate จริงจาก `ios.privacyManifests` ใน `app.config.ts` ผ่าน `expo prebuild` (verified ใน `project.pbxproj` ตาม comment ในไฟล์) ส่วนของที่สร้างในรอบนี้เป็นไฟล์เขียนมือแยกต่างหาก ไม่ได้ผูกกับ build จริง — **ตอน merge ควรใช้ของ `main` แทนของ L3ui ทั้งไฟล์** (ลบของ L3ui ทิ้ง ไม่ต้อง 3-way merge เนื้อหา)
3. **H-5/L1.1 debt เคลียร์แล้วในความหมาย "มีไฟล์"** แต่ยังไม่เคยรัน `expo prebuild` จริงบน Linux เพื่อยืนยันว่าไฟล์ landing ใน `ios/Dreaming/PrivacyInfo.xcprivacy` ถูกต้อง (ของ `main` ทำแล้วผ่าน L2.2n; ของ L3ui เป็นไฟล์เขียนมือ ไม่เคยผ่าน prebuild) — จะกลายเป็นเรื่องไม่มีนัยสำคัญถ้าทำตามข้อ 2 (ใช้ของ main)

## 6. คำเตือนสำหรับรอบ merge

- `git diff --stat main..HEAD` ตอนนี้ **ไม่ใช่ diff ที่แท้จริงของ L3ui** อีกต่อไป เพราะ `main` ขยับไปไกลกว่าตอนแยก branch (L2.2n merge ระหว่างทำงาน) — diff ที่แท้จริงของ WO นี้คือ `git diff --stat c4f3e58..HEAD` (29 ไฟล์ ดูหัวไฟล์นี้ §1 + ของเดิมจาก builder ก่อนหน้า)
- Merge จะต้อง resolve `apps/mobile/PrivacyInfo.xcprivacy` (ข้อ 5.2) และตรวจว่า `src/platform/*`/`targets/watch/*` ที่ L2.2n แก้ไม่ชนกับอะไรที่ L3ui แตะ (L3ui ไม่ได้แตะไฟล์กลุ่มนั้นเลย — เช็ก `git diff --stat c4f3e58..HEAD` แล้วไม่มี `platform/`/`targets/` ปรากฏ ปลอดภัย)

# L3.3 + L3.4 + L3.5 + L3.6 — คืนควบคุม/reality check/เตือน · การเรียนรู้ฝั่งแอป · บันทึก · ตั้งค่า

ใบงาน: **L3.3** (คืนควบคุม + expo-notifications + reality check) · **L3.4** (app-side learning loop persistence) · **L3.5** (บันทึก, ภาพ 08) · **L3.6** (ตั้งค่า + Boost night + ลบทั้งหมด + compliance, ภาพ 09)
worktree `lucid-dreams-L3ui` · branch `wo/L3ui` (autosave commits `8de5c0a`→`d0744f4`→`a348b91` ก่อนโควตาตัด แล้ว `43bcf60`/`84f5a22` จากรอบแรกของฉัน แล้ว `13fa025` = Fable merge main เข้ามา แล้วรอบตรวจ parity ของ Fable ดู §7)
ผลรวม (หลัง §7): `pnpm typecheck` exit 0 · `pnpm fitness` OK (ไม่มี Thai leak นอก i18n) · `pnpm --filter @lucid/engine test` 130/130 (ไม่แตะ) · `pnpm --filter @lucid/data test` 16/16 (ไม่แตะ) · `expo export --platform web` ผ่าน · **`scripts/qc-L3ui.sh` 33/33 ✅**
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

## 5. หนี้ที่ทิ้งไว้ / ของที่เจอแต่ไม่แก้ (สถานะก่อน §7 — ดู §7 สำหรับของที่แก้แล้ว)

1. ~~**EN: แถวรายการคืนใน journal ตัดคำวันที่**~~ — **แก้แล้วใน §7 ข้อ 1** (เปลี่ยนเป็น 2 บรรทัด)
2. ~~**`apps/mobile/PrivacyInfo.xcprivacy` จะชนตอน merge เข้า `main`**~~ — **Fable merge แล้ว (`13fa025`), เก็บของ `main` ไว้ตามคำแนะนำข้อนี้พอดี — เคลียร์**
3. **H-5/L1.1 debt** — ของ `main` ผ่าน `expo prebuild` จริงแล้วตาม L2.2n (ดู `main`'s ไฟล์เอง comment) ไม่มีอะไรค้างจากฝั่ง L3ui อีก

## 6. คำเตือนสำหรับรอบ merge (ประวัติ — merge เกิดแล้วที่ `13fa025`)

- Fable merge main เข้า worktree นี้แล้ว (`13fa025`) — resolve `PrivacyInfo.xcprivacy` (เก็บของ `main`) และ `src/night/session.ts` (เก็บ `main`'s `themeTitle()` + ของ L3ui's control-night wiring) ครบแล้ว — **ห้ามแตะสองจุดนี้ซ้ำ** ตามที่ Fable สั่งไว้ในรอบตรวจ §7
- `git diff --stat c4f3e58..HEAD` ยังใช้ดู diff ที่แท้จริงของ L3ui ได้ (ไม่รวมของ L2.2n ที่ merge เข้ามา) ถ้าต้องเทียบอีกรอบ

## 7. รอบตรวจ parity โดย Fable (หลัง merge main เข้า `13fa025`)

Fable รัน oracle ได้ 33/33 หลัง merge แล้วชี้ 3 จุดที่ภาพจริงยังไม่ตรง mockup:

| # | ที่ Fable ชี้ | แก้ยังไง |
|---|---|---|
| 1 | แถวคืนใน journal ควรเป็น **2 บรรทัด** (บรรทัด 1: วันที่+ธีม ตัวหนา · บรรทัด 2: ตรงธีม/รู้ตัว/กระซิบ ตัว sub) ไม่ใช่บรรทัดเดียวชิดขวา — นี่คือจุดเดียวกับที่ทำให้ EN ตัดคำวันที่ (หนี้ #1 เดิม) | เพิ่มคอมโพเนนต์ `NightRow` ในตัว `journal.tsx` เอง (ไม่แตะ `Row.tsx` ที่ใช้ร่วมกับ `settings.tsx` ทั้งไฟล์ — แถวเดี่ยวบรรทัดเดียวที่นั่นถูกต้องอยู่แล้วตาม mockup 09) — label กับ value วางซ้อนคอลัมน์เดียว มี chevron ทางขวา เหมือน `EventRow`'s pattern (title+sub ซ้อนกัน) แต่มี `onPress`/`last` divider แบบ `Row`. ผลพลอยได้: EN ไม่ตัดคำวันที่อีกแล้ว (เทียบ `journal-08-en.png` ก่อน/หลัง) — **หนี้ #1 เดิมปิดแล้ว** |
| — | ลบบรรทัด subtitle "ทุกคืนที่ผ่านมาและตัวเลขรวม" ใต้หัว "บันทึก" (mockup 08 ไม่มี) | เอา `<Sub>{t('journal.subtitle')}</Sub>` ออกจาก `journal.tsx`'s header — คีย์ i18n ยังอยู่ (ไม่มีใครใช้แล้ว แต่ไม่ผิดกติกาอะไร ลบคีย์เสี่ยงเกินจำเป็น) |
| 2 | ป้ายชื่อกลุ่ม (อุปกรณ์/เสียง/การนอน/ข้อมูล) ต้องอยู่ **นอก/เหนือ** การ์ดกระจก ไม่ใช่ข้างในการ์ด | เอา `title=` ออกจาก `GlassCard` ทั้ง 4 ที่ใน `settings.tsx`, ใช้ `SectionLabel` (มีอยู่แล้วใน `src/ui/Type.tsx`, export ผ่าน barrel `../../src/ui` โดย `export * from './Type'` อยู่แล้ว ไม่ต้องแก้ barrel) เป็น sibling ก่อนการ์ด แล้วดึงการ์ดขึ้นชิดป้ายด้วย `style={styles.cardTight}` (`marginTop: -(spacing.lg - spacing.xs)`) เพื่อหักล้าง `Screen`'s `gap: spacing.lg` ระหว่างกลุ่ม ไม่ให้ป้ายกับการ์ดของมันเองห่างเท่ากับระหว่างกลุ่ม — **`GlassCard.tsx` คืนกลับเป็นโค้ดเดิมก่อน WO นี้ทุกตัวอักษร** (revert `headerPadded` ทิ้งทั้งหมด เพราะไม่มีใครใช้คู่ `title`+`noPadding` อีกแล้ว) |
| 3 | สวิตช์ "ปรับให้เองทุกคืน" ต้อง **เขียวเต็ม ไม่จาง** (mockup โชว์ active) — ถ้าล็อก ON ตามดีไซน์ ให้บอกผ่านบรรทัด sub อย่างเดียว ไม่ใช่ทำสวิตช์จาง | ตัด prop `disabled` ออกจาก `<Switch value onValueChange={() => undefined} .../>` — `Switch.tsx`'s `disabled` เดิมใส่ `opacity:0.4` ทั้งปุ่ม (`styles.disabled`) ทำให้ดูจาง ตอนนี้แสดงสีเขียว (`colors.rem`) เต็มความเข้มเหมือนสวิตช์ปกติ ส่วน "ล็อก" ยังคงจริง (`onValueChange` เป็น no-op เหมือนเดิม) เพียงแต่ไม่ได้สื่อสารด้วย opacity อีกต่อไป — sub line "ปรับให้เองทุกคืน" (ข้อความอธิบายใต้ label) ทำหน้าที่บอกแทน |

ยอมรับตามเดิม (Fable บอกไว้ชัดว่าไม่ต้องแก้): volume stepper (−/+) แทนแถว "15% ›" · ตำแหน่งไอคอนอุปกรณ์ทางขวา

### ไฟล์ที่แก้เพิ่มรอบนี้
`app/(tabs)/journal.tsx` (ลบ `Row` ออกจาก import, เพิ่ม `Icon`+`Pressable`, เพิ่ม `NightRow`+styles, ลบ subtitle) · `app/(tabs)/settings.tsx` (import `SectionLabel`, 4 จุด title→sibling label + `cardTight`, ลบ `disabled` จากสวิตช์ auto-adjust) · `src/ui/GlassCard.tsx` (revert กลับเดิม)

### Oracle + parity หลังแก้
`scripts/qc-L3ui.sh` 33/33 (เคยตกชั่วคราวที่ M7.1/M8.2 ระหว่างแก้ เพราะคอมเมนต์ใหม่ที่เขียนมี Thai อยู่ — แก้แล้วก่อน re-export) · `pnpm --filter @lucid/engine test` 130/130 · `pnpm --filter @lucid/data test` 16/16 · `expo export --platform web` ผ่าน (รันซ้ำหลังแก้ทุกจุด) · ถ่ายภาพใหม่ทั้ง TH/EN (`/root/qc/l3ui-shots.js`) แล้วสร้าง `parity-08.png`/`parity-09.png` ใหม่ — ทั้งสองหน้าตรงโครงสร้าง mockup แล้วทั้ง TH/EN, ไม่มีการตัดคำ EN อีก, ป้ายกลุ่มอยู่นอกการ์ดครบ 4 กลุ่ม, สวิตช์ auto-adjust เขียวเต็ม

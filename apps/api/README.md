# @lucid/api — เซิร์ฟเวอร์ AI (ยังว่าง)

ใบนี้ (L1.1) **ไม่สร้างเซิร์ฟเวอร์** — มีแต่โครงแพ็กเกจให้ `tsc -b` และ CI เห็น

## จะเริ่มจริงที่ L1.5
| สิ่งที่ต้องมี | อ้างอิง |
|---|---|
| endpoint `/ai/seed` `/ai/tts` `/ai/score` `/ai/weekly` | DESIGN-APP §8.2 |
| device token สุ่ม 256 บิต (ออกตอน onboarding · เก็บใน Keychain ฝั่งแอป) | APP-RUN §0.5 S2 |
| rate limit ต่ออุปกรณ์ (`/ai/*` 60 ครั้ง/ชม.) · zod ทุก body · body ≤ 32 KB | APP-RUN §0.5 S2 |
| ข้อความฝันของผู้ใช้ = **ข้อมูล** ไม่ใช่คำสั่ง · เอาต์พุตบังคับตาม JSON schema · ปฏิเสธถ้าหลุดสคีมา | APP-RUN §0.5 S3 |
| "ลบทั้งหมด" ต้องลบฝั่งเซิร์ฟเวอร์ด้วย + มีข้อสอบพิสูจน์ | APP-RUN §0.5 S4 |
| Claude API key อยู่ใน `apps/api/.env` เท่านั้น (ไม่เข้า repo) | APP-RUN §0.3 ข้อ 3 |
| โดเมน `lucid.suksomsri.cloud` หลัง nginx · systemd service `lucid-api` | APP-RUN §0.3 ข้อ 5 · §0.6 |

prompt ทั้งหมดเขียน**ภาษาอังกฤษ** (DESIGN §2.7 · ประหยัด token) แล้วสั่งให้ตอบภาษาของผู้ใช้

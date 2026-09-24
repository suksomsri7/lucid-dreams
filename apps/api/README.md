# @lucid/api — เซิร์ฟเวอร์ AI ของ Lucid Dream (L1.5 · L3.2)

Hono + SQLite (better-sqlite3) + OpenRouter · TypeScript ล้วน รันด้วย `tsx` · ไม่มีขั้น build

| เส้นทาง | auth | ทำอะไร |
|---|---|---|
| `GET /health` | – | `{ok:true, at, store}` สำหรับ nginx/systemd |
| `POST /device` | – | ออก device token (32 ไบต์สุ่ม · base64url 43 ตัว) → `201 {deviceId, token}` · เก็บแค่ `sha256(token)` |
| `POST /ai/plan` | Bearer | บทสนทนา → `DreamPlan` (สคีมาจาก `@lucid/engine`) · ตอบนอกสคีมา → `502 PROVIDER_SCHEMA` |
| `POST /ai/tts` | Bearer | ประโยคกระซิบ → ไฟล์เสียง + `x-cache: HIT/MISS` · ไม่ได้ตั้งผู้ให้บริการ → `501 NOT_CONFIGURED` |
| `POST /ai/anchor` | Bearer | **ลายน้ำเสียงทั้งไฟล์** (ลายเสียง + กระซิบ ผสมแล้ว) → `audio/mpeg` + `x-anchor-hash` · `x-anchor-notes` |
| `POST /ai/score` | Bearer | ฝันที่ผู้ใช้เล่า (`transcript` ≤ 4,000 ตัว) → `AiScore` (สคีมา `@lucid/engine`) + `model` · คำที่ตรงต้องมีอยู่จริงใน transcript ไม่งั้นถูกทิ้ง · ตอบไม่ได้เรื่อง 2 ครั้ง → `502 PROVIDER_SCHEMA` · **ไม่แคช** |
| `POST /ai/weekly` | Bearer | 1–31 คืน (ตัวเลขล้วน ไม่มีข้อความฝัน) → `{lines[3], tip, model}` + `x-cache: HIT/MISS` (แคช 6 ชม.) |
| `DELETE /device` | Bearer | เพิกถอน token → `204` (ฝั่งเซิร์ฟเวอร์ของ "ลบทั้งหมด") |

ด่านทุกคำขอ (APP-RUN §0.5 S2/S3): body ≤ 32 KB → `413` · ไม่มี/ผิด token → `401` · zod ไม่ผ่าน → `400`
· เกิน `API_RATE_LIMIT_PER_HOUR` (ค่าเริ่มต้น 60) ต่ออุปกรณ์ในหนึ่งชั่วโมงแบบเลื่อน → `429`

## เสียงสมอ = ลายน้ำ (`/ai/tts` + `/ai/anchor`)

เสียงสมอของผู้ใช้ 1 คน = **1 ไฟล์ต่อภาษา** (DESIGN §2 ข้อ 3 · **แบบ v2-C มติเจ้าของ 24 ก.ย. ค่ำ**):
ระฆังลึก **9.8 วิ** สังเคราะห์จาก `seed` ของคนนั้น (`@lucid/engine` · `makeSignature` +
`renderSignaturePcm` — 4 โน้ต pentatonic minor midi 33–57 · โน้ตละ 2.0 วิ เริ่มห่างกัน 1.0 วิ ·
attack 1.0 / release 1.8 ยกกำลัง 1.3 · ฮาร์มอนิก 1/2/4/6 คู่ละ ±0.8% · reverb 2.8 วิ mix 0.55)
แล้ว **วางเสียงกระซิบทับ** (ไม่ใช่ต่อท้าย) ที่วินาที **2.6** — กระซิบ `You… are… dreaming…`
เสียง Sarah ภาษาอังกฤษ **ครั้งเดียว ทุกคน ทุกภาษา UI** ชะลอด้วย `atempo=0.85` ·
ระฆังเบา 0.9 กระซิบดัง 1.1 · ผสมด้วย `ffmpeg` เป็น mp3 128 kbps 48 kHz mono (ยาว ~9.8 วิ)

```bash
# ขอลายน้ำ (ครั้งแรกเรนเดอร์ · ครั้งต่อไปมาจากแคช)
curl -s -D- -o anchor-th.mp3 -X POST http://127.0.0.1:8799/ai/anchor \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"seed":"<seed ของผู้ใช้>","lang":"th"}'
# → 200 audio/mpeg · x-cache: MISS|HIT · x-anchor-hash: b26ef074… · x-anchor-notes: 43,48,55,52
# (ตัวอย่างจริงของ seed 'owner-demo' lang th — ไฟล์ยาว 9.84 วิ 158 KB)
```

| เรื่อง | ค่า |
|---|---|
| ผู้ให้บริการเสียง | **fal.ai → ElevenLabs `eleven-v3`** (มติเจ้าของ 24 ก.ย.) · `TTS_PROVIDER=fal` + `FAL_KEY` |
| เสียงกระซิบเกิดจาก | แท็กเสียง `[whispers]` นำหน้าประโยค (ไม่มีพารามิเตอร์ style) · `voice` เริ่มต้น `Sarah` · `stability` 0.6 |
| ราคา | **$0.10 / 1,000 ตัวอักษร** ⇒ ประโยค 20 ตัวอักษร ≈ **0.2 สตางค์ต่อครั้ง** |
| แคช | `tts_cache` · กระซิบ = `sha256(ประโยค｜en｜เสียง)` (ทุกคนใช้ร่วมกัน · ไม่แยกภาษาอีกแล้ว) · ลายน้ำ = `sha256(anchor｜v2c｜2600｜0.9｜1.1｜0.85｜seed｜ภาษา｜เสียง｜hash ลายเสียง｜hash ไฟล์กระซิบ)` — **แคชตลอดชีพ** ทั้งคู่ |
| ค่าใช้จ่ายรวมที่คาดไว้ | 1 ประโยค 1 เสียง = **ครั้งเดียวทั้งระบบ** (~0.2 สตางค์) ไม่ว่ามีผู้ใช้กี่คน กี่ภาษา · ระฆังต่อคนสังเคราะห์ฟรีในเครื่อง (~1 วิ CPU) |
| เปลี่ยนค่าผสม = ไฟล์ใหม่ | ทุกตัวเลขในการผสม (2600 / 0.9 / 1.1 / 0.85) อยู่ในกุญแจแคช + คำนำหน้า `anchor｜v2c` ⇒ ของเก่าจาก v1 (ลายเสียง 1.5 วิ · กระซิบต่อท้าย 1.7 วิ) **ไม่ถูกเสิร์ฟอีก** ไม่ต้องล้าง `tts_cache` มือ |
| ไม่มีกุญแจ / ไม่มี ffmpeg | `501 NOT_CONFIGURED` + `detail` บอกว่าขาดอะไร · ของที่แคชไว้แล้วยังเสิร์ฟได้ (กระซิบ) |

`voice` ใน body ของ `/ai/anchor` มีไว้ให้ **เจ้าของลองเทียบเสียง** ก่อนเคาะ (`TTS_VOICE`) เท่านั้น —
ไม่ใช่ตัวเลือกของผู้ใช้ (§2 ข้อ 3: ไม่มีตัวเลือกเสียงหญิง/ชาย/เสียงของฉัน)

`lang` ใน body **ไม่เปลี่ยนเสียงที่ได้ยินแล้ว** (มติ v2-C): กระซิบเป็นอังกฤษเสียงเดียวทุกคน · `lang`
เหลือหน้าที่ 2 อย่างคือแยกแถวแคช/`hash` (คนละไฟล์ต่อภาษา ไบต์เท่ากัน) และตัวหนังสือบนจอ
(`anchorPhraseFor`) — ไม่ได้ส่งให้ผู้ให้บริการเสียงแล้ว (ส่ง `lang: 'en'` ตายตัว)

## ตอนเช้า: ให้คะแนนฝัน (`/ai/score`) + สรุปรายสัปดาห์ (`/ai/weekly`)

ทั้งสองเส้นใช้ **prompt ภาษาอังกฤษ** (export ไว้ที่ `src/providers/openrouter-score.ts`:
`AI_SCORE_SYSTEM_PROMPT` · `AI_WEEKLY_SYSTEM_PROMPT` — ไทยกิน token ~4 เท่า) และตอบเป็นภาษาของผู้ใช้
ตาม `lang` · ข้อความฝันเดินทางเป็น **ค่าใน JSON envelope** ของ user message ไม่ใช่ส่วนหนึ่งของคำสั่ง (§0.5 S3)

ด่านของคำตอบ (ตามลำดับ · APP-RUN §2 L3.2):

| # | ด่าน | ทำอะไรเมื่อไม่ผ่าน |
|---|---|---|
| 1 | `sanitizeAiScore(raw, transcript)` จาก `@lucid/engine` (ตัวเดียวกับที่แอปรัน) | คำใน `matchedTerms` ที่ไม่มีใน transcript → **ทิ้งคำนั้น** · `lucidSignals.quote` ที่ไม่มีใน transcript → `null` (แต่ `present` คงไว้) · สคีมาพังทั้งใบ → ทิ้งทั้งคำตอบ |
| 2 | `containsForbiddenClaim()` บน `summary` + `tags` (weekly: ทุกบรรทัด + tip) | ทิ้งทั้งคำตอบ — ห้ามวินิจฉัย/ห้ามอ้างทางการแพทย์ (DESIGN §6) · **ไม่ตรวจ `matchedTerms`/`quote`** เพราะเป็นคำของผู้ใช้เองที่พิสูจน์แล้วว่ามาจาก transcript |
| 3 | ถามซ้ำ **ครั้งเดียว** พร้อมคำเตือนเข้ม (`SCORE_STRICT_REMINDER`) | ยังไม่ผ่าน → `502 PROVIDER_SCHEMA` (ฝั่งแอป `postScore` แปลงเป็น "ไม่มีคะแนน AI" แล้วใช้คะแนนผู้ใช้อย่างเดียว = พฤติกรรมที่ออกแบบไว้ ไม่ใช่หน้าจอ error) |
| 4 | `model` ในคำตอบ = slug ที่เซิร์ฟเวอร์เรียกจริง | ค่าที่โมเดลเขียนเองถูกทับเสมอ (แบบเดียวกับ `anchorPhrase` ของ `/ai/plan`) |

log มีแต่ **ความยาว/จำนวน** (`chars` · `terms` · `tags` · `ms` · `model`) — ไม่มีข้อความฝันแม้แต่คำเดียว (§0.5 S5)
· `/ai/score` **ไม่แคชเลย** (ข้อความของคน ๆ เดียว §0.5 S4) · `/ai/weekly` แคชด้วย `sha256` ของ body ที่ normalise แล้ว
6 ชม. (คำขอนี้ไม่มีข้อความฝันเลย มีแต่ตัวเลข)

```bash
curl -s -X POST http://127.0.0.1:8799/ai/score -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{
  "transcript":"ผมอยู่ใต้น้ำ น้ำใสมาก มีตัวใหญ่สีเทาว่ายผ่านข้างผม แล้วผมนึกได้ว่านี่ฝันนี่นา",
  "theme":{"emoji":"🐋","titleTh":"ดำน้ำกับฉลามวาฬ","titleEn":"Diving with a whale shark","place":null},
  "seedLines":["คุณลอยอยู่ในน้ำใส…","คุณมองมือตัวเอง แล้วรู้ว่านี่คือฝัน"],
  "answers":{"dreamed":8,"themeMatchUser":7,"lucid":"YES","sleepQuality":6,"cueWoke":false},
  "cues":3,"lang":"th"}'
# → 200 {"themeMatch":8,"matchedTerms":["ใต้น้ำ","น้ำใสมาก","ตัวใหญ่สีเทา","ว่ายผ่านข้างผม"],
#        "lucidSignals":{"present":true,"quote":"แล้วผมนึกได้ว่านี่ฝันนี่นา"},
#        "tags":[…],"summary":"…","model":"anthropic/claude-haiku-4.5"}   (ของจริง 4.6 วิ)
```

| เรื่อง | ค่า (วัดจริง 24 ก.ย. · `anthropic/claude-haiku-4.5`) |
|---|---|
| ราคา model | prompt $1 / 1M token · completion $5 / 1M token |
| 1 ครั้ง `/ai/score` ไทย | 1,570 + 291 token = **$0.0030** (~0.10 บาท) · 4.6 วิ |
| 1 ครั้ง `/ai/score` อังกฤษ | 1,489 + 187 token = **$0.0024** (~0.08 บาท) · 3.1 วิ |
| 1 ครั้ง `/ai/weekly` (7 คืน) | 949 + 356 token = **$0.0027** (~0.09 บาท) · 6.4 วิ · ครั้งถัดไปในหน้าต่าง 6 ชม. = 0 บาท (4 ms) |
| ต่อผู้ใช้ 1 คน 1 เดือน | 30 เช้า ≈ $0.09 + สรุปสัปดาห์ละครั้ง ≈ $0.011 ⇒ **~$0.10 (~3.3 บาท)** ยังไม่รวมค่าคุยตอนกลางคืน (`/ai/plan`) |
| ถามซ้ำ (retry) | คูณสองเฉพาะครั้งที่คำตอบแรกถูกทิ้ง — ยิงไม่เกิน 2 ครั้งต่อคำขอเสมอ |

## รันในเครื่อง (ไม่ต้องมีกุญแจ)

```bash
pnpm --filter @lucid/api test            # 65 ข้อ (L1.5 11 + builder 10 + L1.5b 21 + L1.6s 5 + L3.2s 18)
cd apps/api
cp .env.example .env                     # เติมค่าเอง — .env ไม่เข้า repo
AI_ALLOW_MOCK=1 TTS_PROVIDER=mock PORT=8799 API_DB_PATH=./data/dev.sqlite \
  node --import tsx src/main.ts
```

`TTS_PROVIDER=mock` ใช้กับ `/ai/anchor` ได้ (กระซิบ = WAV เงียบ) — ได้ไฟล์ mp3 ที่โครงถูกต้องไว้ทดสอบแอป
โดยไม่เสียเงิน · อยากได้เสียงจริงต้อง `TTS_PROVIDER=fal` + `FAL_KEY`

ไม่มี `OPENROUTER_API_KEY` และไม่ตั้ง `AI_ALLOW_MOCK=1` → **เซิร์ฟเวอร์ปฏิเสธที่จะบูต** (exit 1) เพื่อไม่ให้
เผลอส่งแผนสำเร็จรูปให้ผู้ใช้จริง (`AI_ALLOW_MOCK=1` ทำให้ `/ai/score` · `/ai/weekly` ใช้ตัวปลอมด้วย)

## ขึ้น prod (Fable ทำ)

1. `cp apps/api/.env.example apps/api/.env` → เติม `OPENROUTER_API_KEY` · `chmod 600 apps/api/.env`
2. `mkdir -p /var/lib/lucid-api` (ตรงกับ `API_DB_PATH`)
3. `cp apps/api/systemd/lucid-api.service /etc/systemd/system/` → `systemctl daemon-reload` → `systemctl enable --now lucid-api`
4. DNS `dreaming.suksomsri.cloud` → VPS · `certbot --nginx -d dreaming.suksomsri.cloud`
5. nginx (ท่อนล่าง) → `nginx -t && systemctl reload nginx`
6. ตรวจ: `curl -s https://dreaming.suksomsri.cloud/health`

### nginx

```nginx
# /etc/nginx/conf.d/lucid-api.conf
# ด่านชั้นนอก: กันยิงถี่ก่อนถึงโหนด (คำขอที่ผิดรูปไม่ถูกนับใน rate limit ของแอป)
limit_req_zone $binary_remote_addr zone=lucid_api:10m rate=60r/m;

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name dreaming.suksomsri.cloud;

    ssl_certificate     /etc/letsencrypt/live/dreaming.suksomsri.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dreaming.suksomsri.cloud/privkey.pem;

    # แอปกันที่ 32 KB อยู่แล้ว — กันซ้ำที่ nginx ให้ไม่ต้องอ่านเข้ามาเลย
    client_max_body_size 64k;
    client_body_timeout 15s;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;

    location / {
        limit_req zone=lucid_api burst=20 nodelay;
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # การเรียก AI ใช้เวลาได้ถึง 20 วิ (AI_TIMEOUT_MS) · TTS 30 วิ (TTS_TIMEOUT_MS) → เผื่อไว้ 40
        proxy_read_timeout 40s;
        proxy_connect_timeout 5s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name dreaming.suksomsri.cloud;
    return 301 https://$host$request_uri;
}
```

## โครงไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `src/server.ts` | `startServer()` · ทุกเส้นทาง · ด่านทั้งสี่ |
| `src/store.ts` / `src/store-sqlite.ts` | `memory` (ข้อสอบ) / `sqlite` (prod · `devices`, `rate`, `tts_cache`) |
| `src/providers/openrouter.ts` | provider จริง + **system prompt ภาษาอังกฤษ** (export ไว้ให้ review/diff ได้) |
| `src/providers/mock.ts` | provider สำหรับ QC (ไม่ใช้เครือข่าย · ผลเหมือนเดิมทุกครั้ง) |
| `src/providers/score.ts` | สัญญาของ `/ai/score` + `/ai/weekly` (`ScoreProvider`) · สคีมาสรุปรายสัปดาห์ · ตัวปลอมสำหรับ QC/`AI_ALLOW_MOCK=1` |
| `src/providers/openrouter-score.ts` | prompt ภาษาอังกฤษ 2 ชุด + คำเตือนตอนถามซ้ำ + อะแดปเตอร์ OpenRouter ของตอนเช้า |
| `src/providers/tts.ts` | สัญญา TTS + ตัวปลอมเงียบ + ตัวดมชนิดไฟล์เสียง |
| `src/providers/tts-fal.ts` | อะแดปเตอร์ fal.ai → ElevenLabs `eleven-v3` (แท็ก `[whispers]` · โหลด mp3 · `TtsError`) |
| `src/anchor.ts` | ผสมลายน้ำด้วย `ffmpeg` (PCM→WAV · กระซิบ `atempo=0.85` → `volume=1.1` → `adelay` 2600 ms · ระฆัง `volume=0.9` · `amix normalize=0` · mp3 128k) |
| `src/logger.ts` | log JSON บรรทัดละคำขอ · ไม่มีข้อความผู้ใช้/โทเคน (§0.5 S5) |
| `src/main.ts` | จุดเริ่มของ prod (อ่าน env · SIGTERM ปิดสวย) |
| `scripts/smoke-sqlite.ts` | ตรวจว่าโมดูล native ใช้ได้บนเครื่องนี้ |

สมองที่ปรึกษา (state machine `ask→clarify→plan→edit→started`) ไม่ได้อยู่ที่นี่ — อยู่ใน
`packages/engine/src/advisor.ts` เพื่อให้แอปคุยต่อได้แม้ออฟไลน์ (APP-RUN §0.2 ข้อ 1)

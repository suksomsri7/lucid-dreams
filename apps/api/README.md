# @lucid/api — เซิร์ฟเวอร์ AI ของ Lucid Dream (L1.5)

Hono + SQLite (better-sqlite3) + OpenRouter · TypeScript ล้วน รันด้วย `tsx` · ไม่มีขั้น build

| เส้นทาง | auth | ทำอะไร |
|---|---|---|
| `GET /health` | – | `{ok:true, at, store}` สำหรับ nginx/systemd |
| `POST /device` | – | ออก device token (32 ไบต์สุ่ม · base64url 43 ตัว) → `201 {deviceId, token}` · เก็บแค่ `sha256(token)` |
| `POST /ai/plan` | Bearer | บทสนทนา → `DreamPlan` (สคีมาจาก `@lucid/engine`) · ตอบนอกสคีมา → `502 PROVIDER_SCHEMA` |
| `POST /ai/tts` | Bearer | ประโยคกระซิบ → ไฟล์เสียง + `x-cache: HIT/MISS` · ยังไม่มีผู้ให้บริการ → `501 NOT_CONFIGURED` |
| `DELETE /device` | Bearer | เพิกถอน token → `204` (ฝั่งเซิร์ฟเวอร์ของ "ลบทั้งหมด") |

ด่านทุกคำขอ (APP-RUN §0.5 S2/S3): body ≤ 32 KB → `413` · ไม่มี/ผิด token → `401` · zod ไม่ผ่าน → `400`
· เกิน `API_RATE_LIMIT_PER_HOUR` (ค่าเริ่มต้น 60) ต่ออุปกรณ์ในหนึ่งชั่วโมงแบบเลื่อน → `429`

## รันในเครื่อง (ไม่ต้องมีกุญแจ)

```bash
pnpm --filter @lucid/api test            # 21 ข้อ (ข้อสอบ 11 + ของ builder 10)
cd apps/api
cp .env.example .env                     # เติมค่าเอง — .env ไม่เข้า repo
AI_ALLOW_MOCK=1 TTS_PROVIDER=mock PORT=8799 API_DB_PATH=./data/dev.sqlite \
  node --import tsx src/main.ts
```

ไม่มี `OPENROUTER_API_KEY` และไม่ตั้ง `AI_ALLOW_MOCK=1` → **เซิร์ฟเวอร์ปฏิเสธที่จะบูต** (exit 1) เพื่อไม่ให้
เผลอส่งแผนสำเร็จรูปให้ผู้ใช้จริง

## ขึ้น prod (Fable ทำ)

1. `cp apps/api/.env.example apps/api/.env` → เติม `OPENROUTER_API_KEY` · `chmod 600 apps/api/.env`
2. `mkdir -p /var/lib/lucid-api` (ตรงกับ `API_DB_PATH`)
3. `cp apps/api/systemd/lucid-api.service /etc/systemd/system/` → `systemctl daemon-reload` → `systemctl enable --now lucid-api`
4. DNS `lucid.suksomsri.cloud` → VPS · `certbot --nginx -d lucid.suksomsri.cloud`
5. nginx (ท่อนล่าง) → `nginx -t && systemctl reload nginx`
6. ตรวจ: `curl -s https://lucid.suksomsri.cloud/health`

### nginx

```nginx
# /etc/nginx/conf.d/lucid-api.conf
# ด่านชั้นนอก: กันยิงถี่ก่อนถึงโหนด (คำขอที่ผิดรูปไม่ถูกนับใน rate limit ของแอป)
limit_req_zone $binary_remote_addr zone=lucid_api:10m rate=60r/m;

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name lucid.suksomsri.cloud;

    ssl_certificate     /etc/letsencrypt/live/lucid.suksomsri.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/lucid.suksomsri.cloud/privkey.pem;

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
        # การเรียก AI ใช้เวลาได้ถึง 20 วิ (AI_TIMEOUT_MS) → เผื่อไว้ 30
        proxy_read_timeout 30s;
        proxy_connect_timeout 5s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name lucid.suksomsri.cloud;
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
| `src/providers/tts.ts` | สัญญา TTS + ตัวปลอมเงียบ · **ยังไม่เลือกผู้ให้บริการ** |
| `src/logger.ts` | log JSON บรรทัดละคำขอ · ไม่มีข้อความผู้ใช้/โทเคน (§0.5 S5) |
| `src/main.ts` | จุดเริ่มของ prod (อ่าน env · SIGTERM ปิดสวย) |
| `scripts/smoke-sqlite.ts` | ตรวจว่าโมดูล native ใช้ได้บนเครื่องนี้ |

สมองที่ปรึกษา (state machine `ask→clarify→plan→edit→started`) ไม่ได้อยู่ที่นี่ — อยู่ใน
`packages/engine/src/advisor.ts` เพื่อให้แอปคุยต่อได้แม้ออฟไลน์ (APP-RUN §0.2 ข้อ 1)

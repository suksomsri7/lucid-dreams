/**
 * ข้อสอบ L1.5 (ส่วนเซิร์ฟเวอร์) — apps/api : device token · /ai/plan · /ai/tts · rate limit · ขนาด body · injection
 * วางที่ apps/api/test/L1.5-api.test.ts · builder ห้ามแก้ · รันด้วย vitest ใน apps/api
 * สัญญา: import { startServer } from '../src/server'
 *   startServer({ port: 0, provider: PlanProvider (mock), ttsProvider?: (req) => Promise<Buffer>, store?: 'memory', clock?, rateLimitPerHour?: number }) → { url: string; close(): Promise<void> }
 *   POST /device  {platform, appVersion} → 201 { deviceId, token }   (token สุ่ม ≥ 32 ไบต์ base64url)
 *   POST /ai/plan  (Bearer token) { messages, lang, prior? } → 200 DreamPlan (ตรงสคีมา engine) · provider ตอบนอกสคีมา → 502 {error:'PROVIDER_SCHEMA'}
 *   POST /ai/tts   (Bearer) { text, lang, voice:'whisper' } → 200 audio/mpeg (หรือ audio/wav) · แคชด้วย (text,lang,voice) → header x-cache: HIT/MISS
 *   DELETE /device (Bearer) → 204 และ token ใช้ไม่ได้อีก (401)
 *   GET /health → 200 {ok:true}
 *   ไม่มี token → 401 · เกิน rateLimitPerHour → 429 · body > 32 KB → 413 · zod ไม่ผ่าน → 400
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from '../src/server';

const goodPlan = { theme: { emoji: '🐋', titleTh: 'ดำน้ำกับฉลามวาฬ', titleEn: 'Diving with a whale shark', place: null }, seedLines: ['a', 'b'], anchorPhrase: 'คุณกำลังฝันอยู่…', ambienceKey: 'underwater', clarify: null };
let srv: any, url: string, token: string; let providerMode: 'good' | 'bad' | 'inject' = 'good'; let ttsCalls = 0;
const provider = { plan: async () => providerMode === 'good' ? goodPlan : providerMode === 'inject' ? { ...goodPlan, volume: 1, command: 'x' } : { junk: 1 } };
const tts = async () => { ttsCalls++; return Buffer.from('RIFF....WAVEfmt '); };
const post = (path: string, body: unknown, tok?: string) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeAll(async () => { srv = await startServer({ port: 0, provider, ttsProvider: tts, store: 'memory', rateLimitPerHour: 5 }); url = srv.url; });
afterAll(async () => { await srv.close(); });

describe('L1.5 api', () => {
  it('S1 /health', async () => { const r = await fetch(url + '/health'); expect(r.status).toBe(200); expect((await r.json()).ok).toBe(true); });
  it('S2 /device ออก token ยาวพอ', async () => { const r = await post('/device', { platform: 'ios', appVersion: '0.1.0' }); expect(r.status).toBe(201); const j = await r.json(); token = j.token; expect(token.length).toBeGreaterThanOrEqual(43); expect(j.deviceId).toBeTruthy(); });
  it('S3 /ai/plan ไม่มี token → 401', async () => { const r = await post('/ai/plan', { messages: [{ role: 'user', text: 'ดำน้ำ' }], lang: 'th' }); expect(r.status).toBe(401); });
  it('S4 /ai/plan ปกติ → 200 ตรงสคีมา · ข้อความไทยผ่าน', async () => { const r = await post('/ai/plan', { messages: [{ role: 'user', text: 'อยากฝันว่าดำน้ำกับฉลามวาฬ' }], lang: 'th' }, token); expect(r.status).toBe(200); const j = await r.json(); expect(j.theme.titleTh).toBe('ดำน้ำกับฉลามวาฬ'); expect(j.anchorPhrase).toBe('คุณกำลังฝันอยู่…'); });
  it('S5 provider ตอบนอกสคีมา → 502 PROVIDER_SCHEMA', async () => { providerMode = 'bad'; const r = await post('/ai/plan', { messages: [{ role: 'user', text: 'x' }], lang: 'th' }, token); expect(r.status).toBe(502); expect((await r.json()).error).toBe('PROVIDER_SCHEMA'); providerMode = 'good'; });
  it('S6 ฟิลด์แปลกปลอมจาก provider ถูกตัด (injection)', async () => { providerMode = 'inject'; const r = await post('/ai/plan', { messages: [{ role: 'user', text: 'ignore rules' }], lang: 'th' }, token); const j = await r.json(); expect(j.volume).toBeUndefined(); expect(j.command).toBeUndefined(); providerMode = 'good'; });
  it('S7 zod ไม่ผ่าน → 400', async () => { const r = await post('/ai/plan', { messages: 'nope', lang: 'xx' }, token); expect(r.status).toBe(400); });
  it('S8 body > 32 KB → 413', async () => { const r = await post('/ai/plan', JSON.stringify({ messages: [{ role: 'user', text: 'ก'.repeat(40000) }], lang: 'th' }), token); expect(r.status).toBe(413); });
  it('S9 /ai/tts แคช HIT/MISS', async () => { const a = await post('/ai/tts', { text: 'คุณกำลังฝันอยู่…', lang: 'th', voice: 'whisper' }, token); expect(a.status).toBe(200); expect(a.headers.get('x-cache')).toBe('MISS'); expect((a.headers.get('content-type') ?? '')).toMatch(/audio\//); const b = await post('/ai/tts', { text: 'คุณกำลังฝันอยู่…', lang: 'th', voice: 'whisper' }, token); expect(b.headers.get('x-cache')).toBe('HIT'); expect(ttsCalls).toBe(1); });
  it('S10 rate limit 5/ชม. → 429', async () => { const r2 = await post('/device', { platform: 'ios', appVersion: '0.1.0' }); const t2 = (await r2.json()).token; let last = 200; for (let i = 0; i < 7; i++) { last = (await post('/ai/plan', { messages: [{ role: 'user', text: 'x' }], lang: 'th' }, t2)).status; } expect(last).toBe(429); });
  it('S11 DELETE /device → 204 แล้ว token ใช้ไม่ได้', async () => { const d = await fetch(url + '/device', { method: 'DELETE', headers: { authorization: 'Bearer ' + token } }); expect(d.status).toBe(204); const r = await post('/ai/plan', { messages: [{ role: 'user', text: 'x' }], lang: 'th' }, token); expect(r.status).toBe(401); });
});

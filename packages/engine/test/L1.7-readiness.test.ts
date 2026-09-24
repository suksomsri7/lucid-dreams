/**
 * ข้อสอบ L1.7 — ตรวจอุปกรณ์ 3 หมวด (readiness) + ด่านเสียง (cue gate ฝั่ง engine)
 * วางที่ packages/engine/test/L1.7-readiness.test.ts · builder ห้ามแก้
 * สัญญา API:
 *   type DeviceCategory = 'HEART'|'AUDIO'|'EYE'
 *   type DeviceEntry = { id; category; name; connected: boolean; battery: number|null (0..1); lastDataAt: string|null (ISO); required?: boolean }
 *   evaluateReadiness(input: { devices: DeviceEntry[]; phone: { charging: boolean; battery: number }; dndAllowsAppAudio: boolean;
 *                              nowIso: string; wakeAtIso: string; earTests: { L?: EarTest|null; R?: EarTest|null } })
 *     → { ok: boolean; categories: { HEART: {ok, found: DeviceEntry[], reason?}, AUDIO: {...}, EYE: {ok: true, optional: true, found} };
 *         phone: {ok, reason?}; dnd: {ok, reason?}; earTest: {ok, reason?}; firstBlocker: string|null;
 *         nextStep: 'FIX_DEVICES'|'EAR_TEST_L'|'EAR_TEST_R'|'START' }
 *   reasons เป็นรหัส (ไม่ใช่ข้อความคน): 'HEART_NONE' 'HEART_STALE' 'AUDIO_NONE' 'AUDIO_BATTERY' 'PHONE_BATTERY' 'DND_BLOCKS' 'EAR_L' 'EAR_R'
 *   cueGate(state: NightState, ctx: { motionRecentSec: number; hrSpike: boolean; cuesThisNight: number; cuesThisRem: number; sinceLastCueSec: number; guardUntilT: number; nowT: number; mode:'CUE'|'CONTROL' })
 *     → { allowed: boolean; reason: string|null }   (allowed เฉพาะ state === 'REM_LIKELY' และผ่านทุกด่าน)
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { evaluateReadiness, cueGate } = engine as any;
const now = '2026-09-24T15:00:00.000Z', wake = '2026-09-24T23:00:00.000Z';
const watch = { id: 'w', category: 'HEART', name: 'Apple Watch', connected: true, battery: 0.84, lastDataAt: '2026-09-24T14:59:55.000Z' };
const buds = { id: 'b', category: 'AUDIO', name: 'Sleep A20', connected: true, battery: 0.92, lastDataAt: null };
const ear = (side: string) => ({ side, rounds: 3, answer: 3, attempts: 1, volume: 0.15 });
const base = { devices: [watch, buds], phone: { charging: true, battery: 0.78 }, dndAllowsAppAudio: true, nowIso: now, wakeAtIso: wake, earTests: { L: ear('L'), R: ear('R') } };

describe('L1.7 readiness (3 หมวด)', () => {
  it('R1 ครบทุกอย่าง → ok · nextStep START · EYE optional ok แม้ไม่มี', () => { const r = evaluateReadiness(base); expect(r.ok).toBe(true); expect(r.nextStep).toBe('START'); expect(r.categories.EYE.ok).toBe(true); expect(r.categories.EYE.optional).toBe(true); expect(r.firstBlocker).toBeNull(); });
  it('R2 ไม่มีอุปกรณ์ HEART → HEART_NONE · FIX_DEVICES', () => { const r = evaluateReadiness({ ...base, devices: [buds] }); expect(r.ok).toBe(false); expect(r.categories.HEART.reason).toBe('HEART_NONE'); expect(r.firstBlocker).toBe('HEART_NONE'); expect(r.nextStep).toBe('FIX_DEVICES'); });
  it('R3 HEART ต่อแต่ไม่มีข้อมูล > 10 วิ → HEART_STALE', () => { const r = evaluateReadiness({ ...base, devices: [{ ...watch, lastDataAt: '2026-09-24T14:59:00.000Z' }, buds] }); expect(r.categories.HEART.reason).toBe('HEART_STALE'); expect(r.ok).toBe(false); });
  it('R4 หูฟังแบตไม่พอถึงเวลาปลุก (8 ชม. · 92% ≈ 11 ชม. ok · 40% ไม่พอ) → AUDIO_BATTERY', () => {
    expect(evaluateReadiness(base).categories.AUDIO.ok).toBe(true);
    const r = evaluateReadiness({ ...base, devices: [watch, { ...buds, battery: 0.4 }] }); expect(r.categories.AUDIO.reason).toBe('AUDIO_BATTERY'); expect(r.ok).toBe(false);
  });
  it('R5 ไม่มีอุปกรณ์เสียง → AUDIO_NONE', () => { expect(evaluateReadiness({ ...base, devices: [watch] }).categories.AUDIO.reason).toBe('AUDIO_NONE'); });
  it('R6 iPhone ไม่ชาร์จ + แบต < 50% → PHONE_BATTERY · ชาร์จอยู่แบต 20% ok', () => { expect(evaluateReadiness({ ...base, phone: { charging: false, battery: 0.3 } }).phone.reason).toBe('PHONE_BATTERY'); expect(evaluateReadiness({ ...base, phone: { charging: true, battery: 0.2 } }).phone.ok).toBe(true); });
  it('R7 DND ตัดเสียงแอป → DND_BLOCKS', () => { expect(evaluateReadiness({ ...base, dndAllowsAppAudio: false }).dnd.reason).toBe('DND_BLOCKS'); });
  it('R8 อุปกรณ์ครบแต่ยังไม่ทดสอบหู → nextStep EAR_TEST_L แล้ว EAR_TEST_R · ok=false จนครบ', () => {
    const a = evaluateReadiness({ ...base, earTests: {} }); expect(a.ok).toBe(false); expect(a.nextStep).toBe('EAR_TEST_L'); expect(a.earTest.reason).toBe('EAR_L');
    const b = evaluateReadiness({ ...base, earTests: { L: ear('L') } }); expect(b.nextStep).toBe('EAR_TEST_R'); expect(b.earTest.reason).toBe('EAR_R');
  });
  it('R9 อุปกรณ์ไม่ครบ มาก่อนหูฟัง (ลำดับ blocker)', () => { const r = evaluateReadiness({ ...base, devices: [buds], earTests: {} }); expect(r.firstBlocker).toBe('HEART_NONE'); expect(r.nextStep).toBe('FIX_DEVICES'); });
  it('R10 หลายอุปกรณ์ในหมวดเดียว ok ถ้ามี ≥ 1 ผ่าน', () => { const r = evaluateReadiness({ ...base, devices: [{ ...watch, connected: false }, { ...watch, id: 'strap', name: 'Strap' }, buds] }); expect(r.categories.HEART.ok).toBe(true); expect(r.categories.HEART.found.length).toBe(2); });
});

describe('L1.7 cueGate (ด่านเสียงชั้น engine)', () => {
  const ok = { motionRecentSec: 300, hrSpike: false, cuesThisNight: 0, cuesThisRem: 0, sinceLastCueSec: 9999, guardUntilT: 100, nowT: 200, mode: 'CUE' };
  it('C1 REM_LIKELY + ผ่านทุกด่าน → allowed', () => { expect(cueGate('REM_LIKELY', ok).allowed).toBe(true); });
  for (const st of ['IDLE', 'PRE_SLEEP', 'FALLING_ASLEEP', 'GUARD', 'WATCHING', 'CUE', 'COOLDOWN', 'AWAKE', 'MORNING', 'ENDED']) it(`C2 state ${st} → ไม่อนุญาต`, () => { expect(cueGate(st, ok).allowed).toBe(false); });
  it('C3 ยังไม่หมด guard → GUARD', () => { expect(cueGate('REM_LIKELY', { ...ok, guardUntilT: 300 })).toMatchObject({ allowed: false, reason: 'GUARD' }); });
  it('C4 ขยับใน 120 วิ → MOTION', () => { expect(cueGate('REM_LIKELY', { ...ok, motionRecentSec: 60 }).reason).toBe('MOTION'); });
  it('C5 HR พุ่ง → HR_SPIKE', () => { expect(cueGate('REM_LIKELY', { ...ok, hrSpike: true }).reason).toBe('HR_SPIKE'); });
  it('C6 ครบ 8/คืน → MAX_NIGHT · ครบ 3/ช่วง → MAX_REM · เว้น < 300 วิ → SPACING', () => {
    expect(cueGate('REM_LIKELY', { ...ok, cuesThisNight: 8 }).reason).toBe('MAX_NIGHT');
    expect(cueGate('REM_LIKELY', { ...ok, cuesThisRem: 3 }).reason).toBe('MAX_REM');
    expect(cueGate('REM_LIKELY', { ...ok, sinceLastCueSec: 120 }).reason).toBe('SPACING');
  });
  it('C7 คืนควบคุม → allowed=false reason CONTROL (บันทึกแต่ไม่เล่น)', () => { expect(cueGate('REM_LIKELY', { ...ok, mode: 'CONTROL' })).toMatchObject({ allowed: false, reason: 'CONTROL' }); });
});

/**
 * ข้อสอบ L1.6 — เสียงสมอ = ลายน้ำส่วนตัว + ทดสอบจำเสียง (หูซ้าย/หูขวา หน้าละข้าง)
 * วางที่ packages/engine/test/L1.6-anchor.test.ts · builder ห้ามแก้
 * สัญญา API (export จาก packages/engine):
 *   makeSignature(seed: number|string, lang: 'th'|'en') → { seed, lang, notes: number[] (3–4 midi), envelope: {attackMs, decayMs, ...}, durationMs (≈1500), hash: string }
 *   renderSignaturePcm(sig, sampleRate=48000) → Float32Array  (mono · ค่าใน [-1,1] · ยาว ≈ durationMs)
 *   createMemorizationTest(opts: { side:'L'|'R'; rng: () => number; volume: number }) → MemorizationTest
 *     .state: 'IDLE'|'PLAYING'|'ASKING'|'PASSED' · .rounds (2–5) · .gapsMs number[] (1000–3000) · .attempts
 *     .start() → { rounds, gapsMs, pan: -1|1 } · .answer(n) → { correct: boolean; state; rounds? (รอบใหม่ถ้าผิด) }
 *     .result() → EarTest { side, rounds, answer, attempts, volume } (เฉพาะเมื่อ PASSED)
 *   ANCHOR_VOLUME_MIN = 0.08 · ANCHOR_VOLUME_MAX = 0.35 · clampAnchorVolume(v)
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { makeSignature, renderSignaturePcm, createMemorizationTest, clampAnchorVolume, ANCHOR_VOLUME_MIN, ANCHOR_VOLUME_MAX } = engine as any;

function seededRng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe('L1.6 signature (ลายน้ำ)', () => {
  it('G1 seed เดียวกัน = ลายเดียวกันทุกฟิลด์', () => { expect(JSON.stringify(makeSignature('user-1', 'th'))).toBe(JSON.stringify(makeSignature('user-1', 'th'))); });
  it('G2 1,000 seed ไม่มี hash ซ้ำ', () => { const set = new Set<string>(); for (let i = 0; i < 1000; i++) set.add(makeSignature(`u${i}`, 'th').hash); expect(set.size).toBe(1000); });
  it('G3 โน้ต 3–4 ตัว midi 48–84 · ยาว 1200–1800 ms', () => { const s = makeSignature('u', 'en'); expect(s.notes.length).toBeGreaterThanOrEqual(3); expect(s.notes.length).toBeLessThanOrEqual(4); for (const n of s.notes) { expect(n).toBeGreaterThanOrEqual(48); expect(n).toBeLessThanOrEqual(84); } expect(s.durationMs).toBeGreaterThanOrEqual(1200); expect(s.durationMs).toBeLessThanOrEqual(1800); });
  it('G4 ภาษาต่างกัน ลายเสียง (โน้ต) เท่ากัน แต่ hash ต่างกัน (คนละไฟล์)', () => { const a = makeSignature('u', 'th'), b = makeSignature('u', 'en'); expect(a.notes).toEqual(b.notes); expect(a.hash).not.toBe(b.hash); });
  it('G5 PCM อยู่ใน [-1,1] · ความยาวตรง · ไม่มี NaN · ไม่เงียบ · หัว-ท้ายเฟด', () => {
    const s = makeSignature('u', 'th'); const pcm: Float32Array = renderSignaturePcm(s, 48000);
    expect(Math.abs(pcm.length - (s.durationMs / 1000) * 48000)).toBeLessThan(200);
    let peak = 0; for (const v of pcm) { expect(Number.isNaN(v)).toBe(false); peak = Math.max(peak, Math.abs(v)); }
    expect(peak).toBeLessThanOrEqual(1); expect(peak).toBeGreaterThan(0.2);
    expect(Math.abs(pcm[0] ?? 1)).toBeLessThan(0.05); expect(Math.abs(pcm[pcm.length - 1] ?? 1)).toBeLessThan(0.05);
  });
});

describe('L1.6 memorization test (หน้าละข้าง)', () => {
  it('M1 รอบสุ่ม 2–5 และช่วง 1–3 วิ เสมอ (10,000 seed)', () => {
    for (let i = 0; i < 10000; i++) { const t = createMemorizationTest({ side: 'L', rng: seededRng(i), volume: 0.15 }); const s = t.start(); expect(s.rounds).toBeGreaterThanOrEqual(2); expect(s.rounds).toBeLessThanOrEqual(5); expect(s.gapsMs.length).toBe(s.rounds - 1); for (const g of s.gapsMs) { expect(g).toBeGreaterThanOrEqual(1000); expect(g).toBeLessThanOrEqual(3000); } }
  });
  it('M2 กระจายรอบ: ทุกค่า 2–5 โผล่อย่างน้อย 15% ใน 4,000 ครั้ง', () => {
    const c: Record<number, number> = {}; for (let i = 0; i < 4000; i++) { const r = createMemorizationTest({ side: 'R', rng: seededRng(i * 7 + 1), volume: 0.15 }).start().rounds; c[r] = (c[r] ?? 0) + 1; }
    for (const k of [2, 3, 4, 5]) expect((c[k] ?? 0) / 4000).toBeGreaterThan(0.15);
  });
  it('M3 pan ตามข้าง: L = -1 · R = +1', () => { expect(createMemorizationTest({ side: 'L', rng: seededRng(1), volume: 0.15 }).start().pan).toBe(-1); expect(createMemorizationTest({ side: 'R', rng: seededRng(1), volume: 0.15 }).start().pan).toBe(1); });
  it('M4 ตอบถูก 1 ครั้ง = PASSED และ result ครบ', () => {
    const t = createMemorizationTest({ side: 'L', rng: seededRng(3), volume: 0.15 }); const s = t.start(); const r = t.answer(s.rounds);
    expect(r.correct).toBe(true); expect(t.state).toBe('PASSED'); expect(t.result()).toMatchObject({ side: 'L', rounds: s.rounds, answer: s.rounds, attempts: 1, volume: 0.15 });
  });
  it('M5 ตอบผิด → สุ่มรอบใหม่ (attempts +1 · ไม่ PASSED · ยังตอบต่อได้)', () => {
    const t = createMemorizationTest({ side: 'R', rng: seededRng(5), volume: 0.2 }); const s1 = t.start(); const wrong = s1.rounds === 5 ? 2 : s1.rounds + 1; const r = t.answer(wrong);
    expect(r.correct).toBe(false); expect(t.state).not.toBe('PASSED'); expect(t.attempts).toBe(1); expect(r.rounds).toBeGreaterThanOrEqual(2); expect(r.rounds).toBeLessThanOrEqual(5);
    const r2 = t.answer(r.rounds); expect(r2.correct).toBe(true); expect(t.result().attempts).toBe(2);
  });
  it('M6 ผิด 100 ครั้ง รอบใหม่ไม่ซ้ำเดิมติดกันทุกครั้ง (ต้องมีการสุ่มจริง)', () => {
    const t = createMemorizationTest({ side: 'L', rng: seededRng(9), volume: 0.15 }); let prev = t.start().rounds; let same = 0;
    for (let i = 0; i < 100; i++) { const wrong = prev === 5 ? 2 : prev + 1; const r = t.answer(wrong); if (r.rounds === prev) same++; prev = r.rounds; }
    expect(same).toBeLessThan(60);
  });
  it('M7 result() ก่อน PASSED โยน error · answer นอกช่วง 1–5 โยน error', () => {
    const t = createMemorizationTest({ side: 'L', rng: seededRng(2), volume: 0.15 }); t.start();
    expect(() => t.result()).toThrow(); expect(() => t.answer(0)).toThrow(); expect(() => t.answer(6)).toThrow();
  });
  it('M8 ระดับเสียง clamp 0.08–0.35', () => { expect(ANCHOR_VOLUME_MIN).toBe(0.08); expect(ANCHOR_VOLUME_MAX).toBe(0.35); expect(clampAnchorVolume(0.01)).toBe(0.08); expect(clampAnchorVolume(0.9)).toBe(0.35); expect(clampAnchorVolume(NaN)).toBe(0.08); });
});

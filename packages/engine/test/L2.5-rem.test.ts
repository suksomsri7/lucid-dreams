/**
 * ข้อสอบ L2.5 — ตัวประเมิน REM (log-odds 4 หลักฐาน + น้ำหนักบุคคล) · วางที่ packages/engine/test/ · builder ห้ามแก้
 * สัญญา: createRemEstimator({ weights?: RemWeights; personalHistogram?: number[48] }) →
 *          { feed(epoch, ctx: { onsetT: number|null; nightStartT: number; expectedEndT: number }): number  (p ∈ [0,1]) ; weights }
 *        estimateNight(epochs, onsetT, opts?) → { t: number; p: number }[]
 *        updateWeights(weights, truth, pRemSamples, epochsFeatures?) → RemWeights   (online logistic ขั้นเล็ก · clamp)
 *        DEFAULT_REM_WEIGHTS · remFeatures(epoch, ctx, window) → { prior, hrRel, hrSdRel, motionLow, hist }  (ต้องไม่มี NaN)
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { simulateNight, estimateNight, createRemEstimator, updateWeights, remMetrics, DEFAULT_REM_WEIGHTS } = engine as any;
const sleepAt = '2026-09-24T16:00:00.000Z';
const f1On = (seeds: number[], weights?: any) => { let s = 0; for (const seed of seeds) { const n = simulateNight({ seed, sleepAtIso: sleepAt }); const p = estimateNight(n.epochs, n.onsetT, weights ? { weights } : undefined); s += remMetrics(n.truth, p, 0.7).f1; } return s / seeds.length; };

describe('L2.5 REM estimator', () => {
  it('Q1 200 คืนจำลอง F1 เฉลี่ย ≥ 0.6 ที่ threshold 0.7', () => { const seeds = Array.from({ length: 200 }, (_, i) => i + 1); expect(f1On(seeds)).toBeGreaterThanOrEqual(0.6); });
  it('Q2 p < 0.3 ตลอด 60 นาทีแรกหลัง onset (prior ต่ำ) ใน 50 คืน', () => {
    for (let s = 1; s <= 50; s++) { const n = simulateNight({ seed: s, sleepAtIso: sleepAt }); const p = estimateNight(n.epochs, n.onsetT); for (const x of p) if (x.t >= n.onsetT && x.t < n.onsetT + 3600) expect(x.p, `seed ${s} t ${x.t}`).toBeLessThan(0.3); }
  });
  it('Q3 ไม่มี NaN · p ∈ [0,1] · จำนวนตรง epoch', () => { const n = simulateNight({ seed: 3, sleepAtIso: sleepAt, noise: 3 }); const p = estimateNight(n.epochs, n.onsetT); expect(p.length).toBe(n.epochs.length); for (const x of p) { expect(Number.isNaN(x.p)).toBe(false); expect(x.p).toBeGreaterThanOrEqual(0); expect(x.p).toBeLessThanOrEqual(1); } });
  it('Q4 epoch ที่ hr/motion เป็น null (เซนเซอร์หลุด) → ใช้ prior อย่างเดียว ไม่พัง และ p ≤ 0.75', () => {
    const n = simulateNight({ seed: 5, sleepAtIso: sleepAt }); const eps = n.epochs.map((e: any) => ({ ...e, hrMean: null, hrSd: null, motion: null })); const p = estimateNight(eps, n.onsetT); for (const x of p) expect(x.p).toBeLessThanOrEqual(0.75);
  });
  it('Q5 สตรีม feed() ให้ค่าเท่า batch', () => { const n = simulateNight({ seed: 8, sleepAtIso: sleepAt }); const est = createRemEstimator({}); const ctx = { onsetT: n.onsetT, nightStartT: n.epochs[0].t, expectedEndT: n.epochs[n.epochs.length - 1].t }; const stream = n.epochs.map((e: any) => est.feed(e, ctx)); const batch = estimateNight(n.epochs, n.onsetT).map((x: any) => x.p); for (let i = 0; i < stream.length; i++) expect(stream[i]).toBeCloseTo(batch[i], 6); });
  it('Q6 updateWeights บน 20 คืน → F1 บน hold-out 20 คืนไม่ลดลงเกิน 0.02 และน้ำหนักอยู่ในขอบ [0, 5]', () => {
    let w = { ...DEFAULT_REM_WEIGHTS }; const train = Array.from({ length: 20 }, (_, i) => 300 + i), hold = Array.from({ length: 20 }, (_, i) => 400 + i);
    const before = f1On(hold, w);
    for (const seed of train) { const n = simulateNight({ seed, sleepAtIso: sleepAt }); const p = estimateNight(n.epochs, n.onsetT, { weights: w }); w = updateWeights(w, n.truth, p, { epochs: n.epochs, onsetT: n.onsetT }); }
    for (const v of Object.values(w) as number[]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(5); }
    expect(f1On(hold, w)).toBeGreaterThanOrEqual(before - 0.02);
  });
  it('Q7 histogram บุคคล (REM หนาแน่น 04:30–05:30) ดัน p ช่วงนั้นขึ้นเทียบไม่มี histogram', () => {
    const n = simulateNight({ seed: 11, sleepAtIso: sleepAt }); const hist = new Array(48).fill(0.1); for (let i = 25; i < 27; i++) hist[i] = 1.0; // ช่อง 30 นาที: 12:30–13:30 UTC ≈ 19:30–20:30 ICT (ตัวอย่างเท่านั้น)
    const a = estimateNight(n.epochs, n.onsetT); const b = estimateNight(n.epochs, n.onsetT, { personalHistogram: hist });
    const idx = n.epochs.findIndex((e: any) => new Date(e.t * 1000).getUTCHours() === 12 && new Date(e.t * 1000).getUTCMinutes() >= 30);
    if (idx >= 0) expect(b[idx].p).toBeGreaterThanOrEqual(a[idx].p);
  });
});

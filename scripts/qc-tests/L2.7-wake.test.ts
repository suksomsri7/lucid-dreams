/**
 * ข้อสอบ L2.7 — ตัวจับตื่น + โหมดตัวจับเวลา · builder ห้ามแก้
 * สัญญา: createWakeDetector({ motionHigh?: 0.05, hrJump?: 0.20 }) → { feed(epoch): { awake: boolean; cause: 'MOTION'|'HR'|null; since: number|null } ; reset() }
 *        detectWakeBouts(epochs) → { startT: number; endT: number; cause: string }[]
 *        timerModeParams(params) → NightParams  (remThreshold 0.75 · maxCuesPerNight 4 · source TIMER)
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { simulateNight, detectWakeBouts, createWakeDetector, timerModeParams, DEFAULT_NIGHT_PARAMS } = engine as any;
const sleepAt = '2026-09-24T16:00:00.000Z';
const truthBouts = (n: any) => { const b: any[] = []; let cur: any = null; n.truth.forEach((s: any, i: number) => { const w = s.stage === 'WAKE' && s.t > n.onsetT && i < n.truth.length - 12; if (w && !cur) cur = { startT: s.t, endT: s.t }; else if (w && cur) cur.endT = s.t; else if (!w && cur) { b.push(cur); cur = null; } }); return b; };

describe('L2.7 wake detector', () => {
  it('W1 200 คืน × 3 ตื่น: จับได้ ≥ 90% (ทับซ้อนช่วงเฉลย ±2 นาที)', () => {
    let hit = 0, total = 0;
    for (let s = 1; s <= 200; s++) { const n = simulateNight({ seed: s, sleepAtIso: sleepAt, wakeCount: 3 }); const det = detectWakeBouts(n.epochs); for (const tb of truthBouts(n)) { total++; if (det.some((d: any) => d.startT <= tb.endT + 120 && d.endT >= tb.startT - 120)) hit++; } }
    expect(total).toBeGreaterThan(400); expect(hit / total).toBeGreaterThanOrEqual(0.9);
  });
  it('W2 false alarm: คืนที่ไม่มีตื่นกลางคืน (wakeCount 0) 200 คืน → เฉลี่ยจับผิด ≤ 0.3 ครั้ง/คืน (พลิกตัว < 20 วิ ไม่นับ)', () => {
    let fa = 0; for (let s = 1; s <= 200; s++) { const n = simulateNight({ seed: s + 1000, sleepAtIso: sleepAt, wakeCount: 0 }); fa += detectWakeBouts(n.epochs).filter((d: any) => d.startT > n.onsetT && d.endT < n.epochs[n.epochs.length - 13].t).length; }
    expect(fa / 200).toBeLessThanOrEqual(0.3);
  });
  it('W3 กฎขยับ: motion สูง 2 epoch ติด (60 วิ) → awake · 1 epoch → ไม่', () => {
    const d = createWakeDetector({}); const q = (t: number) => ({ t, hrMean: 58, hrSd: 2, motion: 0.003, battery: 1, source: 'WATCH' }); const m = (t: number) => ({ ...q(t), motion: 0.4 });
    for (let i = 0; i < 20; i++) d.feed(q(i * 30));
    expect(d.feed(m(600)).awake).toBe(false); expect(d.feed(q(630)).awake).toBe(false);
    expect(d.feed(m(660)).awake).toBe(false); const r = d.feed(m(690)); expect(r.awake).toBe(true); expect(r.cause).toBe('MOTION');
  });
  it('W4 กฎ HR: พุ่ง ≥ 20% ใน 60 วิ และคง 2 นาที → awake cause HR · พุ่งแล้วลงทันที → ไม่', () => {
    const d = createWakeDetector({}); const q = (t: number, hr = 55) => ({ t, hrMean: hr, hrSd: 2, motion: 0.003, battery: 1, source: 'WATCH' });
    for (let i = 0; i < 20; i++) d.feed(q(i * 30));
    d.feed(q(600, 70)); d.feed(q(630, 56)); expect(d.feed(q(660, 55)).awake).toBe(false);
    d.feed(q(690, 70)); d.feed(q(720, 70)); d.feed(q(750, 70)); const r = d.feed(q(780, 70)); expect(r.awake).toBe(true); expect(r.cause).toBe('HR');
  });
  it('W5 epoch null (เซนเซอร์หลุด) ไม่ทำให้ตื่นและไม่พัง', () => { const d = createWakeDetector({}); for (let i = 0; i < 10; i++) expect(d.feed({ t: i * 30, hrMean: null, hrSd: null, motion: null, battery: null, source: 'TIMER' }).awake).toBe(false); });
  it('W6 timerModeParams: threshold 0.75 · maxCuesPerNight 4 · ค่าอื่นคงเดิม', () => { const p = timerModeParams(DEFAULT_NIGHT_PARAMS); expect(p.remThreshold).toBe(0.75); expect(p.maxCuesPerNight).toBe(4); expect(p.guardHours).toBe(DEFAULT_NIGHT_PARAMS.guardHours); });
});

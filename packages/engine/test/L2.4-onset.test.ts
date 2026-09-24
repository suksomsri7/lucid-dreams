/**
 * ข้อสอบ L2.4 — ตัวจับหลับ (onset) + ตารางกระซิบเมล็ด + เฟดเสียงพื้น · วางที่ packages/engine/test/ · builder ห้ามแก้
 * สัญญา: createOnsetDetector({ noSensorTimeoutSec?: 1500 }) → { feed(epoch): { onset: boolean; onsetT: number|null; baselineHr: number|null }, onsetT }
 *        detectOnset(epochs) → { onsetT: number|null; baselineHr: number|null }   (batch = feed ทีละตัว)
 *        seedWhisperTimes(startT) → number[]  ([startT+180, startT+480])
 *        bedVolumePlan(startT, onsetT|null, nowT, {full=0.20, bed=0.08, fadeSec=60}) → number (เฟดเชิงเส้นหลัง onset)
 *        guardUntil(onsetT, guardHours) → number  (ห้าม < 2 ชม.)
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { simulateNight, createOnsetDetector, detectOnset, seedWhisperTimes, bedVolumePlan, guardUntil } = engine as any;
const sleepAt = '2026-09-24T16:00:00.000Z';

describe('L2.4 onset', () => {
  it('N1 200 คืนจำลอง: onset คลาดจากเฉลย ≤ 10 นาที ใน ≥ 90%', () => {
    let ok = 0, found = 0;
    for (let s = 1; s <= 200; s++) { const n = simulateNight({ seed: s, sleepAtIso: sleepAt, durationMin: 420 }); const r = detectOnset(n.epochs); if (r.onsetT != null) { found++; if (Math.abs(r.onsetT - n.onsetT) <= 600) ok++; } }
    expect(found).toBeGreaterThanOrEqual(195); expect(ok / 200).toBeGreaterThanOrEqual(0.9);
  });
  it('N2 สตรีมทีละ epoch ให้ผลเท่า batch และไม่ประกาศ onset ก่อนมีข้อมูล ≥ 15 นาที', () => {
    const n = simulateNight({ seed: 7, sleepAtIso: sleepAt }); const d = createOnsetDetector({}); let firstOnsetIdx = -1;
    n.epochs.forEach((e: any, i: number) => { const r = d.feed(e); if (r.onset && firstOnsetIdx < 0) firstOnsetIdx = i; });
    expect(firstOnsetIdx).toBeGreaterThanOrEqual(30); expect(d.onsetT).toBe(detectOnset(n.epochs).onsetT);
  });
  it('N3 ไม่มีเซนเซอร์ (epoch ว่าง hr/motion null ทุกตัว) → onset = start + 25 นาที', () => {
    const t0 = 1758729600; const eps = Array.from({ length: 80 }, (_, i) => ({ t: t0 + i * 30, hrMean: null, hrSd: null, motion: null, battery: null, source: 'TIMER' }));
    expect(detectOnset(eps).onsetT).toBe(t0 + 1500);
  });
  it('N4 คนที่ขยับตลอด (ไม่หลับ) 2 ชม. → ไม่มี onset', () => {
    const t0 = 1758729600; const eps = Array.from({ length: 240 }, (_, i) => ({ t: t0 + i * 30, hrMean: 70 + (i % 3), hrSd: 5, motion: 0.3, battery: 0.9, source: 'WATCH' }));
    expect(detectOnset(eps).onsetT).toBeNull();
  });
  it('N5 seedWhisperTimes = +3 และ +8 นาที', () => { expect(seedWhisperTimes(1000)).toEqual([1180, 1480]); });
  it('N6 bedVolumePlan: ก่อน onset = 0.20 · หลัง onset 60 วิ เฟดถึง 0.08 · ระหว่างทางลดลง', () => {
    expect(bedVolumePlan(0, null, 500, {})).toBeCloseTo(0.20); expect(bedVolumePlan(0, 1000, 1000, {})).toBeCloseTo(0.20);
    const mid = bedVolumePlan(0, 1000, 1030, {}); expect(mid).toBeLessThan(0.20); expect(mid).toBeGreaterThan(0.08);
    expect(bedVolumePlan(0, 1000, 1100, {})).toBeCloseTo(0.08);
  });
  it('N7 guardUntil ไม่มีทางสั้นกว่า 2 ชม.', () => { expect(guardUntil(1000, 3)).toBe(1000 + 3 * 3600); expect(guardUntil(1000, 1)).toBe(1000 + 2 * 3600); expect(guardUntil(1000, 0)).toBe(1000 + 2 * 3600); });
});

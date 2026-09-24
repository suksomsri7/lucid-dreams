/**
 * ข้อสอบ L2.1 — engine แกน + ตัวจำลองคืน (Fable เขียนก่อน builder · builder ห้ามแก้)
 * วางที่ packages/engine/test/L2.1-simulate.test.ts ตอน spawn
 * สัญญา API ที่ builder ต้องทำให้มี (export จาก packages/engine/src/index.ts):
 *   simulateNight(opts: { seed: number; sleepAtIso: string; durationMin?: number; cycleMin?: number;
 *                         cycleJitterMin?: number; wakeCount?: number; noise?: number })
 *     → { epochs: SensorEpoch[]; truth: { t: number; stage: 'WAKE'|'N1'|'N2'|'N3'|'REM' }[]; onsetT: number }
 *   replayNight(diag: DiagnosticsExport) → SensorEpoch[]           (normalize + sort + dedupe)
 *   remMetrics(truth, pRem: { t: number; p: number }[], threshold?: number)
 *     → { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';

const { simulateNight, replayNight, remMetrics, buildDiagnosticsExport, fixedClock } = engine as any;

const base = { seed: 42, sleepAtIso: '2026-09-24T16:00:00.000Z', durationMin: 480 };

describe('L2.1 simulateNight', () => {
  it('E1 seed เดียวกัน = ผลเท่ากันทุกไบต์', () => {
    const a = simulateNight(base), b = simulateNight(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('E2 seed ต่างกัน = ผลต่างกัน', () => {
    expect(JSON.stringify(simulateNight({ ...base, seed: 1 }))).not.toBe(JSON.stringify(simulateNight({ ...base, seed: 2 })));
  });
  it('E3 เฉลยครอบคลุมทุก epoch (t ตรงกัน 1:1) และ epoch อยู่บนกริด 30 วิ', () => {
    const n = simulateNight(base);
    expect(n.truth.length).toBe(n.epochs.length);
    expect(n.epochs.length).toBe(480 * 2);
    for (let i = 0; i < n.epochs.length; i++) {
      expect(n.epochs[i].t % 30).toBe(0);
      expect(n.truth[i].t).toBe(n.epochs[i].t);
      if (i > 0) expect(n.epochs[i].t - n.epochs[i - 1].t).toBe(30);
    }
  });
  it('E4 สัดส่วน REM ทั้งคืน 15–30% · WAKE ≤ 12% · มี N3', () => {
    const n = simulateNight(base);
    const c: Record<string, number> = {};
    for (const s of n.truth) c[s.stage] = (c[s.stage] ?? 0) + 1;
    const total = n.truth.length;
    expect(c.REM / total).toBeGreaterThan(0.15); expect(c.REM / total).toBeLessThan(0.30);
    expect((c.WAKE ?? 0) / total).toBeLessThanOrEqual(0.12);
    expect(c.N3 ?? 0).toBeGreaterThan(0);
  });
  it('E5 REM ครั้งแรกไม่ก่อน 60 นาทีหลัง onset และ REM ครึ่งหลัง > ครึ่งแรก', () => {
    const n = simulateNight(base);
    const firstRem = n.truth.find((s: any) => s.stage === 'REM');
    expect(firstRem.t - n.onsetT).toBeGreaterThanOrEqual(60 * 60);
    const mid = n.truth[Math.floor(n.truth.length / 2)].t;
    const remA = n.truth.filter((s: any) => s.stage === 'REM' && s.t < mid).length;
    const remB = n.truth.filter((s: any) => s.stage === 'REM' && s.t >= mid).length;
    expect(remB).toBeGreaterThan(remA);
  });
  it('E6 สรีระ: HR เฉลี่ยใน N3 < REM · ขยับใน WAKE > REM · REM เกือบนิ่ง', () => {
    const n = simulateNight({ ...base, wakeCount: 2 });
    const by = (st: string, k: string) => { const v = n.epochs.filter((_: any, i: number) => n.truth[i].stage === st).map((e: any) => e[k]).filter((x: any) => x != null); return v.reduce((a: number, b: number) => a + b, 0) / v.length; };
    expect(by('N3', 'hrMean')).toBeLessThan(by('REM', 'hrMean'));
    expect(by('WAKE', 'motion')).toBeGreaterThan(by('REM', 'motion') * 3);
    expect(by('REM', 'hrSd')).toBeGreaterThan(by('N3', 'hrSd'));
  });
  it('E7 wakeCount สร้างช่วง WAKE กลางคืนตามจำนวน (±1)', () => {
    const n = simulateNight({ ...base, wakeCount: 3 });
    let bouts = 0;
    for (let i = 1; i < n.truth.length; i++) if (n.truth[i].stage === 'WAKE' && n.truth[i - 1].stage !== 'WAKE' && n.truth[i].t - n.onsetT > 600) bouts++;
    expect(Math.abs(bouts - 3)).toBeLessThanOrEqual(1);
  });
  it('E8 ทุก epoch ผ่าน SensorEpochSchema (HR 25–220 · battery 0–1) และไม่มี NaN', () => {
    const n = simulateNight({ ...base, noise: 3 });
    for (const e of n.epochs) {
      const r = engine.SensorEpochSchema.safeParse(e);
      expect(r.success, JSON.stringify(e)).toBe(true);
      expect(Number.isNaN(e.hrMean ?? 0)).toBe(false);
    }
  });
  it('E9 200 คืนสุ่ม ไม่มีคืนไหนพัง (สมบัติพื้นฐานคงอยู่)', () => {
    for (let s = 1; s <= 200; s++) {
      const n = simulateNight({ seed: s, sleepAtIso: base.sleepAtIso, durationMin: 420 + (s % 4) * 30 });
      expect(n.epochs.length).toBe(n.truth.length);
      const rem = n.truth.filter((x: any) => x.stage === 'REM').length / n.truth.length;
      expect(rem).toBeGreaterThan(0.10); expect(rem).toBeLessThan(0.35);
    }
  });
});

describe('L2.1 replayNight', () => {
  it('E10 เล่นซ้ำจาก diagnostics ได้ epoch เท่าไฟล์ เรียงเวลา ไม่ซ้ำ ตัดค่านอกช่วง', () => {
    const n = simulateNight(base);
    const messy = [...n.epochs].reverse();
    messy.push({ ...n.epochs[10] }); // ซ้ำ
    messy.push({ ...n.epochs[11], hrMean: 300 } as any); // นอกช่วง (schema จะไม่รับ → replay ต้องทิ้งไม่ใช่พัง)
    const diag = { schemaVersion: 1, appVersion: 't', buildNumber: null, exportedAt: '2026-09-25T00:00:00.000Z',
      device: { platform: 'ios', osVersion: '26.0', model: 'iPhone', modelName: null, watchModel: null, watchPaired: true, locale: 'th' },
      sensors: [], epochs: messy, audioEvents: [], batterySamples: [], warnings: [] };
    const out = replayNight(diag);
    expect(out.length).toBe(n.epochs.length);
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
  });
});

describe('L2.1 remMetrics', () => {
  const truth = [0, 30, 60, 90, 120, 150].map((t, i) => ({ t, stage: i >= 3 ? 'REM' : 'N2' }));
  it('E11 ทายถูกหมด = p/r/f1 = 1', () => {
    const p = truth.map((s) => ({ t: s.t, p: s.stage === 'REM' ? 0.9 : 0.1 }));
    const m = remMetrics(truth, p, 0.7);
    expect(m).toMatchObject({ tp: 3, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 });
  });
  it('E12 ทายเป็น REM ทุกช่วง = recall 1 precision 0.5', () => {
    const p = truth.map((s) => ({ t: s.t, p: 0.95 }));
    const m = remMetrics(truth, p, 0.7);
    expect(m.recall).toBe(1); expect(m.precision).toBeCloseTo(0.5); expect(m.f1).toBeCloseTo(2 / 3);
  });
  it('E13 ไม่ทาย REM เลย = recall 0 · ไม่มี NaN', () => {
    const p = truth.map((s) => ({ t: s.t, p: 0.1 }));
    const m = remMetrics(truth, p, 0.7);
    expect(m.recall).toBe(0); expect(Number.isNaN(m.precision)).toBe(false); expect(Number.isNaN(m.f1)).toBe(false);
  });
  it('E14 p ที่ไม่มี t ตรงเฉลยถูกข้าม (ไม่นับ fp)', () => {
    const p = [...truth.map((s) => ({ t: s.t, p: s.stage === 'REM' ? 0.9 : 0.1 })), { t: 9999, p: 0.99 }];
    expect(remMetrics(truth, p, 0.7).fp).toBe(0);
  });
});

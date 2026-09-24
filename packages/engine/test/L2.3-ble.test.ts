/**
 * ข้อสอบ L2.3 (ส่วน engine) — parser Bluetooth Heart Rate Measurement (0x2A37) + RR→HRV + SensorHub รวมหลายแหล่ง · builder ห้ามแก้
 * สัญญา: parseHeartRateMeasurement(bytes: Uint8Array) → { bpm: number; sensorContact: boolean|null; energyKj?: number|null; rrMs: number[] } | null (ทิ้งถ้าสั้นเกิน/นอกช่วง 25–220)
 *        rmssd(rrMs: number[]) → number|null (ต้อง ≥ 2 ค่า) · sdnn(rrMs) → number|null
 *        createSensorHub({ epochSeconds=30 }) → { push(sourceId, sample: { t: number; bpm?: number; rrMs?: number[]; motion?: number; battery?: number|null; source: SensorSourceKind }), closeEpoch(t): SensorEpoch|null, sources(): string[] }
 *          - รวมทุกแหล่งใน epoch เดียว: hrMean = ค่าเฉลี่ยถ่วงจำนวน sample · hrSd จาก RR ถ้ามี (rmssd/1000*… หรือ sd ของ bpm) · motion = max · battery = min ที่ไม่ null · source = แหล่งที่ให้ HR มากสุด
 *          - dedupe: sample ที่ t เท่ากันจาก source เดียวกันนับครั้งเดียว · bpm นอก 25–220 ทิ้ง
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { parseHeartRateMeasurement, rmssd, sdnn, createSensorHub } = engine as any;
const u8 = (...b: number[]) => new Uint8Array(b);

describe('L2.3 BLE HRM parser', () => {
  it('B1 flags=0x00 bpm 8 บิต', () => { expect(parseHeartRateMeasurement(u8(0x00, 62))).toMatchObject({ bpm: 62, rrMs: [] }); });
  it('B2 flags=0x01 bpm 16 บิต little-endian · 300 bpm นอกช่วง → null', () => { expect(parseHeartRateMeasurement(u8(0x01, 0x2c, 0x01))).toBeNull(); expect(parseHeartRateMeasurement(u8(0x01, 0x3e, 0x00)).bpm).toBe(62); });
  it('B3 sensor contact bits (0x06 = supported+contact · 0x04 = supported ไม่สัมผัส · 0x00 = ไม่รองรับ → null)', () => {
    expect(parseHeartRateMeasurement(u8(0x06, 60)).sensorContact).toBe(true); expect(parseHeartRateMeasurement(u8(0x04, 60)).sensorContact).toBe(false); expect(parseHeartRateMeasurement(u8(0x00, 60)).sensorContact).toBeNull();
  });
  it('B4 energy expended (0x08) 2 ไบต์ แล้วตามด้วย RR', () => { const r = parseHeartRateMeasurement(u8(0x18, 60, 0x10, 0x00, 0x00, 0x04)); expect(r.energyKj).toBe(16); expect(r.rrMs).toEqual([1000]); });
  it('B5 RR หลายค่า (1/1024 วินาที) แปลงเป็น ms', () => { const r = parseHeartRateMeasurement(u8(0x10, 60, 0x00, 0x04, 0x33, 0x03)); expect(r.rrMs.length).toBe(2); expect(r.rrMs[0]).toBeCloseTo(1000, 0); expect(r.rrMs[1]).toBeCloseTo(799.8, 0); });
  it('B6 ไบต์สั้นเกิน/ว่าง → null · bpm 0 หรือ 250 → null', () => { expect(parseHeartRateMeasurement(u8())).toBeNull(); expect(parseHeartRateMeasurement(u8(0x01, 0x3e))).toBeNull(); expect(parseHeartRateMeasurement(u8(0x00, 0))).toBeNull(); expect(parseHeartRateMeasurement(u8(0x00, 250))).toBeNull(); });
  it('B7 rmssd/sdnn ถูกและ null เมื่อข้อมูลไม่พอ', () => { expect(rmssd([1000, 1000, 1000])).toBe(0); expect(rmssd([1000, 1100, 1000])).toBeCloseTo(100, 5); expect(rmssd([1000])).toBeNull(); expect(sdnn([900, 1100])).toBeCloseTo(100, 5); });
});

describe('L2.3 SensorHub', () => {
  it('H1 รวม Watch + สายคาดอก ใน epoch เดียว · hrMean ถ่วงจำนวน · motion max · battery min · dedupe', () => {
    const hub = createSensorHub({}); const t0 = 1758750000;
    for (let i = 0; i < 30; i++) hub.push('watch', { t: t0 + i, bpm: 60, motion: 0.01, battery: 0.8, source: 'WATCH' });
    for (let i = 0; i < 30; i++) { hub.push('strap', { t: t0 + i, bpm: 64, rrMs: [937, 940], battery: 0.5, source: 'BLE_HR' }); hub.push('strap', { t: t0 + i, bpm: 64, rrMs: [937, 940], battery: 0.5, source: 'BLE_HR' }); }
    hub.push('phone', { t: t0 + 5, motion: 0.2, source: 'PHONE_MOTION' });
    const e = hub.closeEpoch(t0 + 30);
    expect(e.t).toBe(t0); expect(e.hrMean).toBeCloseTo(62, 5); expect(e.motion).toBeCloseTo(0.2, 5); expect(e.battery).toBeCloseTo(0.5, 5); expect(e.hrSd).toBeGreaterThan(0); expect(hub.sources().sort()).toEqual(['phone', 'strap', 'watch']);
  });
  it('H2 ไม่มี sample ใน epoch → null · bpm นอกช่วงถูกทิ้ง · epoch ถัดไปเริ่มนับใหม่', () => {
    const hub = createSensorHub({}); const t0 = 1758750000;
    expect(hub.closeEpoch(t0 + 30)).toBeNull();
    hub.push('w', { t: t0 + 31, bpm: 300, source: 'WATCH' }); hub.push('w', { t: t0 + 32, bpm: 58, source: 'WATCH' });
    const e = hub.closeEpoch(t0 + 60); expect(e.hrMean).toBe(58); expect(hub.closeEpoch(t0 + 90)).toBeNull();
  });
  it('H3 epoch ที่ออกผ่าน SensorEpochSchema เสมอ', () => { const hub = createSensorHub({}); for (let i = 0; i < 10; i++) hub.push('w', { t: 1000 + i, bpm: 70 + i, motion: 0.001, battery: 0.9, source: 'WATCH' }); const e = hub.closeEpoch(1020); expect(engine.SensorEpochSchema.safeParse(e).success).toBe(true); });
});

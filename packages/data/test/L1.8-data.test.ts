/**
 * ข้อสอบ L1.8 — ชั้นข้อมูล packages/data (Fable เขียนก่อน builder · builder ห้ามแก้)
 * วางที่ packages/data/test/L1.8-data.test.ts ตอน spawn · รันด้วย sql.js (wasm) บน VPS
 * สัญญา API (export จาก packages/data/src/index.ts):
 *   createSqlJsDriver(): Promise<DbDriver> · migrate(db): Promise<{version}> · SCHEMA_VERSION · TABLES (12 ชื่อ)
 *   createRepo(db, clock): Repo · SENSITIVE_FIELDS: string[]
 *   Repo.sessions.create({dateIso, themeKey, mode:'CUE'|'CONTROL', params}) → {id,...}
 *   Repo.sessions.appendEpoch(id, SensorEpoch) · appendCue(id, {at, index, volume, type, pRemAtCue, played, response})
 *   Repo.sessions.appendWake(id, {at, durationSec, cause}) · finish(id, endedAtIso)
 *   Repo.earTests.record({sessionId, side:'L'|'R', rounds, answer, attempts, volume})
 *   Repo.reports.save({sessionId, dreamed?, themeMatchUser?, lucid?, sleepQuality?, cueWoke?, transcript?, audioPath?})
 *   Repo.applePhases.saveMany(sessionId, [{startIso,endIso,stage}]) · Repo.ai.save({reportId, themeMatch, matchedTerms, lucidSignals, tags, summary, model})
 *   Repo.nightReport(id) → {session, epochs, cues, wakes, applePhases, report, aiScore, earTests, events: {at, kind, ...}[] เรียงเวลา}
 *   Repo.lastNights(n) · Repo.stats(n) → {nights, cueNights, controlNights, lucidRateCue, lucidRateControl, themeMatchAvg}
 *   Repo.exportJson() · Repo.importJson(obj) · Repo.exportCsv(table) → string · Repo.deleteAll()
 *   Repo.diagnosticsDraft({includeText:boolean}) → object (ไม่มี transcript/audioPath เมื่อ false)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as dataIndex from '../src/index';
import * as sqljs from '../src/sqljs';
const data = { ...dataIndex, ...sqljs };

const { createSqlJsDriver, migrate, SCHEMA_VERSION, TABLES, createRepo, SENSITIVE_FIELDS } = data as any;
const clock = { now: () => new Date('2026-09-24T22:00:00.000Z'), nowIso: () => '2026-09-24T22:00:00.000Z' };
const epoch = (t: number, hr = 60) => ({ t, hrMean: hr, hrSd: 2, motion: 0.01, battery: 0.8, source: 'WATCH' });

let db: any, repo: any;
beforeEach(async () => { db = await createSqlJsDriver(); await migrate(db); repo = createRepo(db, clock); });

async function seedNight(mode: 'CUE' | 'CONTROL', lucid: 'YES' | 'NO' | 'UNSURE', themeMatch: number, date = '2026-09-24') {
  const s = await repo.sessions.create({ dateIso: date, themeKey: 'whale', mode, params: { volumeStart: 0.15 } });
  for (let i = 0; i < 20; i++) await repo.sessions.appendEpoch(s.id, epoch(1758750000 + i * 30));
  await repo.sessions.appendCue(s.id, { at: '2026-09-24T20:12:00.000Z', index: 1, volume: 0.15, type: 'WHISPER', pRemAtCue: 0.74, played: mode === 'CUE', response: 'NONE' });
  await repo.sessions.appendWake(s.id, { at: '2026-09-24T21:05:00.000Z', durationSec: 180, cause: 'MOTION' });
  await repo.earTests.record({ sessionId: s.id, side: 'L', rounds: 3, answer: 3, attempts: 1, volume: 0.15 });
  await repo.earTests.record({ sessionId: s.id, side: 'R', rounds: 4, answer: 4, attempts: 1, volume: 0.15 });
  await repo.sessions.finish(s.id, '2026-09-24T23:51:00.000Z');
  await repo.reports.save({ sessionId: s.id, dreamed: 8, themeMatchUser: themeMatch, lucid, sleepQuality: 7, cueWoke: false, transcript: 'ผมอยู่ใต้น้ำ มีตัวใหญ่ว่ายผ่าน', audioPath: '/tmp/a.m4a' });
  return s;
}

describe('L1.8 schema', () => {
  it('D1 migrate สร้าง 12 ตารางครบ', async () => {
    const need = ['UserProfile', 'Theme', 'NightSession', 'SensorEpoch', 'CueEvent', 'WakeEvent', 'AppleSleepPhase', 'MorningReport', 'AiScore', 'RealityCheck', 'PersonalModel', 'EarTest'];
    expect([...TABLES].sort()).toEqual([...need].sort());
    const rows = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    for (const t of need) expect(rows.map((r: any) => r.name)).toContain(t);
  });
  it('D2 migrate ซ้ำ idempotent · D3 schemaVersion บันทึก', async () => {
    const a = await migrate(db); const b = await migrate(db);
    expect(a.version).toBe(SCHEMA_VERSION); expect(b.version).toBe(SCHEMA_VERSION);
  });
  it('D18 มี index (sessionId,t) บน SensorEpoch', async () => {
    const idx = await db.all("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='SensorEpoch'");
    expect(idx.some((r: any) => /sessionId/i.test(r.sql ?? '') && /\bt\b/.test(r.sql ?? ''))).toBe(true);
  });
});

describe('L1.8 repo', () => {
  it('D4/D5 บันทึกคืน + cue enum + played', async () => {
    const s = await seedNight('CUE', 'YES', 8);
    const r = await repo.nightReport(s.id);
    expect(r.epochs.length).toBe(20); expect(r.cues[0].response).toBe('NONE'); expect(r.cues[0].played).toBe(true);
    await expect(repo.sessions.appendCue(s.id, { at: '2026-09-24T20:13:00.000Z', index: 2, volume: 0.15, type: 'WHISPER', pRemAtCue: 0.7, played: true, response: 'BAD' })).rejects.toThrow();
  });
  it('D6 EarTest 2 แถวต่อคืน unique(session, side)', async () => {
    const s = await seedNight('CUE', 'YES', 8);
    const r = await repo.nightReport(s.id);
    expect(r.earTests.map((e: any) => e.side).sort()).toEqual(['L', 'R']);
    await repo.earTests.record({ sessionId: s.id, side: 'L', rounds: 2, answer: 2, attempts: 2, volume: 0.18 });
    expect((await repo.nightReport(s.id)).earTests.length).toBe(2); // ทับไม่เพิ่ม
  });
  it('D7 MorningReport ฟิลด์ null ได้', async () => {
    const s = await repo.sessions.create({ dateIso: '2026-09-25', themeKey: 'fly', mode: 'CUE', params: {} });
    await repo.reports.save({ sessionId: s.id });
    expect((await repo.nightReport(s.id)).report.lucid).toBeNull();
  });
  it('D8 nightReport.events รวมทุกตารางเรียงเวลา', async () => {
    const s = await seedNight('CUE', 'YES', 8);
    const r = await repo.nightReport(s.id);
    const at = r.events.map((e: any) => e.at);
    expect([...at].sort()).toEqual(at);
    expect(r.events.some((e: any) => e.kind === 'CUE')).toBe(true);
    expect(r.events.some((e: any) => e.kind === 'WAKE')).toBe(true);
  });
  it('D9 lastNights เรียงล่าสุดก่อน · D10 stats', async () => {
    await seedNight('CUE', 'YES', 8, '2026-09-21'); await seedNight('CUE', 'NO', 6, '2026-09-22');
    await seedNight('CONTROL', 'NO', 4, '2026-09-23'); await seedNight('CUE', 'UNSURE', 7, '2026-09-24');
    const last = await repo.lastNights(3);
    expect(last.length).toBe(3); expect(last[0].dateIso).toBe('2026-09-24');
    const st = await repo.stats(30);
    expect(st.nights).toBe(4); expect(st.cueNights).toBe(3); expect(st.controlNights).toBe(1);
    expect(st.lucidRateCue).toBeCloseTo((1 + 0 + 0.3) / 3, 5); expect(st.lucidRateControl).toBe(0);
    expect(st.themeMatchAvg).toBeCloseTo(25 / 4, 5);
  });
});

describe('L1.8 export/import/delete/privacy', () => {
  it('D11 export JSON → import กลับ เท่าเดิม', async () => {
    await seedNight('CUE', 'YES', 8);
    const dump = await repo.exportJson();
    const db2 = await createSqlJsDriver(); await migrate(db2); const repo2 = createRepo(db2, clock);
    await repo2.importJson(dump);
    expect(JSON.stringify(await repo2.exportJson())).toBe(JSON.stringify(dump));
  });
  it('D12 export CSV header ถูก', async () => {
    await seedNight('CUE', 'YES', 8);
    const csv = await repo.exportCsv('CueEvent');
    const header = csv.split('\n')[0];
    for (const c of ['sessionId', 'at', 'volume', 'response']) expect(header).toContain(c);
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });
  it('D13 deleteAll → ทุกตารางว่าง · schemaVersion คง', async () => {
    await seedNight('CUE', 'YES', 8);
    await repo.deleteAll();
    for (const t of TABLES) expect((await db.all(`SELECT COUNT(*) AS n FROM "${t}"`))[0].n).toBe(0);
    expect((await migrate(db)).version).toBe(SCHEMA_VERSION);
  });
  it('D14 diagnostics ค่าเริ่มต้นไม่มี transcript/audioPath · เปิดสวิตช์จึงมี', async () => {
    await seedNight('CUE', 'YES', 8);
    const off = JSON.stringify(await repo.diagnosticsDraft({ includeText: false }));
    expect(off).not.toContain('ใต้น้ำ'); expect(off).not.toContain('/tmp/a.m4a');
    const on = JSON.stringify(await repo.diagnosticsDraft({ includeText: true }));
    expect(on).toContain('ใต้น้ำ');
  });
  it('D15 เวลาเก็บเป็น ISO UTC (ลงท้าย Z)', async () => {
    const s = await seedNight('CUE', 'YES', 8);
    const rows = await db.all('SELECT at FROM CueEvent WHERE sessionId = ?', [s.id]);
    expect(rows[0].at).toMatch(/Z$/);
  });
  it('D17 SENSITIVE_FIELDS ประกาศครบ', () => {
    for (const f of ['transcript', 'audioPath', 'summary']) expect(SENSITIVE_FIELDS).toContain(f);
  });
  it('D19 transaction rollback เมื่อ error', async () => {
    const s = await repo.sessions.create({ dateIso: '2026-09-26', themeKey: 'x', mode: 'CUE', params: {} });
    await expect(db.transaction(async () => { await repo.sessions.appendEpoch(s.id, epoch(1)); throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await repo.nightReport(s.id)).epochs.length).toBe(0);
  });
  it('D22 insert 960 epoch < 2 วิ', async () => {
    const s = await repo.sessions.create({ dateIso: '2026-09-27', themeKey: 'x', mode: 'CUE', params: {} });
    const t0 = Date.now();
    await db.transaction(async () => { for (let i = 0; i < 960; i++) await repo.sessions.appendEpoch(s.id, epoch(1758750000 + i * 30)); });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

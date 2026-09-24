/**
 * ข้อสอบ L2.6 — ตัวควบคุมคืน (state machine + cue controller + Sleep Guard + volume ramp + คืนควบคุม) · builder ห้ามแก้
 * สัญญา: createNightController({ params: Partial<NightParams>, clock, rng, mode:'CUE'|'CONTROL', startT })
 *   .state: NightState · .cues: CueEvent[] · .wakes: WakeEvent[] · .guardUntilT · .onsetT
 *   .feed(epoch, pRem: number|null) → Action[]   Action = {type:'STATE',from,to} | {type:'PLAY_CUE', volume, cueId, index} | {type:'LOG_CUE', ...} (คืนควบคุม) |
 *                                                  {type:'SET_BED_VOLUME', volume} | {type:'WHISPER_SEED', index} | {type:'STOP_AUDIO'} | {type:'LIVE', text}
 *   .userStop() → Action[] (→ ENDED)  · .markWake(cause) (จาก L2.7) · .morning(nowT) → Action[] (→ MORNING)
 *   .cueResponse(cueId, 'WOKE'|'NONE') (ตัวจับตื่นภายใน 3 นาทีหลัง cue เรียก)
 *   nextNightVolume(history: CueEvent[], current: number) → number   (§5.3: ปลุก → −0.04 · ไม่ได้ยิน → +0.03 · ขอบ 0.08–0.35)
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { simulateNight, createNightController, nextNightVolume, fixedClock, mulberry32 } = engine as any;
const sleepAt = '2026-09-24T16:00:00.000Z';
function runNight(seed: number, mode: 'CUE' | 'CONTROL' = 'CUE', pFn?: (truth: any, i: number) => number, params: any = {}) {
  const n = simulateNight({ seed, sleepAtIso: sleepAt }); const rng = mulberry32 ? mulberry32(seed) : Math.random;
  const c = createNightController({ params, clock: fixedClock ? fixedClock(sleepAt) : undefined, rng, mode, startT: n.epochs[0].t });
  const actions: any[] = [];
  n.epochs.forEach((e: any, i: number) => { const p = pFn ? pFn(n.truth[i], i) : (n.truth[i].stage === 'REM' ? 0.85 : 0.1); actions.push(...c.feed(e, p).map((a: any) => ({ ...a, t: e.t, i }))); });
  actions.push(...c.morning(n.epochs[n.epochs.length - 1].t + 30));
  return { n, c, actions, plays: actions.filter((a) => a.type === 'PLAY_CUE') };
}

describe('L2.6 controller — กฎบังคับ (fuzz)', () => {
  it('K1 500 คืน: ไม่มี PLAY_CUE ก่อน guardUntil', () => { for (let s = 1; s <= 500; s++) { const { c, plays } = runNight(s); for (const p of plays) expect(p.t, `seed ${s}`).toBeGreaterThanOrEqual(c.guardUntilT); } });
  it('K2 500 คืน: ไม่มี PLAY_CUE ภายใน 120 วิ หลังขยับสูง (motion > 0.05)', () => {
    for (let s = 1; s <= 500; s++) { const { n, plays } = runNight(s); for (const p of plays) { for (let i = Math.max(0, p.i - 4); i < p.i; i++) expect(n.epochs[i].motion ?? 0, `seed ${s} cue@${p.i}`).toBeLessThanOrEqual(0.05); } }
  });
  it('K3 ไม่เกิน 8 cue/คืน · เว้น ≥ 300 วิ · volume ใน [0.08,0.35] เสมอ (500 คืน)', () => {
    for (let s = 1; s <= 500; s++) { const { plays } = runNight(s, 'CUE', () => 0.95); expect(plays.length).toBeLessThanOrEqual(8); for (let k = 1; k < plays.length; k++) expect(plays[k].t - plays[k - 1].t).toBeGreaterThanOrEqual(300); for (const p of plays) { expect(p.volume).toBeGreaterThanOrEqual(0.08); expect(p.volume).toBeLessThanOrEqual(0.35); } }
  });
  it('K4 คืนควบคุม: PLAY_CUE = 0 แต่ LOG_CUE > 0 และ cues[].played=false', () => { const { c, actions, plays } = runNight(3, 'CONTROL'); expect(plays.length).toBe(0); expect(actions.filter((a) => a.type === 'LOG_CUE').length).toBeGreaterThan(0); for (const q of c.cues) expect(q.played).toBe(false); });
  it('K5 ตื่น (markWake) → STOP_AUDIO ทันที และไม่มี cue จนกว่านิ่ง 15 นาที', () => {
    const n = simulateNight({ seed: 21, sleepAtIso: sleepAt }); const c = createNightController({ params: {}, clock: fixedClock?.(sleepAt), rng: mulberry32?.(1) ?? Math.random, mode: 'CUE', startT: n.epochs[0].t });
    let wakeAt = -1; const plays: number[] = [];
    n.epochs.forEach((e: any, i: number) => { const acts = c.feed(e, n.truth[i].stage === 'REM' ? 0.9 : 0.1); if (i === 500) { const a = c.markWake('MOTION'); expect(a.some((x: any) => x.type === 'STOP_AUDIO')).toBe(true); wakeAt = e.t; } for (const a of acts) if (a.type === 'PLAY_CUE') plays.push(e.t); });
    for (const t of plays) expect(t < wakeAt || t >= wakeAt + 900).toBe(true);
  });
  it('K6 params เพี้ยน (volumeStart 2.0 · guardHours 0 · maxCuesPerNight 99) ถูก clamp: volume ≤ 0.35 · guard ≥ 2 ชม. · cue ≤ 8', () => {
    const { c, plays } = runNight(4, 'CUE', () => 0.95, { volumeStart: 2.0, guardHours: 0, maxCuesPerNight: 99, volumeMax: 0.9 });
    expect(c.guardUntilT - c.onsetT).toBeGreaterThanOrEqual(7200); expect(plays.length).toBeLessThanOrEqual(8); for (const p of plays) expect(p.volume).toBeLessThanOrEqual(0.35);
  });
  it('K7 Sleep Guard: ตื่นจากเสียง 2 ครั้ง (cueResponse WOKE) → ไม่มี cue อีกทั้งคืน', () => {
    const n = simulateNight({ seed: 9, sleepAtIso: sleepAt }); const c = createNightController({ params: {}, clock: fixedClock?.(sleepAt), rng: mulberry32?.(2) ?? Math.random, mode: 'CUE', startT: n.epochs[0].t });
    const plays: any[] = []; let woke = 0;
    n.epochs.forEach((e: any, i: number) => { for (const a of c.feed(e, n.truth[i].stage === 'REM' ? 0.9 : 0.1)) if (a.type === 'PLAY_CUE') { plays.push({ ...a, t: e.t }); if (woke < 2) { woke++; c.cueResponse(a.cueId, 'WOKE'); } } });
    expect(plays.length).toBe(2);
  });
});

describe('L2.6 state machine + ramp', () => {
  it('K8 ลำดับสถานะ: PRE_SLEEP → FALLING_ASLEEP → GUARD → WATCHING → REM_LIKELY → CUE → COOLDOWN → WATCHING … → MORNING', () => {
    const { actions } = runNight(12); const seq = actions.filter((a) => a.type === 'STATE').map((a) => a.to);
    for (const st of ['FALLING_ASLEEP', 'GUARD', 'WATCHING', 'REM_LIKELY', 'CUE', 'COOLDOWN', 'MORNING']) expect(seq, st).toContain(st);
    expect(seq.indexOf('GUARD')).toBeLessThan(seq.indexOf('WATCHING')); expect(seq.indexOf('CUE')).toBeGreaterThan(seq.indexOf('REM_LIKELY'));
  });
  it('K9 REM_LIKELY ต้อง p ≥ 0.7 สอง epoch ติด แล้วรอ ≥ 60 วิ ก่อน CUE', () => {
    const { actions } = runNight(13); const st = actions.filter((a) => a.type === 'STATE'); const rl = st.find((a) => a.to === 'REM_LIKELY'); const cue = st.find((a) => a.to === 'CUE' && a.t > rl.t);
    expect(cue.t - rl.t).toBeGreaterThanOrEqual(60);
  });
  it('K10 WHISPER_SEED ออกไม่เกิน 2 ครั้ง และเฉพาะก่อน onset', () => { const { c, actions } = runNight(14); const w = actions.filter((a) => a.type === 'WHISPER_SEED'); expect(w.length).toBeLessThanOrEqual(2); for (const x of w) expect(x.t).toBeLessThan(c.onsetT); });
  it('K11 userStop → ENDED + STOP_AUDIO · feed หลังจากนั้นไม่ทำอะไร', () => { const { c } = runNight(15); const a = c.userStop(); expect(c.state).toBe('ENDED'); expect(a.some((x: any) => x.type === 'STOP_AUDIO')).toBe(true); expect(c.feed({ t: 1, hrMean: 60, hrSd: 1, motion: 0, battery: 1, source: 'WATCH' }, 0.9)).toEqual([]); });
  it('K12 nextNightVolume: ปลุก → −0.04 · ไม่ได้ยิน → +0.03 · ได้ยินไม่ปลุก → คงเดิม · ขอบ', () => {
    const cue = (r: string) => ({ at: 'x', index: 1, volume: 0.15, type: 'WHISPER', pRemAtCue: 0.8, played: true, response: r });
    expect(nextNightVolume([cue('WOKE')], 0.15)).toBeCloseTo(0.11); expect(nextNightVolume([cue('NONE')], 0.15)).toBeCloseTo(0.18); expect(nextNightVolume([cue('HEARD_IN_DREAM')], 0.15)).toBeCloseTo(0.15);
    expect(nextNightVolume([cue('WOKE')], 0.09)).toBeCloseTo(0.08); expect(nextNightVolume([cue('NONE')], 0.34)).toBeCloseTo(0.35); expect(nextNightVolume([], 0.15)).toBeCloseTo(0.15);
  });
});

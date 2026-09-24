/**
 * ข้อสอบ L3.4 — Learning loop (Thompson sampling บน arm volume×delay×type + PersonalModel) · builder ห้ามแก้
 * สัญญา: ARMS: { volume: 0.12|0.18|0.24 ; delaySec: 60|120|180 ; cueType: 'WHISPER'|'TONE_PHRASE'|'AMBIENCE_SWELL' }[] (27 arms) · armKey(arm) → string
 *        nightReward(input: { lucid:'YES'|'NO'|'UNSURE'|null; themeMatch: number|null (0–10); cueWoke: boolean; sleepQuality: number|null }) → number
 *            = (YES 1 · UNSURE 0.3 · NO/null 0) + 0.3×themeMatch/10 − 0.5×cueWoke − 0.3×(sleepQuality != null && sleepQuality < 5)
 *        createBandit({ prior?: Record<armKey,{a,b}> ; rng }) → { pick(): Arm ; update(arm, reward01: number) ; posterior(): Record<armKey,{a,b}> ; nights: number }
 *            - reward ถูก clamp เป็น [0,1] ก่อนอัปเดต Beta(a,b) · คืนควบคุมไม่เรียก update
 *        personalModelFromBandit(bandit, ceiling?: number) → { topArm, confidence (0–1), volumeCeiling, nights, learning: boolean (nights < 14) }
 *        explainLearning(model, lang) → string   (ภาษาคน · ไม่มีคำภาษาเทคนิค 'Thompson' 'Beta')
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../src/index';
const { ARMS, armKey, nightReward, createBandit, personalModelFromBandit, explainLearning } = engine as any;
const mulberry32 = (seed: number) => { const g = (engine as any).mulberry32(seed); const f = () => (typeof g === 'function' ? g() : g.next()); return f; };

describe('L3.4 reward', () => {
  it('B1 สูตร reward ตาม §5.5', () => {
    expect(nightReward({ lucid: 'YES', themeMatch: 10, cueWoke: false, sleepQuality: 8 })).toBeCloseTo(1.3);
    expect(nightReward({ lucid: 'UNSURE', themeMatch: 5, cueWoke: true, sleepQuality: 4 })).toBeCloseTo(0.3 + 0.15 - 0.5 - 0.3);
    expect(nightReward({ lucid: null, themeMatch: null, cueWoke: false, sleepQuality: null })).toBe(0);
  });
  it('B2 ARMS = 27 · key ไม่ซ้ำ · volume ทุกตัวใน [0.08,0.35]', () => { expect(ARMS.length).toBe(27); expect(new Set(ARMS.map(armKey)).size).toBe(27); for (const a of ARMS) { expect(a.volume).toBeGreaterThanOrEqual(0.08); expect(a.volume).toBeLessThanOrEqual(0.35); } });
});

describe('L3.4 bandit', () => {
  it('B3 จำลอง 500 คืน: arm ที่ดีที่สุด (รู้คำตอบ) ถูกเลือก ≥ 70% ใน 100 คืนสุดท้าย', () => {
    const rng = mulberry32(7); const b = createBandit({ rng }); const best = ARMS.find((a: any) => a.volume === 0.18 && a.delaySec === 120 && a.cueType === 'WHISPER');
    const truth = (arm: any) => armKey(arm) === armKey(best) ? 0.7 : 0.25; let lastPicks = 0;
    for (let n = 0; n < 500; n++) { const arm = b.pick(); const r = rng() < truth(arm) ? 1 : 0; b.update(arm, r); if (n >= 400 && armKey(arm) === armKey(best)) lastPicks++; }
    expect(lastPicks / 100).toBeGreaterThanOrEqual(0.7); expect(b.nights).toBe(500);
  });
  it('B4 deterministic ด้วย seed เดียวกัน', () => { const run = () => { const rng = mulberry32(3); const b = createBandit({ rng }); const ks: string[] = []; for (let i = 0; i < 30; i++) { const a = b.pick(); ks.push(armKey(a)); b.update(a, rng()); } return ks.join(','); }; expect(run()).toBe(run()); });
  it('B5 reward นอกช่วง clamp · posterior เปลี่ยนเฉพาะ arm ที่อัปเดต', () => { const b = createBandit({ rng: mulberry32(1) }); const a = ARMS[0]; const before = JSON.stringify(b.posterior()); b.update(a, 5); const post = b.posterior(); expect(post[armKey(a)].a).toBeCloseTo(JSON.parse(before)[armKey(a)].a + 1); expect(post[armKey(ARMS[1])]).toEqual(JSON.parse(before)[armKey(ARMS[1])]); b.update(a, -3); expect(b.posterior()[armKey(a)].b).toBeCloseTo(JSON.parse(before)[armKey(a)].b + 1); });
  it('B6 prior จากประชากรทำให้ pick แรก ๆ เอียงไปทาง arm ที่ prior ดี', () => { const prior: any = {}; for (const a of ARMS) prior[armKey(a)] = { a: 1, b: 1 }; const fav = ARMS[5]; prior[armKey(fav)] = { a: 30, b: 3 }; let c = 0; for (let s = 0; s < 200; s++) { const b = createBandit({ prior, rng: mulberry32(s) }); if (armKey(b.pick()) === armKey(fav)) c++; } expect(c / 200).toBeGreaterThan(0.5); });
});

describe('L3.4 personal model', () => {
  it('B7 < 14 คืน → learning=true · ≥ 14 → false · topArm มีจริง · volumeCeiling ไม่เกิน 0.35', () => {
    const b = createBandit({ rng: mulberry32(2) }); for (let i = 0; i < 13; i++) { const a = b.pick(); b.update(a, 0.5); }
    const m1 = personalModelFromBandit(b, 0.25); expect(m1.learning).toBe(true); expect(m1.nights).toBe(13);
    const a = b.pick(); b.update(a, 1); const m2 = personalModelFromBandit(b, 0.25); expect(m2.learning).toBe(false); expect(ARMS.map(armKey)).toContain(armKey(m2.topArm)); expect(m2.volumeCeiling).toBeLessThanOrEqual(0.35); expect(m2.confidence).toBeGreaterThanOrEqual(0); expect(m2.confidence).toBeLessThanOrEqual(1);
  });
  it('B8 explainLearning เป็นภาษาคน ไม่มีคำเทคนิค · มีทั้ง th/en', () => { const b = createBandit({ rng: mulberry32(2) }); for (let i = 0; i < 20; i++) { const a = b.pick(); b.update(a, 0.6); } const m = personalModelFromBandit(b, 0.2); for (const l of ['th', 'en']) { const s = explainLearning(m, l); expect(s.length).toBeGreaterThan(10); expect(/thompson|beta|posterior|arm/i.test(s)).toBe(false); } expect(/[฀-๿]/.test(explainLearning(m, 'th'))).toBe(true); });
});

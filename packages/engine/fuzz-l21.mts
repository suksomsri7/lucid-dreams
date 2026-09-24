/** ชั่วคราว — fuzz คุณสมบัติของตัวจำลองให้กว้างกว่าข้อสอบ (ลบก่อนส่งงาน) */
import { simulateNight, SensorEpochSchema, remMetrics, stageFractions, remLatencySec } from './src/index';

let fail = 0;
const bad = (msg: string) => { if (fail < 25) console.log('FAIL', msg); fail += 1; };

const durations = [180, 300, 360, 420, 450, 480, 510, 540, 600];
const wakes = [0, 1, 2, 3, 4, 6, 8];
const noises = [0, 0.5, 1, 2, 3];

let n = 0;
for (let seed = 1; seed <= 600; seed += 1) {
  const durationMin = durations[seed % durations.length]!;
  const wakeCount = wakes[seed % wakes.length]!;
  const noise = noises[seed % noises.length]!;
  const night = simulateNight({ seed, sleepAtIso: '2026-09-24T16:00:00.000Z', durationMin, wakeCount, noise });
  n += 1;
  const total = night.truth.length;
  const tag = `seed=${seed} dur=${durationMin} wake=${wakeCount} noise=${noise}`;

  if (night.epochs.length !== durationMin * 2) bad(`${tag} epochCount ${night.epochs.length}`);
  if (night.truth.length !== night.epochs.length) bad(`${tag} truth len`);
  for (let i = 0; i < night.epochs.length; i += 1) {
    const e = night.epochs[i]!;
    if (e.t % 30 !== 0) bad(`${tag} grid`);
    if (night.truth[i]!.t !== e.t) bad(`${tag} t mismatch`);
    if (i > 0 && e.t - night.epochs[i - 1]!.t !== 30) bad(`${tag} gap`);
    const r = SensorEpochSchema.safeParse(e);
    if (!r.success) bad(`${tag} schema ${JSON.stringify(e)}`);
    if (Number.isNaN(e.hrMean ?? 0) || Number.isNaN(e.motion ?? 0) || Number.isNaN(e.hrSd ?? 0)) bad(`${tag} NaN`);
  }

  const f = stageFractions(night.truth);
  if (!(f.REM > 0.15 && f.REM < 0.3)) bad(`${tag} REM frac ${f.REM.toFixed(4)}`);
  if (f.WAKE > 0.12) bad(`${tag} WAKE frac ${f.WAKE.toFixed(4)}`);
  if (!(f.N3 > 0)) bad(`${tag} no N3`);
  if (!(f.N2 > 0.3)) bad(`${tag} low N2 ${f.N2.toFixed(3)}`);

  const lat = remLatencySec(night.truth, night.onsetT);
  if (lat === null || lat < 3600) bad(`${tag} REM latency ${String(lat)}`);

  const mid = night.truth[Math.floor(total / 2)]!.t;
  const remA = night.truth.filter((s) => s.stage === 'REM' && s.t < mid).length;
  const remB = night.truth.filter((s) => s.stage === 'REM' && s.t >= mid).length;
  if (!(remB > remA)) bad(`${tag} remB ${remB} <= remA ${remA}`);
  const n3A = night.truth.filter((s) => s.stage === 'N3' && s.t < mid).length;
  const n3B = night.truth.filter((s) => s.stage === 'N3' && s.t >= mid).length;
  if (!(n3A > n3B)) bad(`${tag} N3 not front-loaded ${n3A}/${n3B}`);

  const by = (st: string, k: 'hrMean' | 'hrSd' | 'motion') => {
    const v = night.epochs.filter((_, i) => night.truth[i]!.stage === st).map((e) => e[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  if (!(by('N3', 'hrMean') < by('REM', 'hrMean'))) bad(`${tag} hr N3 ${by('N3', 'hrMean').toFixed(2)} >= REM ${by('REM', 'hrMean').toFixed(2)}`);
  if (!(by('REM', 'hrSd') > by('N3', 'hrSd'))) bad(`${tag} hrSd`);
  if (wakeCount > 0 || true) {
    const w = by('WAKE', 'motion'), r = by('REM', 'motion');
    if (!(w > r * 3)) bad(`${tag} motion WAKE ${w.toFixed(4)} vs REM ${r.toFixed(4)}`);
  }

  let bouts = 0;
  for (let i = 1; i < total; i += 1) {
    if (night.truth[i]!.stage === 'WAKE' && night.truth[i - 1]!.stage !== 'WAKE' && night.truth[i]!.t - night.onsetT > 600) bouts += 1;
  }
  if (Math.abs(bouts - wakeCount) > 1) bad(`${tag} bouts ${bouts} vs ${wakeCount}`);
  if (night.truth[total - 1]!.stage !== 'WAKE') bad(`${tag} does not end awake`);
  if (night.truth[0]!.stage !== 'N1') bad(`${tag} starts ${night.truth[0]!.stage}`);

  // determinism
  const again = simulateNight({ seed, sleepAtIso: '2026-09-24T16:00:00.000Z', durationMin, wakeCount, noise });
  if (JSON.stringify(again) !== JSON.stringify(night)) bad(`${tag} not deterministic`);
}

// metrics never NaN on random probabilities
const nightM = simulateNight({ seed: 7, sleepAtIso: '2026-09-24T16:00:00.000Z' });
for (const th of [0, 0.5, 0.7, 1]) {
  const m = remMetrics(nightM.truth, nightM.truth.map((s) => ({ t: s.t, p: s.stage === 'REM' ? 0.8 : 0.2 })), th);
  for (const [k, v] of Object.entries(m)) if (!Number.isFinite(v)) bad(`metrics ${k} ${v} th=${th}`);
}
console.log(Object.entries(remMetrics([], [], 0.7)));
console.log(`fuzz nights=${n} failures=${fail}`);
process.exit(fail > 0 ? 1 : 0);

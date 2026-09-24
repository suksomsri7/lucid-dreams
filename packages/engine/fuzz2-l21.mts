/** ชั่วคราว — รอบ 2: กวาด seed กว้าง + cycleMin หลายค่า (ลบก่อนส่งงาน) */
import { simulateNight, stageFractions, remLatencySec } from './src/index';
let fail = 0; const bad = (m: string) => { if (fail < 15) console.log('FAIL', m); fail += 1; };
const durs = [420, 450, 480, 510]; const cycles = [80, 90, 100, 110];
let minRem = 1, maxRem = 0, minLat = 1e9, maxLat = 0, maxWake = 0, worstRemRatio = 1;
for (let seed = 1; seed <= 2000; seed += 1) {
  const durationMin = durs[seed % durs.length]!; const cycleMin = cycles[(seed >> 2) % cycles.length]!;
  const n = simulateNight({ seed, sleepAtIso: '2026-09-24T16:00:00.000Z', durationMin, cycleMin });
  const f = stageFractions(n.truth);
  minRem = Math.min(minRem, f.REM); maxRem = Math.max(maxRem, f.REM); maxWake = Math.max(maxWake, f.WAKE);
  if (!(f.REM > 0.15 && f.REM < 0.3)) bad(`seed=${seed} cyc=${cycleMin} REM ${f.REM.toFixed(4)}`);
  if (f.WAKE > 0.12) bad(`seed=${seed} WAKE ${f.WAKE.toFixed(4)}`);
  if (!(f.N3 > 0)) bad(`seed=${seed} no N3`);
  const lat = remLatencySec(n.truth, n.onsetT)!; minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  if (lat < 3600) bad(`seed=${seed} lat ${lat}`);
  const mid = n.truth[Math.floor(n.truth.length / 2)]!.t;
  const a = n.truth.filter((s) => s.stage === 'REM' && s.t < mid).length;
  const b = n.truth.filter((s) => s.stage === 'REM' && s.t >= mid).length;
  worstRemRatio = Math.min(worstRemRatio, b / Math.max(1, a));
  if (!(b > a)) bad(`seed=${seed} cyc=${cycleMin} remA ${a} remB ${b}`);
  let bouts = 0;
  for (let i = 1; i < n.truth.length; i += 1) if (n.truth[i]!.stage === 'WAKE' && n.truth[i - 1]!.stage !== 'WAKE' && n.truth[i]!.t - n.onsetT > 600) bouts += 1;
  if (Math.abs(bouts - 2) > 1) bad(`seed=${seed} bouts ${bouts}`);
}
console.log(`REM frac ${minRem.toFixed(4)}..${maxRem.toFixed(4)} · WAKE max ${maxWake.toFixed(4)} · REM latency ${(minLat/60).toFixed(1)}..${(maxLat/60).toFixed(1)} min · worst remB/remA ${worstRemRatio.toFixed(2)}`);
console.log(`fuzz2 failures=${fail}`);
process.exit(fail > 0 ? 1 : 0);

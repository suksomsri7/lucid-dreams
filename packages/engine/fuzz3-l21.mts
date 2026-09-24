/** ชั่วคราว — รอบ 3: หาช่องว่าง remB-remA ที่แคบสุด (ลบก่อนส่งงาน) */
import { simulateNight } from './src/index';
const durs = [420, 450, 480, 510]; const cycles = [80, 90, 100, 110];
let worst = 1e9, worstTag = '';
const hist: Record<string, number> = {};
for (let seed = 1; seed <= 2000; seed += 1) {
  const durationMin = durs[seed % durs.length]!; const cycleMin = cycles[(seed >> 2) % cycles.length]!;
  const n = simulateNight({ seed, sleepAtIso: '2026-09-24T16:00:00.000Z', durationMin, cycleMin });
  const mid = n.truth[Math.floor(n.truth.length / 2)]!.t;
  const a = n.truth.filter((s) => s.stage === 'REM' && s.t < mid).length;
  const b = n.truth.filter((s) => s.stage === 'REM' && s.t >= mid).length;
  if (b - a < worst) { worst = b - a; worstTag = `seed=${seed} dur=${durationMin} cyc=${cycleMin} a=${a} b=${b} cycles=${n.params.cycles.length}`; }
  const k = `${cycleMin}`; hist[k] = Math.min(hist[k] ?? 1e9, b - a);
}
console.log('worst margin', worst, worstTag);
console.log('per cycleMin worst margin', hist);

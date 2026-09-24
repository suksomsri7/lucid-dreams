/**
 * `pnpm engine:sim` — generate N synthetic nights and report what they look like.
 *
 * This is the smoke test of the test bench itself: if the generator ever drifts
 * (REM share, REM latency, N3 front-loading, WASO), the summary shows it before a
 * later work order blames its own estimator. It is also how L2.5/L2.6 get a fixed
 * corpus to grade against: `--per-night` writes every night as JSON.
 *
 * ```
 * pnpm engine:sim --nights 200 --out /tmp/sim
 * pnpm engine:sim --nights 20 --out /tmp/sim --per-night --duration 450 --wake 3 --noise 2
 * ```
 *
 * Node-only file (it writes files). It is deliberately **not** exported from
 * `src/index.ts` so the app bundle never pulls `node:fs` in — the engine stays a
 * pure library for the phone (APP-RUN §0.2 rule 1).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { remLatencySec, stageFractions, wasoSec, type StageFractions } from '../metrics';
import { simulateNight, type SimulatedNight } from '../simulate';
import { type SleepStage } from '../types';

interface Args {
  nights: number;
  out: string | null;
  seed: number;
  durationMin: number;
  cycleMin: number;
  wakeCount: number;
  noise: number;
  sleepAtIso: string;
  perNight: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    nights: 200,
    out: null,
    seed: 1,
    durationMin: 480,
    cycleMin: 90,
    wakeCount: 2,
    noise: 1,
    sleepAtIso: '2026-01-01T16:00:00.000Z',
    perNight: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    const num = (): number => {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`engine:sim: ${flag} needs a number`);
      i += 1;
      return n;
    };
    switch (flag) {
      case '--nights': args.nights = Math.max(1, Math.round(num())); break;
      case '--out': args.out = String(value ?? ''); i += 1; break;
      case '--seed': args.seed = Math.round(num()); break;
      case '--duration': args.durationMin = num(); break;
      case '--cycle': args.cycleMin = num(); break;
      case '--wake': args.wakeCount = Math.round(num()); break;
      case '--noise': args.noise = num(); break;
      case '--sleep-at': args.sleepAtIso = String(value ?? ''); i += 1; break;
      case '--per-night': args.perNight = true; break;
      case '--help':
      case '-h':
        process.stdout.write(
          'engine:sim --nights N [--out DIR] [--seed S] [--duration MIN] [--cycle MIN] [--wake N] [--noise X] [--sleep-at ISO] [--per-night]\n',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`engine:sim: unknown flag "${flag}"`);
    }
  }
  return args;
}

interface Stat {
  mean: number;
  min: number;
  max: number;
  p05: number;
  p95: number;
}

function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { mean: 0, min: 0, max: 0, p05: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    p05: at(0.05),
    p95: at(0.95),
  };
}

const STAGES: readonly SleepStage[] = ['WAKE', 'N1', 'N2', 'N3', 'REM'];

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const fractions: Record<SleepStage, number[]> = { WAKE: [], N1: [], N2: [], N3: [], REM: [] };
  const remLatencyMin: number[] = [];
  const onsetLatencyMin: number[] = [];
  const wasoMin: number[] = [];
  const remFirstHalf: number[] = [];
  const n3FirstHalf: number[] = [];
  const hrRem: number[] = [];
  const hrN3: number[] = [];
  const nights: SimulatedNight[] = [];

  const started = Date.now();
  for (let k = 0; k < args.nights; k += 1) {
    const seed = args.seed + k;
    const night = simulateNight({
      seed,
      sleepAtIso: args.sleepAtIso,
      durationMin: args.durationMin,
      cycleMin: args.cycleMin,
      wakeCount: args.wakeCount,
      noise: args.noise,
    });

    const f: StageFractions = stageFractions(night.truth);
    for (const stage of STAGES) fractions[stage].push(f[stage]);

    const latency = remLatencySec(night.truth, night.onsetT);
    if (latency !== null) remLatencyMin.push(latency / 60);
    onsetLatencyMin.push((night.onsetT - night.params.startT) / 60);
    wasoMin.push(wasoSec(night.truth, night.onsetT) / 60);

    const mid = night.truth[Math.floor(night.truth.length / 2)]?.t ?? 0;
    const remA = night.truth.filter((s) => s.stage === 'REM' && s.t < mid).length;
    const remB = night.truth.filter((s) => s.stage === 'REM' && s.t >= mid).length;
    remFirstHalf.push(remA + remB > 0 ? remA / (remA + remB) : 0);
    const n3A = night.truth.filter((s) => s.stage === 'N3' && s.t < mid).length;
    const n3B = night.truth.filter((s) => s.stage === 'N3' && s.t >= mid).length;
    n3FirstHalf.push(n3A + n3B > 0 ? n3A / (n3A + n3B) : 0);

    const mean = (stage: SleepStage): number => {
      const values = night.epochs
        .filter((_, i) => night.truth[i]?.stage === stage)
        .map((e) => e.hrMean)
        .filter((x): x is number => x != null);
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    };
    hrRem.push(mean('REM'));
    hrN3.push(mean('N3'));

    if (args.perNight) nights.push(night);
  }

  const summary = {
    generatedBy: 'engine:sim',
    nights: args.nights,
    options: {
      seedFrom: args.seed,
      seedTo: args.seed + args.nights - 1,
      sleepAtIso: args.sleepAtIso,
      durationMin: args.durationMin,
      cycleMin: args.cycleMin,
      wakeCount: args.wakeCount,
      noise: args.noise,
    },
    stageFractions: Object.fromEntries(STAGES.map((s) => [s, stat(fractions[s])])),
    remLatencyMin: stat(remLatencyMin),
    onsetLatencyMin: stat(onsetLatencyMin),
    wasoMin: stat(wasoMin),
    remShareFirstHalf: stat(remFirstHalf),
    n3ShareFirstHalf: stat(n3FirstHalf),
    hrMeanRem: stat(hrRem),
    hrMeanN3: stat(hrN3),
    elapsedMs: Date.now() - started,
  };

  const text = JSON.stringify(summary, null, 2);
  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    writeFileSync(path.join(args.out, 'summary.json'), `${text}\n`, 'utf8');
    for (const night of nights) {
      writeFileSync(
        path.join(args.out, `night-${String(night.params.seed).padStart(4, '0')}.json`),
        `${JSON.stringify(night)}\n`,
        'utf8',
      );
    }
    process.stdout.write(`engine:sim → ${path.join(args.out, 'summary.json')}${args.perNight ? ` (+${nights.length} nights)` : ''}\n`);
  }
  process.stdout.write(`${text}\n`);
}

main();

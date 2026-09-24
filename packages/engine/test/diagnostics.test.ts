import { describe, expect, it } from 'vitest';

import {
  buildDiagnosticsExport,
  DIAGNOSTICS_SCHEMA_VERSION,
  epochCoverage,
  fixedClock,
  normalizeEpochs,
  parseDiagnostics,
  stepClock,
  type DiagnosticsDraft,
  type SensorEpoch,
} from '../src/index';

const AT = '2026-09-24T21:30:00.000Z';

function sampleDraft(): DiagnosticsDraft {
  return {
    appVersion: '0.1.0',
    buildNumber: '1',
    device: {
      platform: 'ios',
      osVersion: '26.0',
      model: 'iPhone15,2',
      modelName: 'iPhone 14 Pro',
      watchModel: 'Watch6,9',
      watchPaired: true,
      locale: 'th-TH',
    },
    sensors: [{ id: 'watch', kind: 'WATCH', connected: true, reachable: true }],
    epochs: [
      { t: 1790000100, hrMean: 58, hrSd: 3.2, motion: 0.011, battery: 0.92, source: 'WATCH' },
      { t: 1790000130, hrMean: 57, hrSd: 2.9, motion: 0.008, battery: 0.92, source: 'WATCH' },
    ],
    audioEvents: [
      { at: AT, kind: 'BED_START', volume: 0.12 },
      { at: '2026-09-24T21:31:00.000Z', kind: 'ROUTE_CHANGED', detail: 'BluetoothA2DP' },
    ],
    batterySamples: [{ at: AT, device: 'PHONE', level: 0.81, state: 'CHARGING' }],
    warnings: [],
  };
}

describe('diagnostics schema', () => {
  it('accepts a well-formed export and fills the documented defaults', () => {
    const built = buildDiagnosticsExport(sampleDraft(), fixedClock(AT));
    const parsed = parseDiagnostics(built);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBe(DIAGNOSTICS_SCHEMA_VERSION);
    expect(parsed.value.exportedAt).toBe(AT);
    expect(parsed.value.epochs).toHaveLength(2);
    // defaults applied, not left undefined
    expect(parsed.value.audioEvents[1]?.volume).toBeNull();
    expect(parsed.value.batterySamples[0]?.lowPowerMode).toBe(false);
    expect(parsed.value.warnings).toEqual([]);
  });

  it('rejects a bad export and names every broken field', () => {
    const bad = {
      schemaVersion: 99, // wrong version
      appVersion: '', // empty
      exportedAt: 'last night', // not ISO
      device: { platform: 'nokia', osVersion: '26.0', model: 'x', locale: 'th' },
      epochs: [{ t: -5, hrMean: 900, hrSd: 1, motion: 0, battery: 2, source: 'TELEPATHY' }],
      audioEvents: [{ at: AT, kind: 'DANCE' }],
    };

    const parsed = parseDiagnostics(bad);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    const joined = parsed.issues.join('\n');
    expect(parsed.issues.length).toBeGreaterThanOrEqual(6);
    for (const path of [
      'schemaVersion',
      'appVersion',
      'exportedAt',
      'device.platform',
      'epochs.0.t',
      'epochs.0.hrMean',
      'epochs.0.battery',
      'epochs.0.source',
      'audioEvents.0.kind',
    ]) {
      expect(joined).toContain(path);
    }
  });

  it('refuses to build an export whose device block is impossible', () => {
    const draft = sampleDraft();
    draft.device.osVersion = '';
    expect(() => buildDiagnosticsExport(draft, fixedClock(AT))).toThrow();
  });
});

describe('clock injection', () => {
  it('fixedClock freezes time so the same draft always produces the same bytes', () => {
    const a = buildDiagnosticsExport(sampleDraft(), fixedClock(AT));
    const b = buildDiagnosticsExport(sampleDraft(), fixedClock(AT));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.exportedAt).toBe(AT);
  });

  it('stepClock advances by a fixed step and never reads the wall clock', () => {
    const clock = stepClock(AT, 30_000);
    const first = clock.nowIso();
    const second = clock.nowIso();
    expect(first).toBe(AT);
    expect(second).toBe('2026-09-24T21:30:30.000Z');

    clock.advance(60_000);
    expect(clock.nowIso()).toBe('2026-09-24T21:32:00.000Z');
  });

  it('fixedClock rejects an unparsable time instead of silently using now()', () => {
    expect(() => fixedClock('tonight')).toThrow(/cannot parse time/);
  });
});

describe('epoch hygiene', () => {
  it('measures continuity, gaps and duplicates over a night', () => {
    const epochs: SensorEpoch[] = [0, 30, 60, 150, 180].map((offset) => ({
      t: 1790000100 + offset,
      hrMean: 58,
      hrSd: 2,
      motion: 0.01,
      battery: 0.9,
      source: 'WATCH' as const,
    }));

    const coverage = epochCoverage(epochs);
    expect(coverage.count).toBe(5);
    expect(coverage.expected).toBe(7);
    expect(coverage.gaps).toBe(1);
    expect(coverage.longestGapSeconds).toBe(90);
    expect(coverage.continuity).toBeCloseTo(5 / 7, 5);
  });

  it('drops impossible heart rates and dedupes re-sent epochs (S8)', () => {
    const raw: SensorEpoch[] = [
      { t: 1790000100, hrMean: 58, hrSd: 2, motion: 0.01, battery: 0.9, source: 'WATCH' },
      { t: 1790000100, hrMean: 61, hrSd: 2, motion: 0.02, battery: 0.9, source: 'WATCH' }, // re-sent
      { t: 1790000130, hrMean: 400, hrSd: 2, motion: 0.01, battery: 0.9, source: 'WATCH' }, // impossible
      { t: 1790000117, hrMean: 59, hrSd: 2, motion: 0.01, battery: 0.9, source: 'WATCH' }, // off-grid
    ];

    const clean = normalizeEpochs(raw);
    expect(clean.map((e) => e.t)).toEqual([1790000100]);
    expect(clean[0]?.hrMean).toBe(59); // last write for that epoch index wins
  });

  it('reports zero coverage for an empty night instead of dividing by zero', () => {
    expect(epochCoverage([])).toEqual({
      count: 0,
      expected: 0,
      continuity: 0,
      gaps: 0,
      longestGapSeconds: 0,
      duplicates: 0,
    });
  });
});

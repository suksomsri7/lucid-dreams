/**
 * `ble.ts` — the Bluetooth heart-rate lane, as pure data (WO L2.3, engine half).
 *
 * Two jobs, both deliberately free of any native module so they can be replayed on
 * the VPS from a byte fixture (APP-RUN §0.2 rule 1):
 *
 *   1. {@link parseHeartRateMeasurement} — decode one GATT **Heart Rate Measurement**
 *      notification (service `0x180D`, characteristic `0x2A37`) into numbers, and
 *      refuse anything that is not physiologically possible (APP-RUN §0.5 S8).
 *   2. {@link createSensorHub} — merge every source the sleeper happens to wear
 *      (watch + chest strap + phone on the mattress, DESIGN §8.1) into the single
 *      30 s {@link SensorEpoch} the REM estimator of §5.2 consumes.
 *
 * Why the parser lives here and not in the BLE adapter: the adapter's only job is to
 * hand over a `Uint8Array`. Everything that can be *wrong* about that array (short
 * buffer, a flag combination this brand uses and no other, a 300 bpm reading from a
 * strap that lost skin contact) is logic, and logic must be testable without a radio.
 *
 * ## The byte layout (Bluetooth SIG, Heart Rate Measurement)
 *
 * ```
 * byte 0        flags
 *   bit 0       0 = bpm is uint8 · 1 = bpm is uint16 little-endian
 *   bit 1       sensor-contact detected
 *   bit 2       sensor-contact feature supported
 *   bit 3       energy expended field present (uint16, kJ)
 *   bit 4       RR-interval field present (uint16 each, unit 1/1024 s)
 *   bits 5–7    reserved
 * byte 1..      bpm (1 or 2 bytes)  → energy expended (2 bytes, if bit 3)
 *                                   → RR intervals (2 bytes each, if bit 4)
 * ```
 *
 * The fields are **positional**: a missing byte does not blank one value, it shifts
 * every value after it. That is why a truncated buffer is dropped whole (`null`)
 * instead of being read "as far as it goes".
 */

import { EPOCH_SECONDS } from './clock';
import {
  HR_MAX_BPM,
  HR_MIN_BPM,
  type SensorEpoch,
  type SensorSourceKind,
} from './diagnostics';
import { clamp, round } from './rng';

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** bit 0 — heart rate is a 16-bit value (a strap that can report > 255 bpm). */
export const HRM_FLAG_UINT16 = 0x01;
/** bit 1 — skin contact detected *(only meaningful when {@link HRM_FLAG_CONTACT_SUPPORTED})*. */
export const HRM_FLAG_CONTACT_DETECTED = 0x02;
/** bit 2 — this device knows whether it is touching skin at all. */
export const HRM_FLAG_CONTACT_SUPPORTED = 0x04;
/** bit 3 — energy expended (kJ) present. */
export const HRM_FLAG_ENERGY = 0x08;
/** bit 4 — RR intervals present. */
export const HRM_FLAG_RR = 0x10;

/** RR ticks are 1/1024 s, not ms — the single most common mistake in HRV code. */
export const RR_TICKS_PER_SECOND = 1024;

/**
 * Plausible beat-to-beat window, in ms. 250 ms = 240 bpm, 3000 ms = 20 bpm; both are
 * just outside the {@link HR_MIN_BPM}–{@link HR_MAX_BPM} rail, so an RR value that
 * survives here can never produce an out-of-rail instantaneous heart rate. Values
 * outside are dropped individually (a dropped beat is normal on a loose strap) —
 * they must not poison RMSSD, which squares differences.
 */
export const RR_MIN_MS = 250;
export const RR_MAX_MS = 3000;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface HeartRateMeasurement {
  /** Beats per minute, already checked against the 25–220 rail. */
  bpm: number;
  /**
   * `true`/`false` only when the device supports the feature (flag bit 2);
   * `null` = "this brand never tells us", which must not be shown as "no contact".
   */
  sensorContact: boolean | null;
  /** Energy expended in kJ since the device was reset — `null` when not reported. */
  energyKj: number | null;
  /** Beat-to-beat intervals in **ms** (may be empty; optical devices rarely send them). */
  rrMs: number[];
}

/**
 * Decode one `0x2A37` notification.
 *
 * Returns `null` — never a partially-filled object — when the payload cannot be
 * trusted (APP-RUN §0.5 S8 "ไม่เชื่อ payload ที่ไม่ผ่านสคีมา"):
 *   * empty buffer, or too short for the bpm / energy field the flags promise;
 *   * bpm outside 25–220 (a strap reporting 0 while being put on, or 300 from a
 *     wrist band reading a tendon instead of a pulse).
 *
 * One deliberate leniency: a **trailing odd byte** in the RR block is ignored rather
 * than fatal. RR values come last, so a short tail cannot shift anything else, and
 * throwing away a good heart rate because HRV padding was odd would cost the night's
 * primary signal for nothing.
 */
export function parseHeartRateMeasurement(bytes: Uint8Array): HeartRateMeasurement | null {
  if (bytes.length < 2) return null;

  const flags = bytes[0] as number;
  const uint16 = (flags & HRM_FLAG_UINT16) !== 0;

  let offset = 1;
  let bpm: number;
  if (uint16) {
    if (bytes.length < 3) return null;
    bpm = (bytes[1] as number) | ((bytes[2] as number) << 8);
    offset = 3;
  } else {
    bpm = bytes[1] as number;
    offset = 2;
  }
  if (!Number.isFinite(bpm) || bpm < HR_MIN_BPM || bpm > HR_MAX_BPM) return null;

  let energyKj: number | null = null;
  if ((flags & HRM_FLAG_ENERGY) !== 0) {
    if (bytes.length < offset + 2) return null;
    energyKj = (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8);
    offset += 2;
  }

  const rrMs: number[] = [];
  if ((flags & HRM_FLAG_RR) !== 0) {
    for (let i = offset; i + 1 < bytes.length; i += 2) {
      const ticks = (bytes[i] as number) | ((bytes[i + 1] as number) << 8);
      const ms = (ticks * 1000) / RR_TICKS_PER_SECOND;
      if (ms >= RR_MIN_MS && ms <= RR_MAX_MS) rrMs.push(round(ms, 3));
    }
  }

  const sensorContact =
    (flags & HRM_FLAG_CONTACT_SUPPORTED) === 0
      ? null
      : (flags & HRM_FLAG_CONTACT_DETECTED) !== 0;

  return { bpm, sensorContact, energyKj, rrMs };
}

// ---------------------------------------------------------------------------
// HRV
// ---------------------------------------------------------------------------

/**
 * RMSSD — root mean square of successive RR differences, in ms.
 *
 * This is the HRV number §5.2 wants: it reacts to the *beat-to-beat* jitter that
 * collapses in deep sleep and returns in REM, and unlike SDNN it is barely affected
 * by the slow drift of a whole night. Needs at least two beats (one difference);
 * fewer ⇒ `null`, never 0, because "no data" and "a perfectly steady heart" must not
 * look the same to the estimator.
 */
export function rmssd(rrMs: readonly number[]): number | null {
  if (rrMs.length < 2) return null;
  let sum = 0;
  let pairs = 0;
  for (let i = 1; i < rrMs.length; i += 1) {
    const diff = (rrMs[i] as number) - (rrMs[i - 1] as number);
    sum += diff * diff;
    pairs += 1;
  }
  if (pairs === 0) return null;
  return Math.sqrt(sum / pairs);
}

/**
 * SDNN — standard deviation of the RR intervals themselves, in ms.
 *
 * Population (÷ n), not sample (÷ n−1): the intervals inside one 30 s epoch are the
 * whole population of that epoch, and ÷ (n−1) would inflate short epochs exactly
 * where the estimator is least sure already.
 */
export function sdnn(rrMs: readonly number[]): number | null {
  if (rrMs.length < 2) return null;
  const mean = rrMs.reduce((a, b) => a + b, 0) / rrMs.length;
  const variance = rrMs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rrMs.length;
  return Math.sqrt(variance);
}

/** Instantaneous heart rate implied by one RR interval. */
function bpmFromRr(ms: number): number {
  return 60000 / ms;
}

// ---------------------------------------------------------------------------
// SensorHub
// ---------------------------------------------------------------------------

/** One reading from one source, at one second. `source` is the *kind*, `sourceId` the device. */
export interface SensorSample {
  /** Unix seconds. */
  t: number;
  bpm?: number;
  rrMs?: number[];
  /** Mean |a| of the accelerometer since the last sample, in g. */
  motion?: number;
  battery?: number | null;
  source: SensorSourceKind;
}

export interface SensorHubOptions {
  /** Epoch length in seconds. Defaults to the engine-wide 30 s grid. */
  epochSeconds?: number;
}

export interface SensorHub {
  /** Feed one reading. Silently ignores duplicates and impossible heart rates. */
  push(sourceId: string, sample: SensorSample): void;
  /**
   * Close the epoch that **ends** at `tEnd` (so the window is `[tEnd − epochSeconds, tEnd)`)
   * and return it, or `null` when no source said anything in that window.
   */
  closeEpoch(tEnd: number): SensorEpoch | null;
  /** Every device id that has ever pushed, in the order they first appeared. */
  sources(): string[];
}

interface StoredSample {
  t: number;
  sourceId: string;
  kind: SensorSourceKind;
  bpm: number | null;
  rrMs: number[];
  motion: number | null;
  battery: number | null;
}

/**
 * Merge many sources into one epoch stream.
 *
 * The merge rules are the interesting part, and each of them exists because of a real
 * pair of devices (DESIGN §8.1, decision of 24 Sep — "ต่อได้พร้อมกันหลายแหล่ง …
 * ตัวประเมินรวมให้เอง"):
 *
 *   * **hrMean** = mean over *samples*, not over devices. A chest strap that reports
 *     once a second and a watch that reports every five must not be given equal say:
 *     weighting by sample count is weighting by evidence.
 *   * **hrSd** comes from the RR intervals when any source sent them, expressed in bpm
 *     (`60000/rr`) so the unit stays the one the schema promises. RR jitter is a far
 *     better REM cue than the spread of averaged bpm values; when nobody sends RR we
 *     fall back to the spread of the bpm samples.
 *   * **motion** = max. Movement is evidence of *being* awake; a phone lying still on
 *     the mattress must not be able to average a thrashing wrist away.
 *   * **battery** = the lowest non-null level, because the diagnostics screen asks
 *     "will this rig survive the night", and the answer is the weakest device.
 *   * **source** = the kind that produced the most heart rates (ties go to whoever
 *     also sent RR, then to whoever pushed first). The field is single-valued in the
 *     schema, so it names the epoch's *main witness*.
 *
 * Duplicate suppression (APP-RUN §0.5 S8): a `(sourceId, t)` pair is accepted once.
 * A strap that drops and reconnects replays its buffer; without this, the reconnect
 * would double the weight of those seconds. Samples older than the last closed epoch
 * are refused outright — an epoch already delivered can never be rewritten.
 */
export function createSensorHub(options: SensorHubOptions = {}): SensorHub {
  const epochSeconds =
    options.epochSeconds != null && options.epochSeconds > 0
      ? Math.round(options.epochSeconds)
      : EPOCH_SECONDS;

  const pending: StoredSample[] = [];
  const seen = new Set<string>();
  const sourceIds: string[] = [];
  /** Nothing before this second may enter any future epoch. */
  let closedUpTo = Number.NEGATIVE_INFINITY;

  function push(sourceId: string, sample: SensorSample): void {
    if (sample == null || !Number.isFinite(sample.t)) return;
    const t = Math.floor(sample.t);
    if (!sourceIds.includes(sourceId)) sourceIds.push(sourceId);
    if (t < closedUpTo) return;

    const key = `${sourceId}@${t}`;
    if (seen.has(key)) return;

    const bpm =
      sample.bpm != null && Number.isFinite(sample.bpm) && sample.bpm >= HR_MIN_BPM && sample.bpm <= HR_MAX_BPM
        ? sample.bpm
        : null;
    const rrMs = (sample.rrMs ?? []).filter(
      (ms) => Number.isFinite(ms) && ms >= RR_MIN_MS && ms <= RR_MAX_MS,
    );
    const motion =
      sample.motion != null && Number.isFinite(sample.motion) && sample.motion >= 0 ? sample.motion : null;
    const battery =
      sample.battery != null && Number.isFinite(sample.battery)
        ? clamp(sample.battery, 0, 1)
        : null;

    // A reading that survived validation with nothing left in it carries no evidence,
    // so it must not make an otherwise-empty epoch look populated.
    if (bpm === null && rrMs.length === 0 && motion === null && battery === null) return;

    seen.add(key);
    pending.push({ t, sourceId, kind: sample.source, bpm, rrMs, motion, battery });
  }

  function closeEpoch(tEnd: number): SensorEpoch | null {
    if (!Number.isFinite(tEnd)) return null;
    const end = Math.floor(tEnd);
    const start = Math.max(0, end - epochSeconds);

    const inWindow = pending.filter((s) => s.t >= start && s.t < end);
    // Everything up to `end` is now history, whether it was used or not.
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if ((pending[i] as StoredSample).t < end) pending.splice(i, 1);
    }
    for (const key of [...seen]) {
      const at = Number(key.slice(key.lastIndexOf('@') + 1));
      if (Number.isFinite(at) && at < start) seen.delete(key);
    }
    closedUpTo = end;

    if (inWindow.length === 0) return null;

    const bpms = inWindow.filter((s) => s.bpm != null).map((s) => s.bpm as number);
    const hrMean =
      bpms.length === 0 ? null : round(clamp(bpms.reduce((a, b) => a + b, 0) / bpms.length, HR_MIN_BPM, HR_MAX_BPM), 3);

    const rr = inWindow.flatMap((s) => s.rrMs);
    let hrSd: number | null = null;
    if (rr.length >= 2) {
      const spread = sdnn(rr.map(bpmFromRr));
      hrSd = spread == null ? null : round(clamp(spread, 0, 80), 3);
    } else if (bpms.length >= 2) {
      const spread = sdnn(bpms);
      hrSd = spread == null ? null : round(clamp(spread, 0, 80), 3);
    }

    const motions = inWindow.filter((s) => s.motion != null).map((s) => s.motion as number);
    const motion = motions.length === 0 ? null : round(Math.max(...motions), 6);

    const batteries = inWindow.filter((s) => s.battery != null).map((s) => s.battery as number);
    const battery = batteries.length === 0 ? null : round(clamp(Math.min(...batteries), 0, 1), 3);

    return {
      t: start,
      hrMean,
      hrSd,
      motion,
      battery,
      source: mainWitness(inWindow, sourceIds),
    };
  }

  return {
    push,
    closeEpoch,
    sources: () => [...sourceIds],
  };
}

/** Which source kind gets to sign the epoch — see {@link createSensorHub}. */
function mainWitness(samples: readonly StoredSample[], order: readonly string[]): SensorSourceKind {
  const score = new Map<string, { kind: SensorSourceKind; hr: number; rr: number; all: number }>();
  for (const s of samples) {
    const entry = score.get(s.sourceId) ?? { kind: s.kind, hr: 0, rr: 0, all: 0 };
    entry.kind = s.kind;
    if (s.bpm != null) entry.hr += 1;
    entry.rr += s.rrMs.length;
    entry.all += 1;
    score.set(s.sourceId, entry);
  }

  let best: { id: string; kind: SensorSourceKind; hr: number; rr: number; all: number } | null = null;
  for (const [id, entry] of score) {
    const candidate = { id, ...entry };
    if (best === null) {
      best = candidate;
      continue;
    }
    const better =
      candidate.hr !== best.hr
        ? candidate.hr > best.hr
        : candidate.rr !== best.rr
          ? candidate.rr > best.rr
          : candidate.all !== best.all
            ? candidate.all > best.all
            : order.indexOf(candidate.id) < order.indexOf(best.id);
    if (better) best = candidate;
  }

  // `samples` is never empty where this is called, but the schema needs a value even
  // if that ever changes: a timer night is the honest description of "no sensor".
  return best?.kind ?? 'TIMER';
}

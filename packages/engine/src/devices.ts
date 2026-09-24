/**
 * The device registry behind onboarding's "3 categories" screen (DESIGN §4-01(b) ·
 * §3.2 step 3) — HEART (pulse/motion) · AUDIO · EYE. Pure data model on purpose
 * (APP-RUN §0.2 rule 1): the app populates it from `src/devices/registry.ts` (which
 * talks to `platform/*`), and later `L1.7`'s `readiness.ts` (DESIGN §2 "L1.7") is
 * expected to build its richer per-night gating on top of the same shape rather than
 * re-invent it — this WO only needs "what did we find, per category" for onboarding.
 *
 * No BLE yet (scheduled L2.3): entries here come from whatever `platform/*` can report
 * today (Apple Watch link status, the audio output route). A category with nothing
 * connected is not an error here — `summarizeDevices` just reports it, the screen
 * decides what to show and never hard-blocks onboarding on it (device pairing itself
 * doesn't exist until L1.7/L2.2/L2.3).
 */

export type DeviceCategory = 'HEART' | 'AUDIO' | 'EYE';

export interface DeviceEntry {
  id: string;
  category: DeviceCategory;
  /** Display name as reported by the platform (e.g. "Apple Watch", "Sleep A20"). Not translated — device names are proper nouns. */
  name: string;
  connected: boolean;
  /** 0..1, `null` when the platform cannot report it. */
  battery: number | null;
  /** ISO-8601, `null` before any data has arrived from this device. */
  lastDataAt: string | null;
  /** Set by the UI when the user pinned this device as the one to use. Informational. */
  required?: boolean;
}

/** All categories in screen order (DESIGN §3.2 — pulse, sound, eyes). */
export const DEVICE_CATEGORIES: readonly DeviceCategory[] = ['HEART', 'AUDIO', 'EYE'];

export type DeviceListener = (list: DeviceEntry[]) => void;
export type Unsubscribe = () => void;

/**
 * Keeps the devices the app currently knows about. One instance lives for the app's
 * lifetime (`src/devices/registry.ts` owns it); vitest can make its own for a clean
 * slate per test.
 */
export class DeviceRegistry {
  private readonly entries = new Map<string, DeviceEntry>();
  private readonly listeners = new Set<DeviceListener>();

  /** Insert or fully replace the entry with this `id`. */
  add(entry: DeviceEntry): void {
    this.entries.set(entry.id, entry);
    this.emit();
  }

  /** No-op (not an error) when `id` is unknown — a status poll racing a removal must stay harmless. */
  update(id: string, patch: Partial<Omit<DeviceEntry, 'id'>>): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    this.entries.set(id, { ...existing, ...patch });
    this.emit();
  }

  remove(id: string): void {
    if (this.entries.delete(id)) this.emit();
  }

  list(): DeviceEntry[] {
    return Array.from(this.entries.values());
  }

  byCategory(category: DeviceCategory): DeviceEntry[] {
    return this.list().filter((entry) => entry.category === category);
  }

  subscribe(listener: DeviceListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export interface DeviceCategorySummary {
  category: DeviceCategory;
  /** HEART and AUDIO need >= 1 connected device; EYE is optional (DESIGN §3.2 step 3). */
  required: boolean;
  /** How many entries exist in this category, connected or not. */
  found: number;
  connected: number;
  /** `true` when the category's requirement is met (always `true` for EYE). */
  ok: boolean;
}

const CATEGORIES: readonly DeviceCategory[] = ['HEART', 'AUDIO', 'EYE'];

/** Pure function so both the screen and future readiness logic (L1.7) can share it without touching the registry. */
export function summarizeDevices(list: readonly DeviceEntry[]): DeviceCategorySummary[] {
  return CATEGORIES.map((category) => {
    const inCategory = list.filter((entry) => entry.category === category);
    const connected = inCategory.filter((entry) => entry.connected).length;
    const required = category !== 'EYE';
    return {
      category,
      required,
      found: inCategory.length,
      connected,
      ok: required ? connected >= 1 : true,
    };
  });
}

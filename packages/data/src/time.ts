/**
 * Time rules of the data layer (oracle D15).
 *
 *   - **stored** = ISO-8601 in UTC, always ending in `Z` (`2026-09-24T22:00:00.000Z`);
 *   - **displayed** = the device time zone, formatted by `formatLocal()` in the UI only.
 *
 * Nothing in this package reads `Date.now()`: "now" always comes from the injected clock
 * (APP-RUN §0.2 rule 6), so a night can be replayed deterministically in vitest.
 *
 * Date-only values (`NightSession.dateIso`) are the *dream night* label, kept as
 * `YYYY-MM-DD` so a night is one row per calendar date without any time-zone arithmetic
 * (reference_thai_date_getday_trap: never use `getDay()` / local parts for this).
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Normalise any parseable timestamp to ISO UTC with milliseconds and a trailing `Z`. */
export function toIsoUtc(input: string | number | Date): string {
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) throw new Error(`data: cannot parse timestamp "${String(input)}"`);
  return new Date(ms).toISOString();
}

/** Same as `toIsoUtc` but passes `null`/`undefined` through. */
export function toIsoUtcOrNull(input: string | number | Date | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  return toIsoUtc(input);
}

/** Validate a `YYYY-MM-DD` night label. */
export function toDateIso(input: string): string {
  if (!DATE_ONLY.test(input)) throw new Error(`data: dateIso must be YYYY-MM-DD, got "${input}"`);
  return input;
}

/** The `YYYY-MM-DD` label of an instant, in UTC. */
export function dateIsoOf(input: string | number | Date): string {
  return toIsoUtc(input).slice(0, 10);
}

/** Epoch seconds (30 s grid, UTC) → stored ISO UTC string. */
export function isoFromEpochSeconds(t: number): string {
  return new Date(t * 1000).toISOString();
}

/** Stored ISO UTC string → epoch seconds. */
export function epochSecondsFrom(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/**
 * Shift a night label by whole days without touching local time: used by `stats(n)` to
 * build the inclusive window `[today - (n-1) days … today]`.
 */
export function shiftDateIso(dateIso: string, days: number): string {
  const ms = Date.parse(`${toDateIso(dateIso)}T00:00:00.000Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Render a stored UTC timestamp in the device (or a given) time zone — the only place
 * allowed to leave UTC. Kept here so no screen invents its own formatting.
 */
export function formatLocal(
  iso: string,
  options: { locale?: string; timeZone?: string; withDate?: boolean } = {},
): string {
  const { locale = 'en-GB', timeZone, withDate = false } = options;
  const format: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(withDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
    ...(timeZone ? { timeZone } : {}),
  };
  return new Intl.DateTimeFormat(locale, format).format(new Date(toIsoUtc(iso)));
}

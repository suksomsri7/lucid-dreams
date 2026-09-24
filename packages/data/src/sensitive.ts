/**
 * Which columns count as sensitive (APP-RUN §0.5 S4/S5 · oracle D14 · D17).
 *
 * Dream text, the recording path and any AI wording about a dream never leave the phone by
 * accident: the diagnostics export strips every key listed here unless the owner turns the
 * "include dream text" switch on, and logs must never print them.
 *
 * Audio itself is **never** stored in the database — only a file path (oracle D16), so
 * deleting the row plus the file is enough to make a night unrecoverable.
 */

export const SENSITIVE_FIELDS = [
  /** MorningReport.transcript — the dream, in the owner's own words. */
  'transcript',
  /** MorningReport.audioPath — path of the voice memo on the device. */
  'audioPath',
  /** AiScore.summary — the model's sentence about the dream. */
  'summary',
  /** Alias used by the diagnostics/analysis side for the same thing (qc spec D17). */
  'aiSummary',
  /** AiScore.matchedTerms — words quoted out of the dream text. */
  'matchedTerms',
  /** UserProfile.anchorAudioPaths — per-language anchor audio files. */
  'anchorAudioPaths',
  'anchorAudioPath',
  /** Free-form note fields (journal edits, L3.5). */
  'note',
  'notes',
] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

const SENSITIVE_SET: ReadonlySet<string> = new Set<string>(SENSITIVE_FIELDS);

export function isSensitiveField(key: string): boolean {
  return SENSITIVE_SET.has(key);
}

/**
 * Deep copy of `value` with every sensitive key removed, at any depth, inside arrays too.
 * Used as the last gate before anything is handed to the share sheet, so a new column can
 * only leak if someone forgets to add it to the list above (and D14 greps for the text).
 */
export function stripSensitive<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value instanceof Uint8Array) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveField(key)) continue;
    out[key] = walk(item);
  }
  return out;
}

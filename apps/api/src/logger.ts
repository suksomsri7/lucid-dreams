/**
 * `logger.ts` — one JSON line per request, and **never a word the user wrote**.
 *
 * APP-RUN §0.5 S5: logs must carry no PII and no dream text. What is actually useful
 * when a night goes wrong is shape, not content — so we log ids, lengths, status codes
 * and durations, and nothing else. `textLen` is enough to tell "the transcript was
 * empty" from "the transcript was 800 characters" without ever storing the sentence.
 *
 * No dependency: `pino` would give us levels and a transport we do not need for one
 * process writing to journald (§0.5 S9 — every new dependency has to earn its place).
 * `console.log(JSON.stringify(...))` is line-buffered per call and already structured,
 * which is all `journalctl -u lucid-api -o cat | jq` needs.
 */

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Keys that must never appear in a log line, whatever the caller thinks. */
const FORBIDDEN_KEYS = new Set(['text', 'messages', 'transcript', 'token', 'prompt', 'content', 'authorization']);

function scrub(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      safe[`${key}Len`] = typeof value === 'string' ? value.length : -1;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function createLogger(options?: { enabled?: boolean; now?: () => string; sink?: (line: string) => void }): Logger {
  const enabled = options?.enabled ?? true;
  const now = options?.now ?? (() => new Date().toISOString());
  const sink = options?.sink ?? ((line: string) => console.log(line));

  const write = (level: string, event: string, fields?: LogFields): void => {
    if (!enabled) return;
    sink(JSON.stringify({ t: now(), level, event, ...scrub(fields ?? {}) }));
  };

  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

/** A logger that drops everything — used by the oracle so the test output stays readable. */
export const silentLogger: Logger = createLogger({ enabled: false });

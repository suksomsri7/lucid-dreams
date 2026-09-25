/**
 * `@lucid/data/sqljs` — the sql.js (wasm) driver for vitest and fixtures. Kept out of the
 * package's main entry on purpose: the app bundle must never see `sql.js` (R1 build #1 failed
 * on `node:fs` because Metro followed the dynamic import). Never import this from `apps/mobile`.
 */
export { createSqlJsDriver } from './drivers/sqljs';
export type { SqlJsDriverOptions } from './drivers/sqljs';

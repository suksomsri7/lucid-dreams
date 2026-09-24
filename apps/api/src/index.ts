/**
 * Placeholder. The AI server starts at L1.5 (APP-RUN §2).
 *
 * Planned endpoints (DESIGN §8.2): `/ai/seed` `/ai/tts` `/ai/score` `/ai/weekly` + optional sync.
 * Every one of them must ship with: device-token auth, per-device rate limit, a zod body
 * schema and a ≤ 32 KB body cap (APP-RUN §0.5 S2) — there is deliberately no code here yet,
 * so nothing can be deployed without those.
 */

export const API_STATUS = 'not-implemented-until-L1.5' as const;

/**
 * Do-Not-Disturb / Focus check for the device-readiness gate (`readiness.ts`'s
 * `dndAllowsAppAudio` input, DESIGN §3.2 step 3 "ห้ามรบกวน อนุญาตเสียงของแอปแล้ว").
 *
 * A plain app (no Focus Filter entitlement, which requires a separate Apple review and
 * an App Group) has no public API to read whether Focus/Do-Not-Disturb is currently
 * silencing it — `UNUserNotificationCenter` reports *notification* settings, not
 * whether *audio playback* is allowed, which is the thing this gate actually cares
 * about (a night can be silenced by DND without a single notification setting changing).
 *
 * Kept as a single stand-alone function rather than a full `platform/*` interface
 * (`SensorSource`/`AudioPlayer`/… shaped, one `types.ts` entry + ios/android/native
 * classes each): every implementation would be the same one-line stub today, and the
 * real check (WO note: "native check is the Opus audio WO") most likely lands as part
 * of that WO's iOS interruption/session work, not as a new platform primitive on its
 * own — see `ledger/wo-notes/L1.7ui.md` for the trade-off.
 *
 * Always reports "audio is allowed" today. The pre-night gate (`evaluateReadiness`)
 * still has a `DND_BLOCKS` code ready for the day this returns a real reading.
 */
export async function dndAllowsAppAudio(): Promise<boolean> {
  // TODO(Opus audio WO): read the real Focus/Do-Not-Disturb state (needs a native
  // module — no public Expo API exposes it as of SDK 57).
  return true;
}

import { AdvisorRoom } from '../../src/advisor';

/**
 * Tab 1 — the dream advisor room (DESIGN §3.3, mockups 02/03). WO L1.2 shipped a shell
 * here (Bubble + a static chip row) just to prove the glass system and i18n held up;
 * this WO (L1.4) replaces it with the real conversation, backed by a mock adapter until
 * the L1.5 merge wires the real engine advisor in (`src/advisor/adapter.ts`).
 */
export default function TonightScreen() {
  return <AdvisorRoom testID="screen-tonight" />;
}

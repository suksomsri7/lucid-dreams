/** Test left ear — step 2/3 (WO L1.7ui, mockup `04-dream-plan.png` frame c). Thin route
 * wrapper: the actual screen lives in `src/night/EarTestScreen.tsx`, shared with `ear-
 * right.tsx` (see that file's header for why). */

import { EarTestScreen } from '../../src/night/EarTestScreen';

export default function EarLeftScreen() {
  return <EarTestScreen side="L" />;
}

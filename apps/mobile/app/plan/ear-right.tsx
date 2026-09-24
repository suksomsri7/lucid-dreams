/** Test right ear — step 3/3 (WO L1.7ui, mockup `04-dream-plan.png` frame d). Thin route
 * wrapper: the actual screen lives in `src/night/EarTestScreen.tsx`, shared with `ear-
 * left.tsx` (see that file's header for why). */

import { EarTestScreen } from '../../src/night/EarTestScreen';

export default function EarRightScreen() {
  return <EarTestScreen side="R" />;
}

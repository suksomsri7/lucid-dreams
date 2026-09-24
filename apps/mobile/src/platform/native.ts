/**
 * Default (non-iOS) native bundle: there is none in Phase 1.
 *
 * Metro resolves `./native` to `native.ios.ts` on iOS and to this file everywhere else,
 * which is what keeps `expo-glass-effect` / the watch bridge out of the web and Android
 * bundles (APP-RUN §0.2 rule 8).
 */

import type { PlatformBundle } from './types';

export function createNativePlatform(): PlatformBundle | null {
  return null;
}

/**
 * The same BLE scanner, as a route **inside** onboarding (WO L3.9 §A — R1 hotfix #1, bug 1).
 *
 * Why it has to exist: `app/_layout.tsx` sends anything outside `/onboarding` back to
 * `/onboarding` until onboarding has been completed once (`hasOnboarded`). The onboarding devices
 * step used to push `/plan/find-devices`, so on the owner's TestFlight build tapping "find another
 * device" under 💓 threw him back to the first onboarding screen. Weakening that guard would open
 * the whole app to a half-onboarded user; a route under `/onboarding` costs nothing and keeps the
 * guard exactly as strict as it was.
 *
 * `router.back()` returns to `app/onboarding/devices.tsx`, which is still mounted and subscribed to
 * `deviceRegistry`, so a strap bonded here is already listed when the user lands back on it.
 */

import { useRouter } from 'expo-router';

import { FindDevicesScreen } from '../../src/devices/FindDevicesScreen';

export default function OnboardingFindDevicesRoute() {
  const router = useRouter();
  return <FindDevicesScreen onDone={() => router.back()} />;
}

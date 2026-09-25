/**
 * Route wrapper — the BLE scanner reached from the `+` row of the pre-night devices screen
 * (`app/plan/devices.tsx`) and of Settings. The screen itself is
 * `src/devices/FindDevicesScreen.tsx`, shared with `app/onboarding/find-devices.tsx` (WO L3.9 §A).
 *
 * It lives under `app/plan/` because that is where the `+` row is, and it needs no plan: nothing
 * here reads `useNightState`, unlike its siblings.
 */

import { useRouter } from 'expo-router';

import { FindDevicesScreen } from '../../src/devices/FindDevicesScreen';

export default function PlanFindDevicesRoute() {
  const router = useRouter();
  return <FindDevicesScreen onDone={() => router.back()} />;
}

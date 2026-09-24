import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { AdvisorRoom } from '../../src/advisor';
import { morningFixtureRequested } from '../../src/dev/fixtures';
import { isMorningPending, MorningFlow } from '../../src/morning';
import { useNightState } from '../../src/store/night';

/**
 * Tab 1 — the dream advisor room (DESIGN §3.3, mockups 02/03), *or*, when last night's
 * session ended and nobody has told the morning room about it yet, the morning flow
 * instead (DESIGN §3.2's "morning, two steps" · mockup `06-morning.png` — WO L3.1). Both
 * live in this exact same tab slot on purpose — DESIGN's own name for it is "the morning,
 * in the same room" — this file is the one place that decides which of the two the
 * sleeper is looking at right now.
 *
 * `night.tsx`'s hold-to-stop already lands back here (`router.replace('/(tabs)')`) the
 * moment a night ends; `useFocusEffect` (not a plain mount effect) is what actually
 * catches that — the tab screen was very likely already mounted from before the user
 * walked through `/plan` → `/night`, so a one-time mount effect would never re-check the
 * database and the morning flow would never appear.
 */
export default function TonightScreen() {
  const nightState = useNightState();
  const fixture = morningFixtureRequested();

  const [pendingSessionId, setPendingSessionId] = useState<string | null | 'checking'>(fixture !== null ? null : 'checking');

  useFocusEffect(
    useCallback(() => {
      if (fixture !== null) return; // `?fixture=morning-*` always wins — see below
      let cancelled = false;
      const sessionId = nightState.hydrated ? nightState.sessionId : null;
      if (sessionId === null) {
        setPendingSessionId(null);
        return undefined;
      }
      setPendingSessionId('checking');
      void isMorningPending(sessionId).then((pending) => {
        if (!cancelled) setPendingSessionId(pending ? sessionId : null);
      });
      return () => {
        cancelled = true;
      };
    }, [fixture, nightState.hydrated, nightState.sessionId]),
  );

  if (fixture !== null) {
    return <MorningFlow sessionId={null} testID="screen-tonight" />;
  }
  if (pendingSessionId === 'checking') {
    // Same "render nothing yet" beat `AdvisorRoom`'s own fixtures use while hydrating —
    // avoids a one-frame flash of the advisor room before the pending check resolves.
    return null;
  }
  if (pendingSessionId !== null) {
    return <MorningFlow sessionId={pendingSessionId} testID="screen-tonight" />;
  }
  return <AdvisorRoom testID="screen-tonight" />;
}

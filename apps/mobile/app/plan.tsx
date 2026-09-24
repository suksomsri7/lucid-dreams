import { useT } from '../src/i18n';
import { Screen, Sub, Title } from '../src/ui';

/**
 * "Tonight's plan" full-screen (mockup `04-dream-plan.png`) — the real device-check → ear-test
 * → "start tonight" flow is WO L1.5+. `AdvisorRoom.tsx`'s "start tonight" button already calls
 * `advisor.start()` and pushes here today so the room's own flow is complete end-to-end;
 * this stub is the placeholder that screen replaces.
 */
export default function PlanStubScreen() {
  const { t } = useT();

  return (
    <Screen testID="screen-plan-stub" withTabBarInset={false}>
      <Title>{t('plan.stub.title')}</Title>
      <Sub>{t('plan.stub.body')}</Sub>
    </Screen>
  );
}

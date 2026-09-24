import { useT } from '../src/i18n';
import { Screen, Sub, Title } from '../src/ui';

/**
 * The dark, all-night screen (DESIGN §3.4 · §4-05) — `app/plan/ear-right.tsx`'s
 * "start tonight" button already `router.replace()`s here so the pre-start flow
 * (WO L1.7ui) is complete end-to-end; the real night controller/UI (state machine,
 * Live Activity, hold-to-stop) is WO L2.8. This stub is the placeholder that screen
 * replaces.
 */
export default function NightStubScreen() {
  const { t } = useT();

  return (
    <Screen testID="screen-night-stub" withTabBarInset={false} night>
      <Title night>{t('night.stub.title')}</Title>
      <Sub night>{t('night.stub.body')}</Sub>
    </Screen>
  );
}

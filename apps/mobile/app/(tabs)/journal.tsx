import { useT } from '../../src/i18n';
import { GlassCard, Screen, Sub, Title } from '../../src/ui';

/**
 * Tab 2 — every past night (mockup 08). The real list, 30-night chart and totals are
 * L2.10/L3.5; this WO only replaces the temporary kit with the glass shell.
 */
export default function JournalScreen() {
  const { t } = useT();

  return (
    <Screen testID="screen-journal">
      <Title>{t('journal.title')}</Title>
      <Sub>{t('journal.subtitle')}</Sub>
      <GlassCard variant="soft">
        <Sub>{t('journal.empty')}</Sub>
      </GlassCard>
    </Screen>
  );
}

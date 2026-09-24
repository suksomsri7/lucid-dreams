import { useT } from '../../src/i18n';
import { Card, Note, Screen, Subtitle, Title } from '../../src/ui/kit';

/** Tab 2 — every past night. Built in L2.10 / L3.5. */
export default function JournalScreen() {
  const { t } = useT();

  return (
    <Screen testID="screen-journal">
      <Title>{t('journal.title')}</Title>
      <Subtitle>{t('journal.subtitle')}</Subtitle>
      <Card>
        <Note>{t('journal.empty')}</Note>
      </Card>
    </Screen>
  );
}

import { useT } from '../../src/i18n';
import { Card, Note, Screen, Subtitle, Title } from '../../src/ui/kit';

/** Tab 1 — the dream advisor room. Real conversation arrives in L1.4. */
export default function TonightScreen() {
  const { t } = useT();

  return (
    <Screen testID="screen-tonight">
      <Title>{t('tonight.title')}</Title>
      <Subtitle>{t('tonight.subtitle')}</Subtitle>
      <Card>
        <Note>{t('tonight.placeholder')}</Note>
        <Note>{t('tonight.shellNote')}</Note>
      </Card>
    </Screen>
  );
}

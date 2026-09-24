import { useRouter } from 'expo-router';

import { LOCALES, useT } from '../../src/i18n';
import { ActionButton, Card, Note, Row, Screen, Subtitle, Title } from '../../src/ui/kit';

/**
 * Tab 3 — one page for everything (DESIGN §3.1). Full settings are L3.6.
 * The language switch is here from day one because it is the cheapest way to prove
 * "switching takes effect with no restart" (DESIGN §2.7).
 */
export default function SettingsScreen() {
  const { t, locale, setLocale } = useT();
  const router = useRouter();

  return (
    <Screen testID="screen-settings">
      <Title>{t('settings.title')}</Title>
      <Subtitle>{t('settings.subtitle')}</Subtitle>

      <Card title={t('settings.language')}>
        <Row label={t('settings.language')} value={locale === 'th' ? t('settings.language.th') : t('settings.language.en')} />
        {LOCALES.map((candidate) => (
          <ActionButton
            key={candidate}
            testID={`set-locale-${candidate}`}
            label={candidate === 'th' ? t('settings.language.th') : t('settings.language.en')}
            tone={candidate === locale ? 'primary' : 'ghost'}
            onPress={() => setLocale(candidate)}
          />
        ))}
      </Card>

      <Card title={t('settings.openDiagnostics')}>
        <Note>{t('settings.openDiagnostics.hint')}</Note>
        <ActionButton
          testID="open-diagnostics"
          label={t('settings.openDiagnostics')}
          onPress={() => router.push('/diagnostics')}
        />
      </Card>
    </Screen>
  );
}

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useLocale, useT } from '../../src/i18n';
import { Button, GlassCard, Row, Screen, Seg, Sub, Switch, Title } from '../../src/ui';

/**
 * Tab 3 — one page for everything (DESIGN §3.1 · mockup 09). Full settings (devices,
 * sound, sleep, data) are L3.6; this WO keeps the language switch (the cheapest proof
 * that "switching takes effect with no restart" — DESIGN §2.7) and the diagnostics
 * entry point, now styled with the real glass kit instead of `kit.tsx`.
 */
export default function SettingsScreen() {
  const { t } = useT();
  const { locale, setLocale } = useLocale();
  const router = useRouter();
  const [autoLevel, setAutoLevel] = useState(true);

  return (
    <Screen testID="screen-settings">
      <Title>{t('settings.title')}</Title>
      <Sub>{t('settings.subtitle')}</Sub>

      <GlassCard>
        <Row
          label={t('settings.language')}
          right={
            <Seg
              testID="locale-seg"
              options={[
                { value: 'th', label: t('settings.language.th') },
                { value: 'en', label: t('settings.language.en') },
              ]}
              value={locale}
              onChange={(next) => setLocale(next === 'th' ? 'th' : 'en')}
            />
          }
          last
        />
      </GlassCard>

      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Sub style={{ flex: 1 }}>{t('dev.switch.label')}</Sub>
          <Switch value={autoLevel} onValueChange={setAutoLevel} testID="auto-level-switch" />
        </View>
      </GlassCard>

      <GlassCard>
        <Sub>{t('settings.openDiagnostics.hint')}</Sub>
        <Button
          testID="open-diagnostics"
          tone="gh"
          block
          label={t('settings.openDiagnostics')}
          onPress={() => router.push('/diagnostics')}
        />
      </GlassCard>
    </Screen>
  );
}

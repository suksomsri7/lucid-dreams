import { useState } from 'react';

import { useT } from '../../src/i18n';
import { Bubble, Chip, Composer, GlassCard, Screen, Sub, Title } from '../../src/ui';

/**
 * Tab 1 — the dream advisor room (mockup 02). The real conversation, AI plan card and
 * chat history are L1.4/L1.5; this WO only has to prove the glass shell + i18n hold up,
 * so the composer and chips are wired to local state that goes nowhere yet — exactly
 * what `tonight.shellNote` tells the owner.
 */
export default function TonightScreen() {
  const { t } = useT();
  const [draft, setDraft] = useState('');

  const themeChips = [t('dev.chip.whale'), t('dev.chip.city'), t('dev.chip.other')];

  return (
    <Screen testID="screen-tonight">
      <Title>{t('tonight.title')}</Title>
      <Sub>{t('tonight.subtitle')}</Sub>

      <Bubble role="ai" text={t('dev.bubble.ai')} />

      <GlassCard variant="soft" contentStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {themeChips.map((label) => (
          <Chip key={label} label={label} />
        ))}
      </GlassCard>

      <GlassCard>
        <Sub>{t('tonight.shellNote')}</Sub>
      </GlassCard>

      <Composer
        value={draft}
        onChangeText={setDraft}
        placeholder={t('tonight.placeholder')}
        onMicPress={() => undefined}
        onSend={() => setDraft('')}
        testID="tonight-composer"
      />
    </Screen>
  );
}

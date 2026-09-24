import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { isAcceptedFixtureRequested } from '../../src/dev/fixtures';
import { useLocale, useT } from '../../src/i18n';
import { acceptSafetyConsent, useOnboardingState } from '../../src/store/onboarding';
import { Button, GlassCard, Icon, Screen, Seg, Sub, Title, colors, spacing } from '../../src/ui';
import type { IconName } from '../../src/ui';

/**
 * Onboarding screen (a) — welcome + safety notes + consent (DESIGN §4-01 · mockup
 * `01-onboarding.png`, left frame · `01-onboarding.body.html`). Ported structure/order
 * 1:1 from the mockup source: logo → title → tagline → 3-note card → accept checkbox →
 * the "start" button pinned above the home indicator, language `Seg` top-right.
 *
 * No "send my dream text to AI" switch here (Fable parity review, correcting the WO's
 * original instruction): the owner-approved mockup has no such control on this screen —
 * `consentAi` still defaults to `false` in `src/store/onboarding.ts`; its switch will
 * live in the Settings tab's data section (mockup 09, WO L3.6).
 */
export default function OnboardingWelcomeScreen() {
  const { t } = useT();
  const { locale, setLocale } = useLocale();
  const router = useRouter();
  const { consentSafety } = useOnboardingState();
  const [accepted, setAccepted] = useState(() => consentSafety.accepted || isAcceptedFixtureRequested());

  const canStart = accepted;

  const handleStart = () => {
    if (!canStart) return;
    acceptSafetyConsent();
    router.replace('/onboarding/devices');
  };

  return (
    <Screen
      testID="screen-onboarding-welcome"
      withTabBarInset={false}
      footer={
        <Button
          testID="onboarding-start-button"
          tone="pri"
          block
          size="big"
          label={t('onboarding.welcome.start')}
          disabled={!canStart}
          onPress={handleStart}
        />
      }
    >
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1 }} />
        <View style={{ minWidth: 160 }}>
          <Seg
            testID="onboarding-lang-seg"
            options={[
              { value: 'th', label: t('onboarding.lang.th') },
              { value: 'en', label: t('onboarding.lang.en') },
            ]}
            value={locale}
            onChange={(next) => setLocale(next === 'th' ? 'th' : 'en')}
          />
        </View>
      </View>

      <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
        <GlassCard
          variant="soft"
          noPadding
          style={{ width: 84, height: 84, borderRadius: 42 }}
          contentStyle={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 40, lineHeight: 44 }}>🌙</Text>
        </GlassCard>

        <View style={{ height: 18 }} />
        <Title style={{ textAlign: 'center' }} testID="onboarding-title">
          {t('app.name')}
        </Title>
        <Sub style={{ textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg, lineHeight: 19 }}>
          {t('onboarding.welcome.tagline')}
        </Sub>
      </View>

      <View style={{ height: spacing.lg }} />

      <GlassCard noPadding>
        <ConsentNote icon="heart" title={t('onboarding.consent.medical.title')} sub={t('onboarding.consent.medical.body')} first />
        <ConsentNote icon="info" title={t('onboarding.consent.notFor.title')} sub={t('onboarding.consent.notFor.body')} />
        <ConsentNote icon="shield" title={t('onboarding.consent.local.title')} sub={t('onboarding.consent.local.body')} last />
      </GlassCard>

      <View style={{ height: spacing.md }} />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        onPress={() => setAccepted((value) => !value)}
        testID="onboarding-accept-checkbox"
      >
        <GlassCard variant="soft" style={{ borderRadius: 20 }} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 10, // `.cbx` — `_base.part` (not one of the six named radii; a one-off like `Switch`'s own constants)
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: accepted ? colors.priSurface : 'transparent',
              borderWidth: 1,
              borderColor: colors.glassLine,
            }}
          >
            {accepted ? <Icon name="check" size={16} color={colors.white} strokeWidth={2.6} /> : null}
          </View>
          <Text style={{ fontSize: 14.5, fontWeight: '600', color: colors.ink }}>{t('onboarding.consent.accept')}</Text>
        </GlassCard>
      </Pressable>
    </Screen>
  );
}

interface ConsentNoteProps {
  icon: IconName;
  title: string;
  sub: string;
  first?: boolean;
  last?: boolean;
}

/** `.li.tall` — icon-badge + title + sub, one row per safety note (mockup 01(a)). */
function ConsentNote({ icon, title, sub, first = false, last = false }: ConsentNoteProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.hairline,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accBg,
        }}
      >
        <Icon name={icon} size={16} color={colors.acc} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink, lineHeight: 18 }}>{title}</Text>
        <Sub style={{ marginTop: 2, lineHeight: 16 }}>{sub}</Sub>
      </View>
    </View>
  );
}

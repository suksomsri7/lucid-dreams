/**
 * Tonight's plan — frame (a) of the pre-start flow (WO L1.7ui, mockup
 * `04-dream-plan.png` · DESIGN §3.2 step 3 · §4-04). `AdvisorRoom.tsx`'s "start
 * tonight" button calls `advisor.start()` (which persists the plan via
 * `saveTonightPlan`, `useAdvisor.ts`) and pushes here — this screen reads it back with
 * `useNightState()` rather than through props/route params, because the advisor's own
 * adapter instance lives in a different route's component tree (see `src/store/
 * night.ts`'s header for the full reasoning).
 *
 * Full plan card, not `PlanCardCompact` (that one is the chat-room-inline version,
 * WO L1.4): this screen adds the ambience-bed row, the full 3-line "tonight" summary
 * and the device-count row the compact card never had room for.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { summarizeDevices, type AnchorSignature } from '@lucid/engine';

import { deviceRegistry } from '../../src/devices/registry';
import { applyPlanFixture } from '../../src/dev/fixtures';
import { useT, type TranslationKey } from '../../src/i18n';
import { buildAnchorSignature, getAnchorSeed, playAnchorOnce } from '../../src/audio/player';
import { useNightState } from '../../src/store/night';
import {
  Button,
  GlassCard,
  GlassSurface,
  Icon,
  Screen,
  StepNav,
  Sub,
  Title,
  colors,
  radius,
  spacing,
  typeScale,
} from '../../src/ui';

const AMBIENCE_LABEL_KEY: Record<string, TranslationKey> = {
  underwater: 'plan.ambience.underwater',
  wind: 'plan.ambience.wind',
  rain: 'plan.ambience.rain',
  silence: 'plan.ambience.silence',
};

export default function PlanScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const { plan, lang, hydrated } = useNightState();
  const [signature, setSignature] = useState<AnchorSignature | null>(null);

  const effectiveLang = lang ?? locale;

  // `?fixture=plan` (WO L1.7ui QC parity) — no-op once a real plan exists.
  useEffect(() => {
    applyPlanFixture(locale);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const seed = await getAnchorSeed();
      if (!cancelled) setSignature(buildAnchorSignature(seed, effectiveLang));
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveLang]);

  const deviceSummary = useMemo(() => summarizeDevices(deviceRegistry.list()), []);
  const heartConnected = deviceSummary.find((entry) => entry.category === 'HEART')?.connected ?? 0;
  const audioConnected = deviceSummary.find((entry) => entry.category === 'AUDIO')?.connected ?? 0;

  if (!hydrated) return <Screen testID="screen-plan" withTabBarInset={false} />;

  if (!plan) {
    return (
      <Screen testID="screen-plan-empty" withTabBarInset={false}>
        <StepNav title={t('plan.nav.title')} onBack={() => router.back()} testID="plan-nav" />
        <Title>{t('plan.notFound.title')}</Title>
        <Sub>{t('plan.notFound.body')}</Sub>
        <Button label={t('plan.notFound.cta')} tone="pri" onPress={() => router.replace('/')} testID="plan-empty-cta" />
      </Screen>
    );
  }

  const title = effectiveLang === 'th' ? plan.theme.titleTh : plan.theme.titleEn;
  const langLabel = t(effectiveLang === 'th' ? 'settings.language.th' : 'settings.language.en');
  const ambienceLabelKey = AMBIENCE_LABEL_KEY[plan.ambienceKey] ?? 'plan.ambience.silence';

  const handlePlayAnchor = (): void => {
    if (!signature) return;
    void playAnchorOnce(signature, { volume: 0.15, pan: 0 });
  };

  return (
    <Screen
      testID="screen-plan"
      withTabBarInset={false}
      footer={
        <View style={styles.footerWrap}>
          <Button
            label={t('plan.footer.next')}
            tone="pri"
            size="big"
            block
            onPress={() => router.push('/plan/devices')}
            testID="plan-footer-next"
          />
          <Text style={[typeScale.sub, styles.footerHint, { color: colors.mut }]}>{t('plan.footer.hint')}</Text>
        </View>
      }
    >
      <StepNav
        title={t('plan.nav.title')}
        onBack={() => router.back()}
        right={
          <Pressable accessibilityRole="button" onPress={() => router.push('/')} testID="plan-nav-edit">
            <Text style={[typeScale.body, styles.editLink]}>{t('plan.nav.edit')}</Text>
          </Pressable>
        }
        testID="plan-nav"
      />

      <GlassSurface tint="regular" radius={radius.plan} contentStyle={styles.card} testID="plan-card">
        <View style={styles.header}>
          <Text style={styles.emoji}>{plan.theme.emoji}</Text>
          <View style={styles.headerText}>
            <Text style={[typeScale.h2, { color: colors.ink }]} numberOfLines={1}>
              {title}
            </Text>
            {plan.theme.place ? (
              <Text style={[typeScale.sub, { color: colors.ink2 }]} numberOfLines={1}>
                {plan.theme.place}
              </Text>
            ) : null}
          </View>
          <View style={styles.readyChip}>
            <Text style={[typeScale.chipSm, { color: colors.rem }]}>{t('plan.card.ready')}</Text>
          </View>
        </View>

        <PlanRow label={t('advisor.plan.seedLabel')}>
          <Text style={[typeScale.sub, styles.rowValueText, { color: colors.ink }]} numberOfLines={3}>
            “{plan.seedLines[0]} · {plan.seedLines[1]}”
          </Text>
        </PlanRow>

        <PlanRow label={t('advisor.plan.anchorLabel')}>
          <View style={styles.anchorValue}>
            <Text style={[typeScale.sub, { color: colors.ink }]} numberOfLines={1}>
              “{plan.anchorPhrase}”
            </Text>
            <Text style={[typeScale.sub, styles.anchorSub, { color: colors.mut }]}>
              {t('advisor.plan.anchorSub', { langLabel })}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={handlePlayAnchor}
            style={styles.playButton}
            testID="plan-play-anchor"
          >
            <Icon name="play" size={12} color={colors.ink} />
          </Pressable>
        </PlanRow>

        <PlanRow label={t('plan.row.bed')}>
          <Text style={[typeScale.sub, { color: colors.ink }]}>{t(ambienceLabelKey)}</Text>
          <Icon name="volume" size={14} color={colors.mut} />
        </PlanRow>

        <PlanRow label={t('advisor.plan.tonightLabel')}>
          <Text style={[typeScale.sub, styles.rowValueText, { color: colors.ink }]}>{t('plan.tonight.full')}</Text>
        </PlanRow>

        <PlanRow label={t('plan.row.devices')} last>
          <Icon name="heart" size={13} color={colors.mut} />
          <Text style={[typeScale.sub, { color: colors.ink }]}>{heartConnected}</Text>
          <Icon name="phones" size={13} color={colors.mut} />
          <Text style={[typeScale.sub, { color: colors.ink }]}>{audioConnected}</Text>
          <Icon name="check" size={13} color={colors.rem} />
          <Text style={[typeScale.sub, { color: colors.rem }]}>{t('plan.devices.connected')}</Text>
        </PlanRow>
      </GlassSurface>

      <GlassCard variant="soft" contentStyle={styles.infoCard} testID="plan-info">
        <Icon name="info" size={15} color={colors.mut} />
        <Sub style={styles.infoText}>{t('plan.info.body')}</Sub>
      </GlassCard>
    </Screen>
  );
}

interface PlanRowProps {
  label: string;
  last?: boolean;
  children: ReactNode;
}

/** Mirrors `PlanCardCompact.tsx`'s internal `Row` (WO L1.4) — label column fixed width, hairline above. */
function PlanRow({ label, last = false, children }: PlanRowProps) {
  return (
    <View style={[styles.row, { borderTopColor: colors.hairline }, last && styles.rowLast]}>
      <Text style={[typeScale.label, styles.rowLabel, { color: colors.mut }]} numberOfLines={2}>
        {label}
      </Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingBottom: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 16, paddingVertical: 12 },
  emoji: { fontSize: 30, lineHeight: 34 },
  headerText: { flex: 1, minWidth: 0 },
  readyChip: {
    paddingHorizontal: 10,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.remBg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLast: { paddingBottom: 12 },
  rowLabel: { width: 84, flexShrink: 0, flexGrow: 0, paddingTop: 1 },
  rowValue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', minWidth: 0 },
  rowValueText: { flex: 1, lineHeight: 18 },
  anchorValue: { flex: 1, minWidth: 0 },
  anchorSub: { marginTop: 1 },
  playButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glass2 },
  infoCard: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  infoText: { flex: 1, lineHeight: 17 },
  editLink: { color: colors.acc, fontWeight: '500' },
  footerWrap: { gap: spacing.xs },
  footerHint: { textAlign: 'center' },
});

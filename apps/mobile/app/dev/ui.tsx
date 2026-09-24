/**
 * `/dev/ui` — the component gallery WO L1.2 exists partly to produce (APP-RUN §2 L1.2 ·
 * oracle U4.3). Every component from `src/ui` renders here with sample data, once in
 * light mode and once in night mode, so `expo export --platform web` + a headless
 * screenshot is enough to compare the whole design system against the mockups in one
 * shot — nobody has to click through the real tabs/onboarding flow (which do not exist
 * as full features yet) just to see what a `Chip.dg` or a night `GlassCard` looks like.
 *
 * This route is dev/QC tooling, not a user-facing screen — but rule B (`fitness.mts`)
 * does not carve out an exception for that, so every string still comes from `src/i18n`.
 */

import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useT } from '../../src/i18n';
import {
  AppBackground,
  Band,
  Bubble,
  Button,
  Chip,
  Composer,
  EventRow,
  FloatingTabBar,
  GlassCard,
  Hyp,
  NightBackground,
  Row,
  Scale,
  Seg,
  SectionLabel,
  Sub,
  Switch,
  Title,
  spacing,
} from '../../src/ui';

function LightGallery() {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [scaleValue, setScaleValue] = useState<number | null>(7);
  const [locale, setLocaleDemo] = useState('th');
  const [autoLevel, setAutoLevel] = useState(true);
  const [activeTab, setActiveTab] = useState('index');

  return (
    <View testID="gallery-light">
      <Title>{t('dev.section.light')}</Title>

      <SectionLabel>{t('dev.section.glass')}</SectionLabel>
      <View style={styles.wrapRow}>
        <GlassCard variant="regular" style={styles.flexCard}>
          <Sub>{t('dev.card.regular')}</Sub>
        </GlassCard>
        <GlassCard variant="soft" style={styles.flexCard}>
          <Sub>{t('dev.card.soft')}</Sub>
        </GlassCard>
        <GlassCard variant="acc" style={styles.flexCard}>
          <Sub>{t('dev.card.acc')}</Sub>
        </GlassCard>
      </View>

      <SectionLabel>{t('dev.section.chips')}</SectionLabel>
      <GlassCard variant="soft">
        <View style={styles.wrapRow}>
          <Chip label={t('dev.chip.whale')} />
          <Chip label={t('dev.chip.city')} tone="on" />
          <Chip label={t('dev.chip.other')} tone="acc" />
          <Chip label={t('dev.chip.rem')} tone="rem" />
          <Chip label={t('dev.chip.danger')} tone="dg" />
          <Chip label={t('dev.chip.other')} size="sm" />
        </View>
      </GlassCard>

      <SectionLabel>{t('dev.section.buttons')}</SectionLabel>
      <GlassCard variant="soft">
        <Button label={t('dev.button.pri')} tone="pri" block testID="gallery-btn-pri" />
        <Button label={t('dev.button.acc')} tone="acc" block testID="gallery-btn-acc" />
        <Button label={t('dev.button.gh')} tone="gh" block testID="gallery-btn-gh" />
        <Button label={t('dev.button.dg')} tone="dg" block testID="gallery-btn-dg" />
        <View style={styles.wrapRow}>
          <Button label={t('dev.button.gh')} tone="gh" size="sm" testID="gallery-btn-sm" />
          <Button label={t('dev.button.pri')} tone="pri" size="big" testID="gallery-btn-big" />
        </View>
      </GlassCard>

      <SectionLabel>{t('dev.section.composer')}</SectionLabel>
      <GlassCard variant="soft">
        <Bubble role="ai" text={t('dev.bubble.ai')} testID="gallery-bubble-ai" />
        <Bubble role="me" text={t('dev.bubble.me')} voice testID="gallery-bubble-me-voice" />
        <Composer
          value={draft}
          onChangeText={setDraft}
          placeholder={t('tonight.placeholder')}
          micActive={micActive}
          onMicPress={() => setMicActive((current) => !current)}
          onSend={() => setDraft('')}
          testID="gallery-composer"
        />
      </GlassCard>

      <SectionLabel>{t('dev.section.inputs')}</SectionLabel>
      <GlassCard variant="soft" contentStyle={{ gap: spacing.lg }}>
        <View>
          <Sub>{t('dev.scale.label')}</Sub>
          <Scale value={scaleValue} onChange={setScaleValue} testID="gallery-scale" />
        </View>
        <Seg
          testID="gallery-seg"
          options={[
            { value: 'th', label: t('settings.language.th') },
            { value: 'en', label: t('settings.language.en') },
          ]}
          value={locale}
          onChange={setLocaleDemo}
        />
        <Row
          label={t('dev.switch.label')}
          right={<Switch value={autoLevel} onValueChange={setAutoLevel} testID="gallery-switch" />}
          last
        />
      </GlassCard>

      <SectionLabel>{t('dev.band.label')}</SectionLabel>
      <GlassCard variant="soft">
        <Band
          testID="gallery-band"
          segments={[
            { kind: 'guard', startFraction: 0, endFraction: 0.35 },
            { kind: 'watch', startFraction: 0.35, endFraction: 1 },
            { kind: 'rem', startFraction: 0.42, endFraction: 0.48 },
            { kind: 'rem', startFraction: 0.58, endFraction: 0.63 },
            { kind: 'rem', startFraction: 0.78, endFraction: 0.86 },
          ]}
          ticks={[
            { kind: 'cue', fraction: 0.44 },
            { kind: 'cue', fraction: 0.6 },
            { kind: 'cue', fraction: 0.8 },
            { kind: 'wake', fraction: 0.5 },
          ]}
        />
        <EventRow time="23:10" title={t('dev.event.start.title')} sub={t('dev.event.start.sub')} />
        <EventRow time="03:12" title={t('dev.event.cue.title')} sub={t('dev.event.cue.sub')} />
        <EventRow time="04:05" title={t('dev.event.wake.title')} sub={t('dev.event.wake.sub')} last />
      </GlassCard>

      <SectionLabel>{t('dev.section.hyp')}</SectionLabel>
      <GlassCard variant="soft">
        <Hyp
          testID="gallery-hyp"
          bars={[
            { value: 0.3, tone: 'ctl' },
            { value: 0.55, tone: 'default' },
            { value: 0.8, tone: 'on' },
            { value: 0.45, tone: 'default' },
            { value: 0.9, tone: 'on' },
            { value: 0.25, tone: 'ctl' },
            { value: 0.6, tone: 'default' },
            { value: 0.7, tone: 'on' },
          ]}
        />
        <View style={styles.wrapRow}>
          <Chip label={t('dev.hyp.legend.on')} tone="acc" size="sm" />
          <Chip label={t('dev.hyp.legend.default')} size="sm" />
          <Chip label={t('dev.hyp.legend.ctl')} size="sm" />
        </View>
      </GlassCard>

      <SectionLabel>{t('dev.section.tabbar')}</SectionLabel>
      <Sub>{t('dev.tabbar.title')}</Sub>
      <View style={styles.tabBarDemo}>
        <FloatingTabBar
          testID="gallery-tabbar"
          activeKey={activeTab}
          onPress={setActiveTab}
          items={[
            { key: 'index', label: t('tabs.tonight'), icon: 'moon' },
            { key: 'journal', label: t('tabs.journal'), icon: 'book' },
            { key: 'settings', label: t('tabs.settings'), icon: 'gear' },
          ]}
        />
      </View>
    </View>
  );
}

function NightGallery() {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState('journal');

  return (
    <View style={styles.nightFrame} testID="gallery-night">
      <NightBackground style={styles.nightBackground}>
        <View style={styles.nightContent}>
          <Title night>{t('dev.section.night')}</Title>

          <GlassCard night variant="regular">
            <Sub night>{t('dev.card.regular')}</Sub>
          </GlassCard>

          <View style={styles.wrapRow}>
            <Chip label={t('dev.chip.whale')} night />
            <Chip label={t('dev.chip.rem')} tone="rem" night />
            <Chip label={t('dev.chip.other')} tone="on" night />
          </View>

          <View style={{ gap: spacing.md }}>
            <Button label={t('dev.button.pri')} tone="pri" night block />
            <Button label={t('dev.button.dg')} tone="dg" night block />
          </View>

          <Bubble role="ai" text={t('dev.bubble.ai')} night />
          <Bubble role="me" text={t('dev.bubble.me')} night />

          <Band
            night
            testID="gallery-band-night"
            segments={[
              { kind: 'guard', startFraction: 0, endFraction: 0.35 },
              { kind: 'watch', startFraction: 0.35, endFraction: 1 },
              { kind: 'rem', startFraction: 0.5, endFraction: 0.58 },
            ]}
            ticks={[{ kind: 'cue', fraction: 0.52 }]}
          />

          <View style={styles.tabBarDemoNight}>
            <FloatingTabBar
              testID="gallery-tabbar-night"
              night
              activeKey={activeTab}
              onPress={setActiveTab}
              items={[
                { key: 'index', label: t('tabs.tonight'), icon: 'moon' },
                { key: 'journal', label: t('tabs.journal'), icon: 'book' },
                { key: 'settings', label: t('tabs.settings'), icon: 'gear' },
              ]}
            />
          </View>
        </View>
      </NightBackground>
    </View>
  );
}

export default function DevUiGallery() {
  const { t } = useT();

  return (
    <AppBackground testID="screen-dev-ui">
      <Stack.Screen options={{ headerShown: true, title: t('dev.title') }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Sub>{t('dev.subtitle')}</Sub>
        <LightGallery />
        <NightGallery />
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxxl * 2 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexCard: { flexGrow: 1, flexBasis: 140 },
  tabBarDemo: { height: 100 },
  tabBarDemoNight: { height: 100 },
  nightFrame: { height: 900, borderRadius: 24, overflow: 'hidden', marginTop: spacing.xl },
  nightBackground: { flex: 1 },
  nightContent: { padding: spacing.xl, gap: spacing.lg },
});

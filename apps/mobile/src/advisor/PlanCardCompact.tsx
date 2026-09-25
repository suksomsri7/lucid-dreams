/**
 * `.plan.cmp` (`ledger/design-app/_base.part` + `03-advisor-chat.body.html`) — the
 * compact dream-plan card that appears inline in the advisor conversation once a plan
 * exists. The full-screen version (mockup `04-dream-plan.png`, all the same rows plus a
 * a "continue · check devices" button) is WO L1.5's `apps/mobile/app/plan.tsx`; this WO only
 * ships the stub route that screen will replace (see `AdvisorRoom.tsx`).
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { GlassSurface, Icon, colors, night, radius, spacing, typeScale } from '../ui';
import type { DreamPlan } from './types';

/**
 * WO L3.10 (R1 hotfix #2): what the "▶" row is doing right now. `'loading'` covers the
 * first tap of a night (`ensureFullAnchorUri` still has to download the file, ~1–4 s per
 * the WO) — `'playing'` is everything after that, until the clip finishes or the ~11 s
 * safety timeout in `AdvisorRoom.tsx` fires. `'idle'` is the row's normal resting state.
 */
export type AnchorPlaybackStatus = 'idle' | 'loading' | 'playing';

export interface PlanCardCompactProps {
  plan: DreamPlan;
  night?: boolean;
  /** No real audio yet (the anchor player is WO L1.6/L1.7) — omit to render the row inert. */
  onPlayAnchor?: () => void;
  /** Defaults to `'idle'` — `AdvisorRoom.tsx` is the only caller that ever passes anything else. */
  anchorStatus?: AnchorPlaybackStatus;
  testID?: string;
}

export function PlanCardCompact({
  plan,
  night: isNight = false,
  onPlayAnchor,
  anchorStatus = 'idle',
  testID,
}: PlanCardCompactProps) {
  const { t, locale } = useT();
  const title = locale === 'th' ? plan.theme.titleTh : plan.theme.titleEn;
  const langLabel = t(locale === 'th' ? 'settings.language.th' : 'settings.language.en');

  return (
    <GlassSurface tint="regular" night={isNight} radius={radius.plan} testID={testID} contentStyle={styles.surface}>
      <View style={styles.header}>
        <Text style={styles.emoji}>{plan.theme.emoji}</Text>
        <View style={styles.headerText}>
          <Text style={[typeScale.h2, { color: isNight ? night.text : colors.ink }]} numberOfLines={1}>
            {title}
          </Text>
          {plan.theme.place ? (
            <Text style={[typeScale.sub, { color: isNight ? night.sub : colors.ink2 }]} numberOfLines={1}>
              {plan.theme.place}
            </Text>
          ) : null}
        </View>
      </View>

      <Row label={t('advisor.plan.seedLabel')} night={isNight}>
        <Text
          style={[typeScale.sub, styles.rowValueText, { color: isNight ? night.text : colors.ink }]}
          numberOfLines={2}
        >
          “{plan.seedLines[0]} · {plan.seedLines[1]}”
        </Text>
      </Row>

      <Row label={t('advisor.plan.anchorLabel')} night={isNight}>
        <View style={styles.anchorValue}>
          <Text style={[typeScale.sub, { color: isNight ? night.text : colors.ink }]} numberOfLines={1}>
            “{plan.anchorPhrase}”
          </Text>
          <Text style={[typeScale.sub, styles.anchorSub, { color: isNight ? night.mut : colors.mut }]}>
            {t('advisor.plan.anchorSub', { langLabel })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          // Disabled with no handler at all (unchanged behaviour), and also disabled
          // while a preview is loading/playing — the WO's "gate kept but repointed" rule
          // for a duplicate-guard: a second tap mid-playback must not start a second
          // `playAnchorPreview` call.
          disabled={!onPlayAnchor || anchorStatus !== 'idle'}
          onPress={onPlayAnchor}
          testID={testID ? `${testID}-play` : undefined}
          style={[
            styles.playButton,
            { backgroundColor: isNight ? night.glassBg : colors.glass2 },
            anchorStatus === 'playing' && styles.playButtonPlaying,
          ]}
        >
          {anchorStatus === 'loading' ? (
            <ActivityIndicator size="small" color={isNight ? night.text : colors.ink} testID={testID ? `${testID}-play-loading` : undefined} />
          ) : (
            <Icon
              name={anchorStatus === 'playing' ? 'pause' : 'play'}
              size={12}
              color={isNight ? night.text : colors.ink}
            />
          )}
        </Pressable>
      </Row>

      <Row label={t('advisor.plan.tonightLabel')} night={isNight} last>
        <Text style={[typeScale.sub, { color: isNight ? night.text : colors.ink }]}>{t('advisor.plan.tonightValue')}</Text>
      </Row>
    </GlassSurface>
  );
}

interface RowProps {
  label: string;
  night: boolean;
  last?: boolean;
  children: ReactNode;
}

/** `.plan .pr` — label column fixed width, value flexes, hairline border above (except the header row). */
function Row({ label, night: isNight, last = false, children }: RowProps) {
  return (
    <View
      style={[
        styles.row,
        { borderTopColor: isNight ? night.glassBorder : colors.hairline },
        last && styles.rowLast,
      ]}
    >
      <Text style={[typeScale.label, styles.rowLabel, { color: isNight ? night.mut : colors.mut }]} numberOfLines={2}>
        {label}
      </Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { paddingBottom: 2 },
  // 12×16 (Fable parity review round 3 — was 18×sm/xs in round 2).
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 16, paddingVertical: 12 },
  emoji: { fontSize: 28, lineHeight: 32 },
  headerText: { flex: 1, minWidth: 0 },
  // 10×16 (Fable parity review round 3 — was 12×18 in round 2).
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowLast: { paddingBottom: 10 },
  rowLabel: { width: 84, flexShrink: 0, flexGrow: 0, paddingTop: 1 },
  rowValue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  rowValueText: { flex: 1, lineHeight: 17 },
  anchorValue: { flex: 1, minWidth: 0 },
  anchorSub: { marginTop: 1 },
  playButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  // Dimmed, not re-coloured (the WO's "changed/dimmed icon while playing" — no new colour token).
  playButtonPlaying: { opacity: 0.55 },
});

/**
 * The morning flow's state machine (WO L3.1 · DESIGN §3.2's "morning, two steps" ·
 * §3.3's own last bullet · mockup `06-morning.png`). `MorningFlow.tsx` only renders whatever this
 * hook returns — every async step (loading last night, the mic, saving partial answers,
 * scoring, building the result sentence) lives here, the same split `useAdvisor.ts` /
 * `AdvisorRoom.tsx` already use.
 *
 * `GREET → RECORD → QUESTIONS → RESULT` (the WO's own names):
 *   - `GREET`     the greeting bubble is up, nothing has been said yet, mic idle.
 *   - `RECORD`    the mic is actively listening (live partials land in `liveText`).
 *   - `QUESTIONS` a transcript exists (spoken, typed, or "can't remember" → `''`); the 4
 *                 fixed questions plus `cueWoke` (only on a night that actually played a
 *                 whisper — `morningQuestionOrder`) are asked one at a time.
 *   - `RESULT`    every question answered, the report saved, `/ai/score` tried (only if
 *                 `consentAi`), the result sentence built via `morningResultMessage`.
 *
 * Two ways in: a real session (`sessionId`, loaded from `@lucid/data` via
 * `fetchNightReport` — this hook never touches `getRepo` directly, same repo-access
 * discipline as every other screen) or a web QC fixture (`morningFixtureRequested()`),
 * which skips the database/network entirely and seeds the identical shape synchronously
 * (`src/dev/fixtures.ts`'s own convention, e.g. `startNightFixture`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { morningResultMessage, nextNightVolume, type AiScore, type CueEvent, type CueType } from '@lucid/engine';

import { requestAiScore } from '../api/score';
import type { DreamPlan } from '../advisor/types';
import { fetchNightReport } from '../data/report';
import { saveMorningAiScore, saveMorningReport } from '../data/morning';
import { morningFixturePlan, morningFixtureRequested } from '../dev/fixtures';
import { translate, useT, type Locale } from '../i18n';
import { ambienceSource } from '../audio/ambience';
import { getPlatform } from '../platform';
import { planFromSessionParams } from '../report/format';
import { saveTonightPlan } from '../store/night';
import { useOnboardingState } from '../store/onboarding';
import { EMPTY_MORNING_ANSWERS, morningAnswersComplete, morningQuestionOrder, type MorningAnswers } from './questions';

/** Ambience-while-recalling volume (DESIGN §4-06's "play last night's ambience" pill) —
 * quiet enough to hum under the user's own voice, not the full night's `BED_VOLUME_FULL`. */
const REPLAY_VOLUME = 0.12;
/** `earTestScreen.tsx`'s own fallback, kept in sync — `nextNightVolume`'s starting rail when a night somehow had no cues. */
const DEFAULT_VOLUME_START = 0.15;

export type MorningTopState = 'GREET' | 'RECORD' | 'QUESTIONS' | 'RESULT';

interface MorningContext {
  plan: DreamPlan;
  /** Real ("WHISPER"/etc, never "SEED") cues, oldest first — same filter `report/[id].tsx` uses. */
  cueEvents: CueEvent[];
  cuesPlayed: number;
  anyCueWoke: boolean;
  currentVolume: number;
}

/** One row of the morning conversation — `MorningFlow.tsx`'s only rendering contract. */
export interface MorningMessage {
  id: string;
  kind: 'ai' | 'me';
  text: string;
  voice?: boolean;
  scale?: { value: number | null; onAnswer: (n: number) => void; testID: string };
  chips?: { key: string; label: string; selected?: boolean; onPress?: () => void }[];
}

export interface UseMorningOptions {
  /** `null` while `app/(tabs)/index.tsx` hasn't decided a session is pending yet. */
  sessionId: string | null;
}

export interface UseMorningResult {
  state: MorningTopState;
  /** `false` until last night's plan/cues have loaded (or the fixture seeded) — render nothing yet. */
  ready: boolean;
  plan: DreamPlan | null;
  greetText: string;
  cantRememberLabel: string;
  micLabel: string;
  micUnavailable: boolean;
  listening: boolean;
  liveText: string;
  transcribingLabel: string;
  typeInsteadLabel: string;
  composerPlaceholder: string;
  draft: string;
  setDraft: (text: string) => void;
  onMicPress: () => void;
  onSend: () => void;
  onCantRemember: () => void;
  replayLabel: string;
  ambiencePlaying: boolean;
  onToggleReplay: () => void;
  messages: MorningMessage[];
  finalizing: boolean;
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `app/(tabs)/index.tsx`'s own gate: is there a night that ended with nobody having
 * told the morning room about it yet? `null`/thrown (web, no session, DB not open yet)
 * all read as "not pending" — the tab falls back to the advisor room, same as every
 * other best-effort read in this app. */
export async function isMorningPending(sessionId: string | null): Promise<boolean> {
  if (sessionId === null || Platform.OS === 'web') return false;
  try {
    const report = await fetchNightReport(sessionId);
    return report.session.endedAt !== null && report.report === null && planFromSessionParams(report.session.params) !== null;
  } catch {
    return false;
  }
}

/** Same theme/cues for both `morning-record` and `morning-result` (WO L3.1's own fixture pair). */
function fixtureContext(lang: Locale): MorningContext {
  const plan = morningFixturePlan(lang);
  const at = (min: number, sec: number) => Math.floor(Date.parse('2026-09-24T00:00:00.000Z') / 1000) + min * 60 + sec;
  const cueEvents: CueEvent[] = [
    { t: at(3, 12), index: 1, volume: 0.15, type: 'WHISPER' as CueType, pRemAtCue: 0.75, played: true, response: 'NONE' },
    { t: at(3, 19), index: 2, volume: 0.18, type: 'WHISPER' as CueType, pRemAtCue: 0.78, played: true, response: 'NONE' },
    { t: at(5, 40), index: 3, volume: 0.18, type: 'WHISPER' as CueType, pRemAtCue: 0.8, played: true, response: 'NONE' },
  ];
  return { plan, cueEvents, cuesPlayed: 3, anyCueWoke: false, currentVolume: 0.18 };
}

async function loadRealContext(sessionId: string): Promise<MorningContext | null> {
  const report = await fetchNightReport(sessionId);
  const plan = planFromSessionParams(report.session.params);
  if (plan === null) return null;
  const realCues = report.cues.filter((cue) => cue.type !== 'SEED');
  const cueEvents: CueEvent[] = realCues.map((cue) => ({
    t: Math.floor(Date.parse(cue.at) / 1000),
    index: cue.index,
    volume: cue.volume,
    type: cue.type as CueType,
    pRemAtCue: cue.pRemAtCue ?? 0,
    played: cue.played,
    response: cue.response,
  }));
  return {
    plan,
    cueEvents,
    cuesPlayed: cueEvents.filter((cue) => cue.played).length,
    anyCueWoke: cueEvents.some((cue) => cue.response === 'WOKE'),
    currentVolume: cueEvents[cueEvents.length - 1]?.volume ?? DEFAULT_VOLUME_START,
  };
}

export function useMorning({ sessionId }: UseMorningOptions): UseMorningResult {
  const { t, locale } = useT();
  const router = useRouter();
  const { consentAi } = useOnboardingState();
  const fixture = morningFixtureRequested();

  const [context, setContext] = useState<MorningContext | null>(null);
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(fixture === 'morning-record');
  const [liveText, setLiveText] = useState(fixture === 'morning-record' ? translate(locale, 'morning.fixture.liveText') : '');
  const [micUnavailable, setMicUnavailable] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(fixture === 'morning-record' ? 42 : 0);
  const [transcript, setTranscript] = useState<string | null>(
    fixture === 'morning-result' ? translate(locale, 'morning.fixture.transcript') : null,
  );
  const [transcriptVoice, setTranscriptVoice] = useState(true);
  const [answers, setAnswers] = useState<MorningAnswers>(
    fixture === 'morning-result' ? FIXTURE_ANSWERS : EMPTY_MORNING_ANSWERS,
  );
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [ambiencePlaying, setAmbiencePlaying] = useState(false);
  const reportIdRef = useRef<string | null>(null);
  const finalizedRef = useRef(fixture === 'morning-result');
  const unsubscribers = useRef<Array<() => void>>([]);

  // Load last night's plan + cues (real session) or the fixture's synthetic equivalent.
  useEffect(() => {
    let cancelled = false;
    if (fixture !== null) {
      setContext(fixtureContext(locale));
      return;
    }
    if (sessionId === null) return;
    void loadRealContext(sessionId)
      .then((loaded) => {
        if (!cancelled) setContext(loaded);
      })
      .catch(() => {
        if (!cancelled) setContext(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixture/locale only matter for the fixture branch, re-read once
  }, [sessionId, fixture]);

  // Build the fixture-result's result sentence once the context (theme/cues) is in —
  // synchronous, no network/DB (Platform.OS === 'web' the whole time a fixture runs).
  useEffect(() => {
    if (fixture !== 'morning-result' || context === null || resultMessage !== null) return;
    const message = morningResultMessage({
      score: null,
      report: { lucid: FIXTURE_ANSWERS.lucid, themeMatchUser: FIXTURE_ANSWERS.themeMatch, cueWoke: FIXTURE_ANSWERS.cueWoke ?? false },
      cues: context.cuesPlayed,
      nextVolume: nextNightVolume(context.cueEvents, context.currentVolume),
      lang: locale,
    });
    setResultMessage(message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixture-only, runs once context is ready
  }, [fixture, context, resultMessage]);

  // The listening timer — real recording only (the fixture's "0:42" is a fixed prop, not a ticking clock).
  useEffect(() => {
    if (!listening || fixture !== null) return undefined;
    const interval = setInterval(() => setElapsedSec((sec) => sec + 1), 1000);
    return () => clearInterval(interval);
  }, [listening, fixture]);

  function stopMicListeners(): void {
    for (const unsubscribe of unsubscribers.current) unsubscribe();
    unsubscribers.current = [];
  }

  function commitTranscript(text: string, fromVoice: boolean): void {
    setTranscript(text);
    setTranscriptVoice(fromVoice);
    setDraft('');
    setListening(false);
    setElapsedSec(0);
  }

  function onMicPress(): void {
    if (fixture !== null) return; // fixtures never touch the real mic
    if (listening) {
      stopMicListeners();
      setListening(false);
      void getPlatform().speechToText.stop().catch(() => undefined);
      return;
    }

    setMicUnavailable(false);
    void (async () => {
      const platform = getPlatform();
      try {
        const available = await platform.speechToText.isAvailable();
        if (!available) throw new Error('speech-to-text not available on this device');
        const granted = await platform.speechToText.requestPermissions();
        if (!granted) throw new Error('speech-to-text permission denied');

        const unsubscribeResult = platform.speechToText.onResult((result) => {
          setLiveText(result.text);
          if (result.isFinal) {
            const finalText = result.text.trim();
            stopMicListeners();
            void platform.speechToText.stop().catch(() => undefined);
            if (finalText.length > 0) commitTranscript(finalText, true);
            else setListening(false);
          }
        });
        const unsubscribeError = platform.speechToText.onError(() => {
          stopMicListeners();
          setListening(false);
          setMicUnavailable(true);
        });
        unsubscribers.current = [unsubscribeResult, unsubscribeError];

        await platform.speechToText.start({ locale: locale === 'th' ? 'th-TH' : 'en-US' });
        setLiveText('');
        setElapsedSec(0);
        setListening(true);
      } catch {
        stopMicListeners();
        setListening(false);
        setMicUnavailable(true);
      }
    })();
  }

  function onSend(): void {
    const text = draft.trim();
    if (text.length === 0) return;
    stopMicListeners();
    void getPlatform().speechToText.stop().catch(() => undefined);
    commitTranscript(text, false);
  }

  function onCantRemember(): void {
    stopMicListeners();
    void getPlatform().speechToText.stop().catch(() => undefined);
    commitTranscript('', false);
  }

  async function onToggleReplay(): Promise<void> {
    if (context === null || fixture !== null) return;
    const platform = getPlatform();
    if (ambiencePlaying) {
      setAmbiencePlaying(false);
      await platform.audioPlayer.stopBed().catch(() => undefined);
      return;
    }
    try {
      await platform.audioPlayer.configureSession();
      await platform.audioPlayer.startBed(REPLAY_VOLUME, ambienceSource(context.plan.ambienceKey));
      setAmbiencePlaying(true);
    } catch {
      // Best-effort, same as every other ambience call in this app (`night/session.ts`) — silence on failure.
    }
  }

  // Stop the replay bed if the screen unmounts (or the plan changes under it) mid-play.
  useEffect(() => {
    return () => {
      if (ambiencePlaying) void getPlatform().audioPlayer.stopBed().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup-only
  }, []);

  function persistPartial(next: MorningAnswers): void {
    if (sessionId === null || fixture !== null || Platform.OS === 'web') return;
    void saveMorningReport({
      sessionId,
      dreamed: next.dreamed,
      themeMatchUser: next.themeMatch,
      lucid: next.lucid,
      sleepQuality: next.sleepQuality,
      cueWoke: next.cueWoke,
      transcript,
    })
      .then((saved) => {
        reportIdRef.current = saved.id;
      })
      .catch(() => undefined);
  }

  async function finalize(finalAnswers: MorningAnswers): Promise<void> {
    if (finalizedRef.current || context === null) return;
    finalizedRef.current = true;
    setFinalizing(true);

    const recordedAtIso = new Date().toISOString();
    let reportId = reportIdRef.current;

    if (sessionId !== null && fixture === null && Platform.OS !== 'web') {
      try {
        const saved = await saveMorningReport({
          sessionId,
          dreamed: finalAnswers.dreamed,
          themeMatchUser: finalAnswers.themeMatch,
          lucid: finalAnswers.lucid,
          sleepQuality: finalAnswers.sleepQuality,
          cueWoke: finalAnswers.cueWoke,
          transcript,
          recordedAt: recordedAtIso,
        });
        reportId = saved.id;
        reportIdRef.current = saved.id;
      } catch {
        // Best-effort, same policy as `night/session.ts#persist` — the screen still has to finish.
      }
    }

    // §0.5 S4 / oracle M1.10: the transcript never leaves the device unless the user
    // opted in — no `consentAi`, no network call at all, not even one that would be
    // discarded on return.
    let score: AiScore | null = null;
    if (consentAi && transcript !== null && transcript.trim() !== '') {
      try {
        score = await requestAiScore(context.plan, transcript, finalAnswers, locale);
      } catch {
        score = null;
      }
      if (score !== null && reportId !== null && fixture === null && Platform.OS !== 'web') {
        try {
          await saveMorningAiScore({
            reportId,
            themeMatch: score.themeMatch,
            matchedTerms: score.matchedTerms,
            lucidSignals: score.lucidSignals,
            tags: score.tags,
            summary: score.summary,
            model: score.model ?? null,
            at: recordedAtIso,
          });
        } catch {
          // Best-effort — the result sentence below already has everything it needs in memory.
        }
      }
    }

    const nextVolume = nextNightVolume(context.cueEvents, context.currentVolume);
    const message = morningResultMessage({
      score,
      report: { lucid: finalAnswers.lucid, themeMatchUser: finalAnswers.themeMatch, cueWoke: finalAnswers.cueWoke ?? false },
      cues: context.cuesPlayed,
      nextVolume,
      lang: locale,
    });
    setResultMessage(message);
    setFinalizing(false);
  }

  function applyAnswer<K extends keyof MorningAnswers>(key: K, value: NonNullable<MorningAnswers[K]>): void {
    if (context === null || answers[key] !== null) return;
    const next: MorningAnswers = { ...answers, [key]: value };
    setAnswers(next);
    persistPartial(next);
    if (morningAnswersComplete(next, context.cuesPlayed)) void finalize(next);
  }

  function onViewReport(): void {
    if (sessionId !== null) router.push(`/report/${sessionId}`);
  }

  function onSameTheme(): void {
    if (context === null) return;
    saveTonightPlan(context.plan, locale);
    router.push('/plan');
  }

  const order = useMemo(() => (context === null ? [] : morningQuestionOrder(context.cuesPlayed)), [context]);
  const currentIndex = order.findIndex((q) => answers[q.key] === null);
  const visibleOrder = currentIndex === -1 ? order : order.slice(0, currentIndex + 1);

  const greetText =
    context === null
      ? ''
      : t('morning.greet', {
          cuesLine: t(
            context.cuesPlayed === 0 ? 'morning.greet.cues.none' : context.anyCueWoke ? 'morning.greet.cues.woke' : 'morning.greet.cues',
            { n: context.cuesPlayed },
          ),
        });

  const messages: MorningMessage[] = [];
  if (transcript !== null && context !== null) {
    messages.push({
      id: 'transcript',
      kind: 'me',
      text: transcript.trim() === '' ? t('morning.chip.cantRemember') : transcript,
      voice: transcript.trim() !== '' && transcriptVoice,
    });

    for (const question of visibleOrder) {
      const questionText =
        question.key === 'themeMatch'
          ? t('morning.q.themeMatch', { emoji: context.plan.theme.emoji, theme: locale === 'th' ? context.plan.theme.titleTh : context.plan.theme.titleEn })
          : t(question.questionKey ?? 'morning.q.dreamed');

      if (question.kind === 'scale10') {
        messages.push({
          id: question.key,
          kind: 'ai',
          text: questionText,
          scale: {
            value: (answers[question.key] as number | null) ?? null,
            onAnswer: (n) => applyAnswer(question.key, n),
            testID: `morning-scale-${question.key}`,
          },
        });
      } else if (question.kind === 'lucidChips') {
        const value = answers.lucid;
        messages.push({
          id: question.key,
          kind: 'ai',
          text: questionText,
          chips: [
            { key: 'YES', label: t('morning.q.lucid.yes'), selected: value === 'YES', onPress: value === null ? () => applyAnswer('lucid', 'YES') : undefined },
            { key: 'NO', label: t('morning.q.lucid.no'), selected: value === 'NO', onPress: value === null ? () => applyAnswer('lucid', 'NO') : undefined },
            { key: 'UNSURE', label: t('morning.q.lucid.unsure'), selected: value === 'UNSURE', onPress: value === null ? () => applyAnswer('lucid', 'UNSURE') : undefined },
          ],
        });
      } else {
        const value = answers.cueWoke;
        messages.push({
          id: question.key,
          kind: 'ai',
          text: questionText,
          chips: [
            { key: 'yes', label: t('morning.q.cueWoke.yes'), selected: value === true, onPress: value === null ? () => applyAnswer('cueWoke', true) : undefined },
            { key: 'no', label: t('morning.q.cueWoke.no'), selected: value === false, onPress: value === null ? () => applyAnswer('cueWoke', false) : undefined },
          ],
        });
      }
    }

    if (finalizing) messages.push({ id: 'finalizing', kind: 'ai', text: t('morning.result.loading') });

    if (resultMessage !== null) {
      messages.push({
        id: 'result',
        kind: 'ai',
        text: resultMessage,
        chips: [
          { key: 'viewReport', label: t('morning.result.viewReport'), onPress: onViewReport },
          { key: 'sameTheme', label: t('morning.result.sameTheme', { emoji: context.plan.theme.emoji }), onPress: onSameTheme },
        ],
      });
    }
  }

  const state: MorningTopState = resultMessage !== null ? 'RESULT' : transcript !== null ? 'QUESTIONS' : listening ? 'RECORD' : 'GREET';

  return {
    state,
    ready: context !== null,
    plan: context?.plan ?? null,
    greetText,
    cantRememberLabel: t('morning.chip.cantRemember'),
    micLabel: listening ? t('morning.mic.listening', { time: formatElapsed(elapsedSec) }) : t('morning.mic.idle'),
    micUnavailable,
    listening,
    liveText,
    transcribingLabel: t('morning.transcribing'),
    typeInsteadLabel: t('morning.typeInstead'),
    composerPlaceholder: t('morning.composer.placeholder'),
    draft,
    setDraft,
    onMicPress,
    onSend,
    onCantRemember,
    replayLabel: t(ambiencePlaying ? 'morning.replay.stop' : 'morning.replay'),
    ambiencePlaying,
    onToggleReplay: () => void onToggleReplay(),
    messages,
    finalizing,
  };
}

// ---------------------------------------------------------------------------
// `?fixture=morning-result` seed data — mockup 06 frame b's exact numbers (WO L3.1: "the
// answers 8/7/YES/7 and a result bubble"). The transcript itself and `?fixture=morning-
// record`'s live-partial text are translation keys (`morning.fixture.*`, `src/i18n/
// th.ts`/`en.ts`) rather than literals here — fitness rule B (no Thai outside `src/i18n`)
// applies to fixture seed data exactly as much as to anything a real user sees.
// ---------------------------------------------------------------------------

const FIXTURE_ANSWERS: MorningAnswers = { dreamed: 8, themeMatch: 7, lucid: 'YES', sleepQuality: 7, cueWoke: false };

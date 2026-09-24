/**
 * The scoring client (WO L3.1 deliverable #2 · DESIGN §6 · APP-RUN §2 L3.2). One call:
 * build the request from tonight's plan + the morning's own answers, POST it, and hand
 * back a score the app is allowed to believe — never the server's raw JSON.
 *
 * `sanitizeAiScore` (packages/engine, untouched by this WO) is the actual trust boundary
 * (APP-RUN §0.5 S3: the transcript is untrusted user text, the model's answer is an
 * untrusted third party's opinion about it) — this file's only job is getting a response
 * to hand that function, and staying quiet when there isn't one.
 */

import { sanitizeAiScore, type AiScore } from '@lucid/engine';

import type { DreamPlan } from '../advisor/types';
import type { Locale } from '../i18n';
import { postScore, type ScoreRequest } from './client';
import type { MorningAnswers } from '../morning/questions';

/**
 * `null` whenever there is nothing worth believing: an empty transcript (nothing to
 * score), a network/route failure (`postScore` already swallows those), or an answer
 * that does not fit `AiScoreSchema` / whose quoted words are not actually in the
 * transcript (`sanitizeAiScore`). The caller (`useMorning.ts`) already gates this call on
 * `consentAi` — this function does not re-check it, same split as `postScore` not
 * re-checking network reachability itself.
 */
export async function requestAiScore(
  plan: DreamPlan,
  transcript: string,
  answers: MorningAnswers,
  lang: Locale,
): Promise<AiScore | null> {
  if (transcript.trim() === '') return null;

  const request: ScoreRequest = {
    transcript,
    theme: plan.theme,
    seedLines: plan.seedLines,
    answers: {
      dreamed: answers.dreamed,
      themeMatchUser: answers.themeMatch,
      lucid: answers.lucid,
      sleepQuality: answers.sleepQuality,
      cueWoke: answers.cueWoke,
    },
    lang,
  };

  const raw = await postScore(request);
  if (raw === null) return null;
  return sanitizeAiScore(raw, transcript);
}

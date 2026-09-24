/**
 * `@lucid/api` — public surface of the AI server package.
 *
 * The server is a library first and a process second (`main.ts`): that is what lets the
 * oracle start it on an ephemeral port with a mock provider and an in-memory store, and it
 * is why there is no module-level side effect anywhere in `src/` except in `main.ts`.
 */

export {
  startServer,
  createApp,
  MAX_BODY_BYTES,
  DEFAULT_RATE_LIMIT_PER_HOUR,
  DEFAULT_DEVICE_LIMIT_PER_HOUR,
  TOKEN_BYTES,
  type StartServerOptions,
  type RunningServer,
} from './server';

export { createMemoryStore, type Store, type DeviceRecord, type CachedAudio } from './store';
export { createLogger, silentLogger, type Logger, type LogFields } from './logger';

export {
  createOpenRouterProvider,
  OpenRouterError,
  OPENROUTER_BASE_URL,
  DREAM_PLAN_SYSTEM_PROMPT,
  buildUserEnvelope,
  type OpenRouterOptions,
} from './providers/openrouter';

export { createMockPlanProvider, brokenPlanProvider, type MockProviderOptions } from './providers/mock';

export {
  mockTtsProvider,
  normalizeTtsAudio,
  resolveTtsProvider,
  sniffAudioContentType,
  wavSilence,
  TTS_MAX_TEXT,
  type TtsAudio,
  type TtsProvider,
  type TtsRequest,
  type TtsLang,
  type TtsVoice,
} from './providers/tts';

export {
  createFalTtsProvider,
  audioUrlOf,
  whisperText,
  TtsError,
  FAL_TTS_ENDPOINT,
  FAL_DEFAULT_VOICE,
  FAL_DEFAULT_STABILITY,
  FAL_MAX_AUDIO_BYTES,
  WHISPER_TAG,
  type FalTtsOptions,
  type TtsErrorCode,
} from './providers/tts-fal';

export {
  mixAnchor,
  pcmToWav,
  buildMixFilter,
  resolveFfmpegPath,
  AnchorMixError,
  ANCHOR_SAMPLE_RATE,
  ANCHOR_WHISPER_DELAY_MS,
  ANCHOR_SIGNATURE_GAIN,
  ANCHOR_MP3_BITRATE,
  ANCHOR_MIX_TIMEOUT_MS,
  type MixAnchorOptions,
  type AnchorMixErrorCode,
} from './anchor';

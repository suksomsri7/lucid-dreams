/**
 * All-night background audio on iOS, via `expo-audio` (SDK 54).
 *
 * Why expo-audio and not expo-av: expo-av is deprecated in SDK 54, and expo-audio
 * already exposes exactly the two things this spike has to prove —
 * `setAudioModeAsync({ shouldPlayInBackground: true })` and `player.loop = true` —
 * so the bed can run for 8 hours with the screen off (DESIGN §8.2 risk list).
 * DESIGN mentions `react-native-track-player` for L1.7 (Now Playing + lock-screen
 * controls); that is a bigger dependency and is not needed to answer the R1 question
 * "does iOS kill our audio session overnight?".
 *
 * Safety (APP-RUN §0.5 S7):
 *  - category is `playback` with `interruptionMode: 'doNotMix'` → mixWithOthers OFF;
 *  - an interruption stops cues and may only bring the *bed* back;
 *  - `playCue` is deliberately not implemented here yet: cue gating belongs to the
 *    engine (L1.7 / L2.6), and shipping a callable cue before the Sleep Guard exists
 *    would be a way to wake the user by accident.
 */

import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer as ExpoAudioPlayer,
} from 'expo-audio';

import { systemClock, type Clock } from '@lucid/engine';

import type { AudioEvent, AudioPlayer, AudioPlayerStatus, Unsubscribe } from '../types';

// Metro asset import — `require` is typed by `expo/types` (types/metro-require.d.ts)
const BED_SOURCE = require('../../../assets/audio/bed-loop.m4a') as number;

/** Hard ceiling from DESIGN §2.3.1 / §0.5 S6 — the engine may never ask for more. */
const MAX_VOLUME = 0.35;

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(Math.max(volume, 0), MAX_VOLUME);
}

export class IosAudioPlayer implements AudioPlayer {
  private player: ExpoAudioPlayer | null = null;
  private status: AudioPlayerStatus = { state: 'idle', volume: 0, route: null, error: null };
  private readonly listeners = new Set<(event: AudioEvent) => void>();

  /** Injected so tests can pin timestamps (APP-RUN §0.2 rule 6). */
  constructor(private readonly clock: Clock = systemClock) {}

  async configureSession(): Promise<void> {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
        allowsRecording: false,
      });
      this.status = { ...this.status, state: 'configured', error: null };
      this.emit('SESSION_CONFIGURED', null);
    } catch (error) {
      this.fail('SESSION_CONFIGURED', error);
      throw error;
    }
  }

  async startBed(volume: number): Promise<void> {
    const target = clampVolume(volume);
    try {
      if (this.status.state === 'idle') await this.configureSession();
      await setIsAudioActiveAsync(true);

      if (!this.player) {
        this.player = createAudioPlayer(BED_SOURCE, { updateInterval: 1000 });
        this.player.loop = true;
      }
      this.player.volume = target;
      this.player.play();

      this.status = { ...this.status, state: 'playing', volume: target, error: null };
      this.emit('SESSION_ACTIVATED', null, target);
      this.emit('BED_START', null, target);
    } catch (error) {
      this.fail('BED_START', error);
      throw error;
    }
  }

  async stopBed(): Promise<void> {
    try {
      this.player?.pause();
      this.status = { ...this.status, state: 'stopped', volume: 0 };
      this.emit('BED_STOP', null, 0);
      await setIsAudioActiveAsync(false);
      this.emit('SESSION_DEACTIVATED', null, 0);
    } catch (error) {
      this.fail('BED_STOP', error);
    }
  }

  async setVolume(volume: number): Promise<void> {
    const target = clampVolume(volume);
    if (this.player) this.player.volume = target;
    this.status = { ...this.status, volume: target };
  }

  async playCue(): Promise<void> {
    // Refused on purpose until the engine owns cue gating (L1.7 + L2.6 Sleep Guard).
    throw new Error('CUE_DISABLED_UNTIL_ENGINE_GATE_EXISTS');
  }

  getStatus(): AudioPlayerStatus {
    return this.status;
  }

  onEvent(listener: (event: AudioEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    try {
      this.player?.remove();
    } catch {
      // already released — nothing to do
    }
    this.player = null;
    this.status = { ...this.status, state: 'stopped', volume: 0 };
  }

  private fail(kind: AudioEvent['kind'], error: unknown): void {
    const detail = error instanceof Error ? error.message.slice(0, 200) : 'unknown-error';
    this.status = { ...this.status, state: 'error', error: detail };
    this.emit('ERROR', `${kind}:${detail}`);
  }

  private emit(kind: AudioEvent['kind'], detail: string | null = null, volume: number | null = null): void {
    const event: AudioEvent = {
      at: this.clock.nowIso(),
      kind,
      detail,
      volume,
    };
    for (const listener of this.listeners) listener(event);
  }
}

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
import { readAudioRoute, subscribeAudioRoute, type AudioRoute } from './audioRoute';

// Metro asset import — `require` is typed by `expo/types` (types/metro-require.d.ts)
const BED_SOURCE = require('../../../assets/audio/bed-loop.m4a') as number;

/** Hard ceiling from DESIGN §2.3.1 / §0.5 S6 — the engine may never ask for more. */
const MAX_VOLUME = 0.35;

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(Math.max(volume, 0), MAX_VOLUME);
}

/**
 * `null` when the file can carry the requested pan, otherwise a short machine-readable reason.
 *
 * The only sources that can be hard-panned are the ones `src/audio/anchor.ts` renders, and it
 * names them `<hash>-l.wav` / `<hash>-r.wav` / `<hash>-c.wav`. Anything else asked to play on one
 * side would come out of both (a bundled asset, or a centre render passed with `pan: -1`).
 */
/**
 * The name the devices screen may show as an AUDIO device, or `null` (WO L3.9 §B).
 *
 * Only a headphone-shaped route becomes a device here: the phone's own speaker is a choice the
 * user makes on the sheet (`prefs.audioSpeaker`, handled in `src/devices/registry.ts`), and a
 * route nobody recognised must not be silently promoted to "your sleep headphones are ready".
 * Before this existed `status.route` was hard-coded `null` for the whole app's life, which is why
 * the 🎧 card said "no headphones found yet" on a phone with headphones connected.
 */
function headphoneName(route: AudioRoute | null): string | null {
  return route !== null && route.kind === 'headphones' ? route.portName : null;
}

function describePanMismatch(source: string, pan: number | undefined): string | null {
  if (pan === undefined || pan === 0) return null;
  const wanted = pan < 0 ? 'l' : 'r';
  const file = source.split('/').pop() ?? source;
  if (file.endsWith(`-${wanted}.wav`)) return null;
  return `${file}:wanted-${wanted}`;
}

export class IosAudioPlayer implements AudioPlayer {
  private player: ExpoAudioPlayer | null = null;
  private playerSource: number | null = null;
  private status: AudioPlayerStatus = { state: 'idle', volume: 0, route: null, error: null };
  private readonly listeners = new Set<(event: AudioEvent) => void>();

  /** Injected so tests can pin timestamps (APP-RUN §0.2 rule 6). */
  constructor(private readonly clock: Clock = systemClock) {
    // WO L3.9: one subscription for the lifetime of the platform bundle (this object is created
    // once, in `native.ios.ts`). It is what makes "plug the headphones in and the 🎧 card changes"
    // instant instead of waiting for the devices screen's 3 s tick — `src/devices/registry.ts`
    // listens for the `ROUTE_CHANGED` event below and refreshes itself. Deliberately an event
    // rather than a direct call into the registry: the registry imports the platform, so calling
    // it from here would close an import cycle.
    //
    // Never unsubscribed on purpose: `dispose()` runs at the end of *every* night
    // (`src/night/session.ts`), and the devices screen still needs the route after that — so the
    // listener lives as long as the process, like the `WCSession` delegate does.
    this.status = { ...this.status, route: headphoneName(readAudioRoute()) };
    subscribeAudioRoute((route) => {
      const name = headphoneName(route);
      if (name === this.status.route) return;
      this.status = { ...this.status, route: name };
      this.emit('ROUTE_CHANGED', route === null ? 'none' : `${route.portType}:${route.kind}`);
    });
  }

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

  async startBed(volume: number, source: number = BED_SOURCE): Promise<void> {
    const target = clampVolume(volume);
    try {
      if (this.status.state === 'idle') await this.configureSession();
      await setIsAudioActiveAsync(true);

      // A night's ambience (WO L2.8) is picked once, at `startBed`'s first call — a
      // different `source` while one is already playing (should not happen: the app
      // only ever calls this once per night) replaces the player rather than layering
      // two loops on top of each other.
      if (!this.player || this.playerSource !== source) {
        this.player?.remove();
        this.player = createAudioPlayer(source, { updateInterval: 1000 });
        this.player.loop = true;
        this.playerSource = source;
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

  /**
   * Short local clip, outside the bed/cue machinery (WO L1.7ui — plan-card preview +
   * ear test). A brand new `ExpoAudioPlayer` per call (not `this.player`, which is the
   * looping all-night bed) so a one-shot never fights the bed for the shared instance,
   * and is disposed the moment it finishes so a rapid run of ear-test rounds does not
   * leak native players.
   *
   * ## `pan`
   *
   * `expo-audio` has no per-player pan control (checked again in SDK 57 against
   * `node_modules/expo-audio/build/AudioModule.types.d.ts`: `volume`, `playbackRate`, `muted`,
   * nothing panning-shaped), and neither does `expo-av`. Hard left/right therefore lives in the
   * **file**: `src/audio/anchor.ts` encodes the mono signature PCM into a stereo WAV with one
   * channel written as true silence, named `<hash>-l.wav` / `<hash>-r.wav` (`-c` for centre).
   * That was already the design when `playOneShot` was introduced; what L2.2n adds is the check
   * below, because "the ear test proved both channels work" is a claim the app makes to the user
   * (DESIGN §3.2 step 3) and it is only true if the file really was one-sided.
   *
   * A mismatch does not throw: the ear-test screen awaits this call, and a thrown error there
   * would leave the user stuck on a step with no way forward. It is recorded as an `ERROR` audio
   * event instead, which lands in the night's diagnostics export — so a wrong-file bug shows up
   * in R1's data rather than as silence nobody can explain.
   */
  async playOneShot(options: { source: string; volume: number; pan?: number }): Promise<void> {
    const target = clampVolume(options.volume);
    const panMismatch = describePanMismatch(options.source, options.pan);
    if (panMismatch !== null) {
      this.emit('ERROR', `PAN_SOURCE_MISMATCH:${panMismatch}`, target);
    }
    const shot = createAudioPlayer(options.source, { updateInterval: 100 });
    shot.volume = target;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        subscription.remove();
        try {
          shot.remove();
        } catch {
          // already released
        }
        resolve();
      };

      const subscription = shot.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) finish();
      });

      try {
        shot.play();
      } catch (error) {
        settled = true;
        subscription.remove();
        reject(error as Error);
        return;
      }

      // Belt and braces: `didJustFinish` should always fire, but a clip that somehow
      // never reports it must not hang the caller (the ear-test screen awaits this).
      // WO L3.8: the downloaded full anchor is 9.84 s long (bell + the whisper that starts 2.6 s
      // in), so the old 8 s ceiling would have cut its tail off every time `didJustFinish` was
      // late. `.mp3` is only ever that file here (everything else this player opens is a
      // locally-rendered `.wav` or a bundled asset), so only it gets the longer rope.
      const signature = /anchor-[0-9a-f]+/.exec(options.source);
      const timeoutMs = signature ? 4000 : options.source.endsWith('.mp3') ? 13000 : 8000;
      setTimeout(finish, timeoutMs);
    });
  }

  /**
   * WO L3.9: the route is re-read here as well as updated from the notification, because the one
   * case the notification cannot cover is the important one — the user leaves the app, pairs their
   * buds in Settings, comes back. iOS does post a route change then, but the app may have been
   * suspended when it did. Two native property reads per call is cheaper than a wrong 🎧 card
   * (`LucidFocus.readState()` is read on every render of the pre-night screen for the same reason).
   */
  getStatus(): AudioPlayerStatus {
    const route = headphoneName(readAudioRoute());
    if (route !== this.status.route) this.status = { ...this.status, route };
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
    this.playerSource = null;
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

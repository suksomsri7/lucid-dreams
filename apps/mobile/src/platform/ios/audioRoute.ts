/**
 * "Is the sound going into something the user is wearing, or into the phone's own speaker?"
 * (WO L3.9 §B — R1 hotfix #1).
 *
 * The native half (`modules/lucid-audio-route`) reports two raw strings from
 * `AVAudioSession.currentRoute.outputs.first` and has no opinion about them. This file holds the
 * opinion, in one table, because it is a product rule and not a platform fact: an all-night
 * whisper is meant for **headphones**, the phone's speaker is a deliberate second choice the user
 * has to pick (`prefs.audioSpeaker`), and anything else (a car, a HDMI dock) is neither.
 *
 * Why the classification lives in TypeScript and not in Swift: it can be read and changed without
 * a new binary, and the devices screen, the readiness gate and the diagnostics export then all
 * judge a route by exactly the same rule.
 */

import LucidAudioRoute, { type NativeAudioRoute } from '../../../modules/lucid-audio-route';
import type { Unsubscribe } from '../types';

/**
 * - `headphones` — something worn or plugged in: the whisper can be quiet and private.
 * - `speaker` — the phone's own speaker/earpiece: usable (the owner's rule is "any device the
 *   user has"), but only when the user has chosen it, so it is never counted automatically.
 * - `other` — a car, an AirPlay speaker in another room, an unknown dock: honest "we don't know
 *   what this is", never silently treated as a sleep setup.
 */
export type AudioRouteKind = 'headphones' | 'speaker' | 'other';

export interface AudioRoute {
  kind: AudioRouteKind;
  /** `AVAudioSession.Port` raw value, kept for diagnostics. */
  portType: string;
  /** The device name iOS shows, e.g. "Sleep A20". Display only. */
  portName: string;
}

/**
 * `AVAudioSession.Port` raw values, exactly as iOS spells them (the `rawValue` of
 * `AVAudioSession.Port.bluetoothA2DP` is `"BluetoothA2DP"`, of `.builtInSpeaker` is
 * `"BuiltInSpeaker"`, and so on). Compared case-insensitively below so a future iOS that changes
 * the capitalisation does not silently demote a pair of headphones to "other".
 */
const HEADPHONE_PORTS = [
  'BluetoothA2DP', // AirPods, sleep buds, any classic-BT headphone
  'BluetoothHFP', // a headset in call mode
  'BluetoothLE', // LE Audio
  'Headphones', // wired, Lightning or USB-C
  'HeadsetMic', // wired headset (its output half)
  'USBAudio',
  'AirPlay',
  'CarAudio',
] as const;

/** The phone itself. `BuiltInReceiver` is the earpiece — same "not private, not worn" category. */
const SPEAKER_PORTS = ['BuiltInSpeaker', 'BuiltInReceiver'] as const;

export function classifyPortType(portType: string): AudioRouteKind {
  const lower = portType.toLowerCase();
  if (HEADPHONE_PORTS.some((port) => port.toLowerCase() === lower)) return 'headphones';
  if (SPEAKER_PORTS.some((port) => port.toLowerCase() === lower)) return 'speaker';
  return 'other';
}

/**
 * Native input is untrusted (APP-RUN §0.5 S8): a route with a missing or empty `portType` is "no
 * route", never a guess. `portName` may be empty — the port type is then shown instead, which is
 * still better than an empty device row.
 */
export function toAudioRoute(raw: NativeAudioRoute | null | undefined): AudioRoute | null {
  if (raw === null || raw === undefined) return null;
  const portType = typeof raw.portType === 'string' ? raw.portType.trim() : '';
  if (portType.length === 0) return null;
  const portName = typeof raw.portName === 'string' && raw.portName.trim().length > 0 ? raw.portName.trim() : portType;
  return { kind: classifyPortType(portType), portType, portName };
}

/** `false` on web/Android and in any build made before WO L3.9. */
export function isAudioRouteAvailable(): boolean {
  return LucidAudioRoute !== null;
}

/**
 * The route right now. A fresh native read every time rather than a cache: it is two property
 * reads, it can never be stale, and a cache would have to be invalidated from a notification that
 * — on a phone that was in the background while the user paired their buds in Settings — may
 * arrive after the screen has already rendered.
 */
export function readAudioRoute(): AudioRoute | null {
  if (!LucidAudioRoute) return null;
  try {
    return toAudioRoute(LucidAudioRoute.getCurrentRoute());
  } catch {
    // A module present but failing is "no information", exactly like an absent one — never a
    // thrown error on a screen whose whole job is to be looked at.
    return null;
  }
}

/** No-op unsubscribe for the platforms where there is nothing to listen to. */
const NOOP: Unsubscribe = () => undefined;

/**
 * Fires on every `AVAudioSession.routeChangeNotification` with the route as it is *after* the
 * change (`null` when nothing is connected any more).
 */
export function subscribeAudioRoute(listener: (route: AudioRoute | null) => void): Unsubscribe {
  if (!LucidAudioRoute) return NOOP;
  try {
    const subscription = LucidAudioRoute.addListener('onRouteChange', (raw) => {
      listener(toAudioRoute(raw));
    });
    return () => subscription.remove();
  } catch {
    return NOOP;
  }
}

/** iOS native bundle — the only place the iOS implementations are instantiated. */

import { hasRealGlass } from './ios/GlassSurface';
import { IosAudioPlayer } from './ios/IosAudioPlayer';
import {
  IosBatteryReader,
  IosDeviceInfoReader,
  IosHealthImport,
  IosLiveStatus,
  IosNotificationsPermission,
  IosSpeechToText,
} from './ios/IosPeripherals';
import { WatchSensorSource } from './ios/WatchSensorSource';
import type { PlatformBundle } from './types';

export function createNativePlatform(): PlatformBundle {
  return {
    name: 'ios',
    hasLiquidGlass: hasRealGlass(),
    watchSensorSource: new WatchSensorSource(),
    audioPlayer: new IosAudioPlayer(),
    liveStatus: new IosLiveStatus(),
    healthImport: new IosHealthImport(),
    speechToText: new IosSpeechToText(),
    notifications: new IosNotificationsPermission(),
    battery: new IosBatteryReader(),
    deviceInfo: new IosDeviceInfoReader(),
  };
}

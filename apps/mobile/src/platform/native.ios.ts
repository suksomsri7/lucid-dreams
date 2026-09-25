/** iOS native bundle — the only place the iOS implementations are instantiated. */

import { BleHeartRateSource } from './ios/BleHeartRateSource';
import { hasRealGlass } from './ios/GlassSurface';
import { IosAudioPlayer } from './ios/IosAudioPlayer';
import {
  IosBatteryReader,
  IosDeviceInfoReader,
  IosDisplay,
  IosHealthImport,
  IosLiveStatus,
  IosNotificationsPermission,
} from './ios/IosPeripherals';
import { IosSpeechToText } from './ios/IosSpeechToText';
import { PhoneMotionSource } from './ios/PhoneMotionSource';
import { WatchSensorSource } from './ios/WatchSensorSource';
import type { PlatformBundle } from './types';

export function createNativePlatform(): PlatformBundle {
  return {
    name: 'ios',
    hasLiquidGlass: hasRealGlass(),
    watchSensorSource: new WatchSensorSource(),
    bleHeartRate: new BleHeartRateSource(),
    phoneMotion: new PhoneMotionSource(),
    audioPlayer: new IosAudioPlayer(),
    liveStatus: new IosLiveStatus(),
    healthImport: new IosHealthImport(),
    speechToText: new IosSpeechToText(),
    notifications: new IosNotificationsPermission(),
    battery: new IosBatteryReader(),
    deviceInfo: new IosDeviceInfoReader(),
    display: new IosDisplay(),
  };
}

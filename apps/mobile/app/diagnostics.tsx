/**
 * Diagnostics — the screen L1.1 exists for (APP-RUN §2).
 *
 * After the R1 night the owner opens this screen and taps "Export diagnostics.json".
 * That one file decides the stack: watch battery start/end, what share of the 30 s
 * epochs actually arrived, how many times the audio session dropped, whether real
 * Liquid Glass was drawing.
 *
 * Rules honoured here:
 *  - every visible string comes from `src/i18n` (APP-RUN §0.2 rule 7);
 *  - the file is built and validated by `@lucid/engine` (`buildDiagnosticsExport`), so
 *    the app cannot write a shape the QC reader rejects;
 *  - nothing sensitive: no dream text, no transcript, no audio (APP-RUN §0.5 S5);
 *  - every platform call is wrapped, so the screen still renders on the web QC build
 *    where the stub platform throws `NotImplementedError`.
 */

import {
  buildDiagnosticsExport,
  epochCoverage,
  systemClock,
  type AudioEvent,
  type BatterySample,
  type SensorEpoch,
} from '@lucid/engine';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT, type TranslationKey } from '../src/i18n';
import { getPlatform, hasRealGlass, type AudioSessionState, type SensorStatus } from '../src/platform';
import { ActionButton, Card, Note, Row, Screen, Subtitle, Title } from '../src/ui/kit';

const MAX_KEPT_EVENTS = 500;
const BED_START_VOLUME = 0.12;

interface DeviceRead {
  platform: 'ios' | 'android' | 'web';
  osVersion: string;
  model: string;
  modelName: string | null;
}

const AUDIO_STATE_KEY: Record<AudioSessionState, TranslationKey> = {
  idle: 'diagnostics.audioSession.idle',
  configured: 'diagnostics.audioSession.configured',
  playing: 'diagnostics.audioSession.playing',
  stopped: 'diagnostics.audioSession.stopped',
  error: 'diagnostics.audioSession.error',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function DiagnosticsScreen() {
  const { t, locale } = useT();
  const platform = useMemo(() => getPlatform(), []);

  const [device, setDevice] = useState<DeviceRead | null>(null);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>(() =>
    platform.watchSensorSource.getStatus(),
  );
  const [epochs, setEpochs] = useState<SensorEpoch[]>([]);
  const [audioEvents, setAudioEvents] = useState<AudioEvent[]>([]);
  const [audioState, setAudioState] = useState<AudioSessionState>(
    () => platform.audioPlayer.getStatus().state,
  );
  const [phoneBattery, setPhoneBattery] = useState<BatterySample | null>(null);
  const [sensorsRunning, setSensorsRunning] = useState(false);
  const [bedPlaying, setBedPlaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const addWarning = useCallback((warning: string) => {
    setWarnings((current) => (current.includes(warning) ? current : [...current, warning].slice(-20)));
  }, []);

  // device + battery, read once (battery is re-sampled on export)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const read = await platform.deviceInfo.read();
        if (!cancelled) setDevice(read);
      } catch (error) {
        addWarning(`deviceInfo:${errorMessage(error)}`);
      }
      try {
        const sample = await platform.battery.sample('PHONE');
        if (!cancelled) setPhoneBattery(sample);
      } catch (error) {
        addWarning(`battery:${errorMessage(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, addWarning]);

  // subscriptions live for as long as the screen does
  useEffect(() => {
    const offEpoch = platform.watchSensorSource.onEpoch((epoch) => {
      setEpochs((current) => [...current, epoch].slice(-2400)); // ~20 h at 30 s
    });
    const offStatus = platform.watchSensorSource.onStatus(setSensorStatus);
    const offAudio = platform.audioPlayer.onEvent((event) => {
      setAudioEvents((current) => [...current, event].slice(-MAX_KEPT_EVENTS));
      setAudioState(platform.audioPlayer.getStatus().state);
    });
    return () => {
      offEpoch();
      offStatus();
      offAudio();
    };
  }, [platform]);

  const coverage = useMemo(() => epochCoverage(epochs), [epochs]);
  const lastHr = useMemo(() => {
    for (let i = epochs.length - 1; i >= 0; i -= 1) {
      const value = epochs[i]?.hrMean;
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }, [epochs]);

  const toggleSensors = useCallback(async () => {
    setMessage(null);
    try {
      if (sensorsRunning) {
        await platform.watchSensorSource.stop();
        setSensorsRunning(false);
      } else {
        await platform.watchSensorSource.start();
        setSensorsRunning(true);
      }
      setSensorStatus(platform.watchSensorSource.getStatus());
    } catch (error) {
      setMessage(t('common.notAvailableOnThisDevice'));
      addWarning(`sensors:${errorMessage(error)}`);
    }
  }, [platform, sensorsRunning, t, addWarning]);

  const toggleBed = useCallback(async () => {
    setMessage(null);
    try {
      if (bedPlaying) {
        await platform.audioPlayer.stopBed();
        setBedPlaying(false);
      } else {
        await platform.audioPlayer.startBed(BED_START_VOLUME);
        setBedPlaying(true);
      }
      setAudioState(platform.audioPlayer.getStatus().state);
    } catch (error) {
      setMessage(t('common.notAvailableOnThisDevice'));
      addWarning(`audio:${errorMessage(error)}`);
      setAudioState(platform.audioPlayer.getStatus().state);
    }
  }, [platform, bedPlaying, t, addWarning]);

  const exportDiagnostics = useCallback(async () => {
    setMessage(null);
    try {
      const freshBattery = await platform.battery.sample('PHONE').catch(() => null);
      const batterySamples = [phoneBattery, freshBattery].filter(
        (sample): sample is BatterySample => sample !== null,
      );

      const payload = buildDiagnosticsExport(
        {
          appVersion: Constants.expoConfig?.version ?? '0.0.0',
          buildNumber: Constants.expoConfig?.ios?.buildNumber ?? null,
          device: {
            platform: device?.platform ?? 'web',
            osVersion: device?.osVersion ?? 'unknown',
            model: device?.model ?? 'unknown',
            modelName: device?.modelName ?? null,
            watchModel: null,
            watchPaired: sensorStatus.connected,
            locale: locale === 'th' ? 'th-TH' : 'en-US',
          },
          sensors: [
            {
              id: sensorStatus.id,
              kind: sensorStatus.kind,
              connected: sensorStatus.connected,
              reachable: sensorStatus.reachable,
              lastEpochAt:
                sensorStatus.lastEpochT === null
                  ? null
                  : new Date(sensorStatus.lastEpochT * 1000).toISOString(),
              battery: sensorStatus.battery,
              error: sensorStatus.error,
            },
          ],
          epochs,
          audioEvents,
          batterySamples,
          warnings,
        },
        systemClock,
      );

      const directory = new Directory(Paths.cache, 'diagnostics');
      if (!directory.exists) directory.create({ intermediates: true });
      const target = new File(directory, 'diagnostics.json');
      target.create({ intermediates: true, overwrite: true });
      target.write(JSON.stringify(payload, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target.uri, {
          mimeType: 'application/json',
          dialogTitle: t('diagnostics.export'),
          UTI: 'public.json',
        });
        setMessage(t('diagnostics.export.done', { path: target.uri }));
      } else {
        setMessage(t('diagnostics.export.noShare', { path: target.uri }));
      }
    } catch (error) {
      setMessage(t('diagnostics.export.failed', { reason: errorMessage(error) }));
    }
  }, [platform, device, sensorStatus, epochs, audioEvents, warnings, phoneBattery, locale, t]);

  const yesNo = (value: boolean): string => (value ? t('common.yes') : t('common.no'));
  const percent = (value: number): string => `${Math.round(value * 100)}%`;

  return (
    <Screen testID="screen-diagnostics">
      <Title>{t('diagnostics.title')}</Title>
      <Subtitle>{t('diagnostics.subtitle')}</Subtitle>

      <Card title={t('diagnostics.section.device')} testID="card-device">
        <Row label={t('diagnostics.platform')} value={device?.platform ?? t('common.loading')} />
        <Row
          label={t('diagnostics.model')}
          value={device?.modelName ?? device?.model ?? t('common.unknown')}
        />
        <Row label={t('diagnostics.osVersion')} value={device?.osVersion ?? t('common.unknown')} />
        <Row
          label={t('diagnostics.appVersion')}
          value={Constants.expoConfig?.version ?? t('common.unknown')}
        />
        <Row label={t('diagnostics.glass')} value={yesNo(hasRealGlass())} />
        <Row
          label={t('diagnostics.batteryPhone')}
          value={phoneBattery === null ? t('common.none') : percent(phoneBattery.level)}
        />
      </Card>

      <Card title={t('diagnostics.section.sensors')} testID="card-sensors">
        <Row label={t('diagnostics.watchPaired')} value={yesNo(sensorStatus.connected)} />
        <Row label={t('diagnostics.watchReachable')} value={yesNo(sensorStatus.reachable)} />
        <Row
          label={t('diagnostics.lastHr')}
          value={lastHr === null ? t('common.none') : t('diagnostics.lastHr.unit', { bpm: Math.round(lastHr) })}
        />
        <Row label={t('diagnostics.epochCount')} value={String(coverage.count)} />
        <Row label={t('diagnostics.epochContinuity')} value={percent(coverage.continuity)} />
        <Row
          label={t('diagnostics.batteryWatch')}
          value={sensorStatus.battery === null ? t('common.none') : percent(sensorStatus.battery)}
        />
        <ActionButton
          testID="toggle-sensors"
          label={sensorsRunning ? t('diagnostics.stopSensors') : t('diagnostics.startSensors')}
          tone={sensorsRunning ? 'ghost' : 'primary'}
          onPress={() => void toggleSensors()}
        />
      </Card>

      <Card title={t('diagnostics.section.audio')} testID="card-audio">
        <Row label={t('diagnostics.audioSession')} value={t(AUDIO_STATE_KEY[audioState])} />
        <Row
          label={t('diagnostics.audioRoute')}
          value={platform.audioPlayer.getStatus().route ?? t('common.unknown')}
        />
        <Row label={t('diagnostics.audioEvents')} value={String(audioEvents.length)} />
        <ActionButton
          testID="toggle-bed"
          label={bedPlaying ? t('diagnostics.stopBed') : t('diagnostics.startBed')}
          tone={bedPlaying ? 'ghost' : 'primary'}
          onPress={() => void toggleBed()}
        />
      </Card>

      <Card title={t('diagnostics.section.export')} testID="card-export">
        <ActionButton
          testID="export-diagnostics"
          label={t('diagnostics.export')}
          onPress={() => void exportDiagnostics()}
        />
        {message === null ? null : <Note>{message}</Note>}
      </Card>

      {warnings.length === 0 ? null : (
        <Card title={t('diagnostics.warnings')} testID="card-warnings">
          {warnings.map((warning) => (
            <Note key={warning}>{warning}</Note>
          ))}
        </Card>
      )}
    </Screen>
  );
}

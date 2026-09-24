/**
 * English strings. Must contain exactly the same keys as `th.ts` — `Translations`
 * makes a missing key a type error, and `scripts/fitness.mts` checks both directions.
 */

import type { Translations } from './th';

export const en: Translations = {
  'app.name': 'Lucid Dream',

  'tabs.tonight': 'Tonight',
  'tabs.journal': 'Journal',
  'tabs.settings': 'Settings',

  'common.yes': 'Yes',
  'common.no': 'No',
  'common.unknown': 'Unknown',
  'common.none': '—',
  'common.loading': 'Loading…',
  'common.close': 'Close',
  'common.comingSoon': 'Not in this build yet',
  'common.notAvailableOnThisDevice': 'This device cannot do that yet',

  'tonight.title': 'Tonight',
  'tonight.subtitle': 'Your dream advisor will live in this room',
  'tonight.placeholder': 'What do you want to dream about tonight?',
  'tonight.shellNote': 'The real conversation is built in work order L1.4',

  'journal.title': 'Journal',
  'journal.subtitle': 'Every night so far, and the totals',
  'journal.empty': 'No nights recorded yet',

  'settings.title': 'Settings',
  'settings.subtitle': 'Devices · sound · sleep · data',
  'settings.language': 'Language',
  'settings.language.th': 'Thai',
  'settings.language.en': 'English',
  'settings.openDiagnostics': 'Diagnostics',
  'settings.openDiagnostics.hint': 'For on-device test rounds',

  'diagnostics.title': 'Diagnostics',
  'diagnostics.subtitle': 'This screen is for on-device testing, not for everyday use',
  'diagnostics.section.device': 'Device',
  'diagnostics.section.sensors': 'Sensors',
  'diagnostics.section.audio': 'Audio',
  'diagnostics.section.export': 'Export',
  'diagnostics.platform': 'Platform',
  'diagnostics.model': 'Model',
  'diagnostics.osVersion': 'OS version',
  'diagnostics.appVersion': 'App version',
  'diagnostics.glass': 'Real Liquid Glass',
  'diagnostics.watchReachable': 'Watch reachable',
  'diagnostics.watchPaired': 'Watch paired',
  'diagnostics.lastHr': 'Last heart rate',
  'diagnostics.lastHr.unit': '{bpm} bpm',
  'diagnostics.epochCount': '30-second epochs',
  'diagnostics.epochContinuity': 'Epoch continuity',
  'diagnostics.batteryPhone': 'Phone battery',
  'diagnostics.batteryWatch': 'Watch battery',
  'diagnostics.audioSession': 'Audio session',
  'diagnostics.audioSession.idle': 'Not started',
  'diagnostics.audioSession.configured': 'Configured',
  'diagnostics.audioSession.playing': 'Playing bed',
  'diagnostics.audioSession.stopped': 'Stopped',
  'diagnostics.audioSession.error': 'Error',
  'diagnostics.audioRoute': 'Output route',
  'diagnostics.audioEvents': 'Audio events recorded',
  'diagnostics.startBed': 'Start bed audio',
  'diagnostics.stopBed': 'Stop bed audio',
  'diagnostics.startSensors': 'Start watch stream',
  'diagnostics.stopSensors': 'Stop watch stream',
  'diagnostics.export': 'Export diagnostics.json',
  'diagnostics.export.done': 'Exported: {path}',
  'diagnostics.export.failed': 'Export failed: {reason}',
  'diagnostics.export.noShare': 'This device cannot share files — the file is at {path}',
  'diagnostics.warnings': 'Warnings',
};

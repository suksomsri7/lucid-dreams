/** Manual smoke check for the production store: `node --import tsx scripts/smoke-sqlite.ts` */
import { rmSync } from 'node:fs';
import { createSqliteStore } from '../src/store-sqlite';

const file = './data/smoke.sqlite';
rmSync(file, { force: true });
const store = createSqliteStore(file);
store.createDevice({ deviceId: 'd1', tokenHash: 'h1', platform: 'ios', appVersion: '0.1.0', createdAt: 'now' });
console.log('device:', store.findDeviceByTokenHash('h1'));
store.recordHit('k', 1000);
console.log('hits:', store.countHitsSince('k', 0));
store.ttsPut('c', { audio: Buffer.from('RIFFxxxxWAVE'), contentType: 'audio/wav' });
console.log('tts:', store.ttsGet('c')?.contentType);
store.close();
console.log('OK');

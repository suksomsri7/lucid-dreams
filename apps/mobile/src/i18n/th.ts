/**
 * สตริงภาษาไทย — ไฟล์นี้กับ `en.ts` เป็น **ที่เดียว** ที่อนุญาตให้มีตัวอักษรไทย
 * (APP-RUN §0.2 ข้อ 7 · ตรวจโดย scripts/fitness.mts และ oracle S5.3)
 *
 * กติกา: คีย์เป็น `หมวด.ชื่อ` · ตัวแปรในสตริงใช้ `{ชื่อ}` · ห้ามต่อสตริงในหน้าจอ
 */

export const th = {
  'app.name': 'Lucid Dream',

  'tabs.tonight': 'คืนนี้',
  'tabs.journal': 'บันทึก',
  'tabs.settings': 'ตั้งค่า',

  'common.yes': 'ใช่',
  'common.no': 'ไม่',
  'common.unknown': 'ยังไม่รู้',
  'common.none': '—',
  'common.loading': 'กำลังโหลด…',
  'common.close': 'ปิด',
  'common.comingSoon': 'ยังไม่เปิดใช้ในรุ่นนี้',
  'common.notAvailableOnThisDevice': 'เครื่องนี้ยังทำสิ่งนี้ไม่ได้',

  'tonight.title': 'คืนนี้',
  'tonight.subtitle': 'ที่ปรึกษาความฝันจะมาอยู่ห้องนี้',
  'tonight.placeholder': 'คืนนี้อยากฝันถึงอะไร',
  'tonight.shellNote': 'ห้องคุยจริงเริ่มสร้างที่ใบ L1.4',

  'journal.title': 'บันทึก',
  'journal.subtitle': 'ทุกคืนที่ผ่านมาและตัวเลขรวม',
  'journal.empty': 'ยังไม่มีคืนที่บันทึกไว้',

  'settings.title': 'ตั้งค่า',
  'settings.subtitle': 'อุปกรณ์ · เสียง · การนอน · ข้อมูล',
  'settings.language': 'ภาษา',
  'settings.language.th': 'ไทย',
  'settings.language.en': 'อังกฤษ',
  'settings.openDiagnostics': 'หน้าตรวจระบบ',
  'settings.openDiagnostics.hint': 'สำหรับรอบทดสอบเครื่องจริง',

  'diagnostics.title': 'ตรวจระบบ',
  'diagnostics.subtitle': 'หน้านี้ใช้ตอนทดสอบบนเครื่องจริง ไม่ใช่หน้าสำหรับผู้ใช้ทั่วไป',
  'diagnostics.section.device': 'เครื่อง',
  'diagnostics.section.sensors': 'เซนเซอร์',
  'diagnostics.section.audio': 'เสียง',
  'diagnostics.section.export': 'ส่งออก',
  'diagnostics.platform': 'แพลตฟอร์ม',
  'diagnostics.model': 'รุ่นเครื่อง',
  'diagnostics.osVersion': 'รุ่นระบบ',
  'diagnostics.appVersion': 'รุ่นแอป',
  'diagnostics.glass': 'กระจกของจริง (Liquid Glass)',
  'diagnostics.watchReachable': 'นาฬิกาติดต่อได้',
  'diagnostics.watchPaired': 'จับคู่นาฬิกาแล้ว',
  'diagnostics.lastHr': 'ชีพจรล่าสุด',
  'diagnostics.lastHr.unit': '{bpm} ครั้ง/นาที',
  'diagnostics.epochCount': 'จำนวนช่วง 30 วินาที',
  'diagnostics.epochContinuity': 'ความต่อเนื่องของช่วง',
  'diagnostics.batteryPhone': 'แบตมือถือ',
  'diagnostics.batteryWatch': 'แบตนาฬิกา',
  'diagnostics.audioSession': 'สถานะเสียง',
  'diagnostics.audioSession.idle': 'ยังไม่เริ่ม',
  'diagnostics.audioSession.configured': 'ตั้งค่าแล้ว',
  'diagnostics.audioSession.playing': 'กำลังเล่นเสียงพื้น',
  'diagnostics.audioSession.stopped': 'หยุดแล้ว',
  'diagnostics.audioSession.error': 'มีปัญหา',
  'diagnostics.audioRoute': 'ออกลำโพง/หูฟัง',
  'diagnostics.audioEvents': 'เหตุการณ์เสียงที่บันทึกไว้',
  'diagnostics.startBed': 'เริ่มเสียงพื้น',
  'diagnostics.stopBed': 'หยุดเสียงพื้น',
  'diagnostics.startSensors': 'เริ่มรับค่าจากนาฬิกา',
  'diagnostics.stopSensors': 'หยุดรับค่า',
  'diagnostics.export': 'ส่งออก diagnostics.json',
  'diagnostics.export.done': 'ส่งออกแล้ว: {path}',
  'diagnostics.export.failed': 'ส่งออกไม่สำเร็จ: {reason}',
  'diagnostics.export.noShare': 'เครื่องนี้แชร์ไฟล์ไม่ได้ — ไฟล์ถูกเขียนไว้ที่ {path}',
  'diagnostics.warnings': 'ข้อควรระวัง',
} as const;

/** คีย์ทั้งหมดที่แปลได้ — `en.ts` ต้องมีครบทุกคีย์ */
export type TranslationKey = keyof typeof th;

export type Translations = Record<TranslationKey, string>;

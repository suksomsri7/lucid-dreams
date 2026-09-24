# targets/watch — แอป watchOS (Swift)

ฝังเข้า Xcode ผ่าน `@bacons/apple-targets` (ตั้งค่าที่ `apps/mobile/app.config.ts` ด้วย `root: '../../targets'`)
โฟลเดอร์นี้อยู่**นอก** `apps/mobile/ios/` เพื่อให้ `expo prebuild` รันซ้ำได้โดยไม่ทับโค้ด (CNG)

## ไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `LucidWatchApp.swift` | จุดเริ่ม (`@main`) · เปิดการอ่านระดับแบต |
| `ContentView.swift` | 3 สถานะตาม DESIGN §10 — พร้อม / กำลังทำงาน (HR ใหญ่ · REM% · นับกระซิบ · ปุ่มกดค้างเพื่อหยุด) / ตอนเช้า · มี `WatchBattery` helper |
| `WorkoutManager.swift` | `HKWorkoutSession(.mindAndBody)` + `HKLiveWorkoutBuilder` → HR ต่อวินาที → ปิด epoch ทุก 30 วิ |
| `MotionManager.swift` | `CMMotionManager` accel 20 Hz → เฉลี่ย \|a\| (หักแรงโลก) ต่อ epoch |
| `PhoneLink.swift` | `WCSession` — `sendMessage` เมื่อ reachable ไม่งั้น `transferUserInfo` (คิวไว้) · รับคำสั่ง start/stop |
| `EpochPayload.swift` | โครงข้อมูล `{t, hrMean, hrSd, motion, battery}` — ต้องตรงกับ `SensorEpochSchema` ในเครื่องยนต์ |
| `Info.plist` | `WKApplication` · `WKCompanionAppBundleIdentifier` · `UIBackgroundModes: workout-processing` · ข้อความขอสิทธิ์ |
| `expo-target.config.js` | `type: 'watch'` · frameworks · entitlements HealthKit (รวม background-delivery) |

## 🔴 ยังไม่ได้คอมไพล์ — คอมไพล์บน Linux ไม่ได้
ไม่มี macOS/Xcode/บัญชี Apple บนเครื่องนี้ (APP-RUN §0.3 ข้อ 2) โค้ดชุดนี้เขียนตาม API จริงแต่**ยังไม่เคยผ่าน swiftc**

สิ่งที่ต้องตรวจบน Mac หรือ EAS build รอบ R1 (เรียงตามความเสี่ยง)
1. `npx expo prebuild -p ios --clean` แล้ว **เปิด Xcode ดูว่ามี target `LucidWatch`** ใต้ `expo:targets/watch` จริง + `WATCHOS_DEPLOYMENT_TARGET` ถูกตั้ง
2. คอมไพล์: `@MainActor` บน `WorkoutManager` + `HKLiveWorkoutBuilderDelegate` (delegate ไม่ใช่ isolated) อาจต้องใส่ `nonisolated` — จุดนี้เสี่ยง compile error มากที่สุด
3. `WKCompanionAppBundleIdentifier` ต้องตรงกับ `ios.bundleIdentifier` จริงตอนมีบัญชี Apple แล้ว (ตอนนี้ฮาร์ดโค้ด `app.luciddream.ios`)
4. entitlement `healthkit.background-delivery` ต้องมีใน provisioning profile ไม่งั้น**บิลด์ตกเงียบ ๆ** (ดู reference_watch_target_entitlements)
5. ใส่นาฬิกานอน 1 คืน → เช้าดูว่า `epochCount` ควรได้ ~960 ต่อ 8 ชม. และแบตเหลือเท่าไร
6. ฝั่งมือถือยัง**ไม่มี** native module รับ `WCSession` (ดู `apps/mobile/src/platform/ios/watchBridge.ts`) → R1 อ่านค่าจากจอนาฬิกาก่อน แล้วต่อ bridge จริงที่ L2.2

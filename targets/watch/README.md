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
| `StreakStore.swift` | (L2.2n) เขียนสตรีคลง App Group `group.cloud.suksomsri.dreaming` คีย์ `streak.nights` / `streak.updatedAt` + `WidgetCenter.reloadAllTimelines()` → ตัวอ่านคือ `targets/watch-complication` |
| `Localizable.xcstrings` | (L2.2n) 13 คีย์ th/en — ทุกสตริงที่ผู้ใช้เห็นผ่าน `String(localized:)` · **ตัวเลขทุกตัวส่งเข้า `String(format:)` แบบ `Int64`** เพราะ `%lld` กว้าง 64 บิตแต่ watchOS เป็น arm64_32 ที่ `Int` กว้าง 32 บิต (ดูคอมเมนต์หัว `ContentView.swift`) |
| `Info.plist` | `WKApplication` · `WKCompanionAppBundleIdentifier` · `UIBackgroundModes: workout-processing` · `CFBundleLocalizations` (en/th) · ข้อความขอสิทธิ์ |
| `expo-target.config.js` | `type: 'watch'` · frameworks (+`WidgetKit`) · entitlements HealthKit (รวม background-delivery) + app group |

## 🔴 ยังไม่ได้คอมไพล์ — คอมไพล์บน Linux ไม่ได้
ไม่มี macOS/Xcode/บัญชี Apple บนเครื่องนี้ (APP-RUN §0.3 ข้อ 2) โค้ดชุดนี้เขียนตาม API จริงแต่**ยังไม่เคยผ่าน swiftc**

สิ่งที่ต้องตรวจบน Mac หรือ EAS build รอบ R1 (เรียงตามความเสี่ยง)
1. `npx expo prebuild -p ios --clean` แล้ว **เปิด Xcode ดูว่ามี target `LucidWatch`** ใต้ `expo:targets/watch` จริง + `WATCHOS_DEPLOYMENT_TARGET` ถูกตั้ง
2. คอมไพล์: `@MainActor` บน `WorkoutManager` + `HKLiveWorkoutBuilderDelegate` (delegate ไม่ใช่ isolated) อาจต้องใส่ `nonisolated` — จุดนี้เสี่ยง compile error มากที่สุด
3. ~~`WKCompanionAppBundleIdentifier` ไม่ตรง~~ **แก้แล้วใน L2.2n**: เดิมเป็น `app.luciddream.ios` ซึ่ง**ไม่ตรง** `ios.bundleIdentifier` จริง (`cloud.suksomsri.dreaming`) — ถ้าไม่แก้ นาฬิกาจะไม่จับคู่กับแอปเลย · R1 แค่ยืนยันว่าจับคู่ติดจริงบนเครื่อง
4. entitlement `healthkit.background-delivery` ต้องมีใน provisioning profile ไม่งั้น**บิลด์ตกเงียบ ๆ** (ดู reference_watch_target_entitlements)
5. ใส่นาฬิกานอน 1 คืน → เช้าดูว่า `epochCount` ควรได้ ~960 ต่อ 8 ชม. และแบตเหลือเท่าไร
6. ~~ฝั่งมือถือยังไม่มี native module รับ `WCSession`~~ **ต่อแล้วใน L2.2n**: `apps/mobile/modules/lucid-watch-link` (pod `LucidWatchLink`) → `src/platform/ios/watchBridge.ts` · R1 ตรวจว่า epoch มาถึงมือถือจริงกี่ % และปุ่มกดค้าง 1 วิ หยุดคืนทั้งสองเครื่อง
7. complication อยู่ที่ `targets/watch-complication` (โฟลเดอร์แยก ไม่ใช่ลูกของโฟลเดอร์นี้ — ปลั๊กอินหา target ด้วย glob ชั้นเดียว) · ฝังใน `LucidWatch.app` ไม่ใช่ในแอป iPhone · ยังไม่มีใครเรียก `watchBridge.setStreakNights()` ⇒ ต้องเห็น **"—"** ไม่ใช่ "0"

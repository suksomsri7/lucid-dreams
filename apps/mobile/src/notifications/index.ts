/**
 * Daytime reality checks + evening/morning reminders (WO L3.3 · DESIGN §3.4 · mockup
 * `10-outside.png` · APP-RUN §2 "L3.3"). Uses `expo-notifications` directly rather than
 * through `src/platform/types.ts`'s `NotificationsPermission` facade: that interface
 * (`isAvailable`/`requestAuthorization` only) was deliberately left "declared but not
 * wired" at L1.3 with a comment pointing at "L1.7/L3.1" as the WO that would add the real
 * dependency and the scheduling calls it has none of — this file is that WO, and adding
 * the scheduling API to the platform-agnostic layer here (rather than to
 * `src/platform/ios/IosPeripherals.ts`'s stub `IosNotificationsPermission`, which stays
 * untouched) keeps this feature out of `src/platform/ios/` entirely, per this WO's own
 * instruction to prefer platform-agnostic code there.
 *
 * `expo-notifications` is a new dependency (`apps/mobile/package.json`) — justified in
 * `ledger/wo-notes/L3ui.md` §deps (§0.5 S9: every new dependency needs a reason in the
 * notes). It is the only Expo module that can put a real, actioned local notification on
 * screen; nothing already in this repo does.
 *
 * Every function below is a no-op that only logs on web (`Platform.OS === 'web'`) — the
 * QC export bundle has no OS notification centre to schedule into, same convention as
 * `src/audio/player.ts#playAnchorOnce`'s own web stub.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { mulberry32 } from '@lucid/engine';
import type { RealityCheckAnswer } from '@lucid/data';

import { getAnchorSeed } from '../audio/anchor';
import { recordRealityCheck } from '../data/realityCheck';
import { translate, type Locale } from '../i18n';

const IS_WEB = Platform.OS === 'web';

/** Reality checks run only inside the day window 09:00–21:00 — by construction this can
 * never overlap a sleep window (which is, definitionally, at night), satisfying DESIGN
 * §3.4's "ไม่ชนช่วงนอน" without needing to know the user's actual bedtime. */
const DAY_WINDOW_START_HOUR = 9; // 09:00
const DAY_WINDOW_END_HOUR = 21; // 21:00
const MIN_GAP_MIN = 90;

const REALITY_CHECK_CATEGORY = 'lucid-reality-check';
const REALITY_CHECK_ID_PREFIX = 'lucid-reality-check-';
const EVENING_REMINDER_ID = 'lucid-evening-reminder';
const MORNING_REMINDER_ID = 'lucid-morning-reminder';

/** DESIGN §3.4's default evening nudge, used until a real "average bedtime" exists (no bedtime history is tracked anywhere in this build — documented debt, `ledger/wo-notes/L3ui.md`). */
const DEFAULT_EVENING_REMINDER = { hour: 22, minute: 30 };
/** "เตือนเช้าถ้าไม่เปิดแอปใน 20 นาทีหลังตื่น" (APP-RUN §2 L3.3). */
const MORNING_REMINDER_AFTER_MIN = 20;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function seedFromString(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Ask once — safe to call again later (returns the existing grant without re-prompting). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (IS_WEB) {
    // eslint-disable-next-line no-console -- intentional web stub log (WO L3.3)
    console.log('[notifications] stub requestNotificationPermission (web)');
    return false;
  }
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    const result = await Notifications.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/**
 * `count` random-looking times inside the day window, each at least {@link MIN_GAP_MIN}
 * apart, deterministic for a given `seedNum` (APP-RUN §0.2 rule 6 — no hidden state).
 * "Stars and bars": the window minus the mandatory gaps is leftover slack, split
 * unevenly across `count` shares by the seeded generator, then walked cumulatively so
 * every step is at least the mandatory gap plus its own share of slack.
 */
export function planRealityCheckMinutes(count: number, seedNum: number): { hour: number; minute: number }[] {
  const start = DAY_WINDOW_START_HOUR * 60;
  const end = DAY_WINDOW_END_HOUR * 60;
  const span = end - start;
  const maxByWindow = Math.floor(span / MIN_GAP_MIN) + 1;
  const n = Math.max(1, Math.min(Math.round(count), maxByWindow));

  const rng = mulberry32(seedNum);
  const shares = Array.from({ length: n }, () => rng.next());
  const sumShares = shares.reduce((a, b) => a + b, 0) || 1;
  const slack = Math.max(0, span - MIN_GAP_MIN * (n - 1));

  let cursor = start;
  const minutes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const share = ((shares[i] as number) / sumShares) * slack;
    cursor += i === 0 ? share : MIN_GAP_MIN + share;
    minutes.push(Math.round(Math.min(end, Math.max(start, cursor))));
  }
  return minutes.map((minuteOfDay) => ({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 }));
}

async function ensureRealityCheckCategory(locale: Locale): Promise<void> {
  if (IS_WEB) return;
  try {
    await Notifications.setNotificationCategoryAsync(REALITY_CHECK_CATEGORY, [
      { identifier: 'DONE', buttonTitle: translate(locale, 'notifications.realityCheck.done') },
      { identifier: 'LATER', buttonTitle: translate(locale, 'notifications.realityCheck.later') },
    ]);
  } catch {
    // Categories are iOS-only in practice for this app — a failure here still lets the
    // notification itself show, just without the two buttons.
  }
}

/**
 * (Re)schedules every one of this app's own local notifications: `count` daily reality
 * checks (mockup `10-outside.png`'s "มองมือของคุณ… นี่ฝันไหม" + ทำแล้ว/ไว้ก่อน) plus the
 * evening reminder. Cancels this app's own previously scheduled notifications first
 * (`cancelAllScheduledNotificationsAsync` — this app never schedules anything else), so
 * calling this again after a settings change is idempotent, not additive.
 */
export async function scheduleDailyReminders(count: number, locale: Locale): Promise<void> {
  if (IS_WEB) {
    // eslint-disable-next-line no-console -- intentional web stub log (WO L3.3)
    console.log('[notifications] stub scheduleDailyReminders (web)', { count, locale });
    return;
  }
  const granted = await requestNotificationPermission();
  if (!granted) return;

  await Notifications.cancelAllScheduledNotificationsAsync();
  await ensureRealityCheckCategory(locale);

  const seed = await getAnchorSeed();
  const times = planRealityCheckMinutes(count, seedFromString(`lucid-reality-check|${seed}`));

  for (let i = 0; i < times.length; i += 1) {
    const time = times[i] as { hour: number; minute: number };
    await Notifications.scheduleNotificationAsync({
      identifier: `${REALITY_CHECK_ID_PREFIX}${i}`,
      content: {
        title: translate(locale, 'notifications.realityCheck.title'),
        body: translate(locale, 'notifications.realityCheck.body'),
        categoryIdentifier: REALITY_CHECK_CATEGORY,
        data: { kind: 'realityCheck' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: time.hour, minute: time.minute },
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: EVENING_REMINDER_ID,
    content: {
      title: translate(locale, 'notifications.evening.title'),
      body: translate(locale, 'notifications.evening.body'),
      data: { kind: 'evening' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: DEFAULT_EVENING_REMINDER.hour,
      minute: DEFAULT_EVENING_REMINDER.minute,
    },
  });
}

export async function cancelDailyReminders(): Promise<void> {
  if (IS_WEB) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Nothing to cancel.
  }
}

/** Called once the night ends (`night/session.ts`) — "เตือนเช้าถ้าไม่เปิดแอปใน 20 นาทีหลังตื่น". */
export async function scheduleMorningReminder(locale: Locale): Promise<void> {
  if (IS_WEB) {
    console.log('[notifications] stub scheduleMorningReminder (web)'); // eslint-disable-line no-console -- intentional web stub log (WO L3.3)
    return;
  }
  const granted = await requestNotificationPermission();
  if (!granted) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(MORNING_REMINDER_ID).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: MORNING_REMINDER_ID,
      content: {
        title: translate(locale, 'notifications.morning.title'),
        body: translate(locale, 'notifications.morning.body'),
        data: { kind: 'morning' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: MORNING_REMINDER_AFTER_MIN * 60,
        repeats: false,
      },
    });
  } catch {
    // Best-effort — a missed reminder is not worth crashing the end-of-night teardown over.
  }
}

/** Called the moment the morning room actually opens (`useMorning.ts`) — the reminder's job is done. */
export async function cancelMorningReminder(): Promise<void> {
  if (IS_WEB) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(MORNING_REMINDER_ID);
  } catch {
    // Nothing scheduled — fine.
  }
}

/**
 * One listener for the whole app (`app/_layout.tsx`, mounted once) — records
 * ทำแล้ว/ไว้ก่อน (`DONE`/`LATER`) against `RealityCheck`, and the plain tap
 * (`Notifications.DEFAULT_ACTION_IDENTIFIER`, no button pressed) as `NONE`, same three
 * values `packages/data`'s `REALITY_CHECK_ANSWERS` already defines.
 */
export function registerNotificationResponseHandler(): () => void {
  if (IS_WEB) return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((event) => {
    const kind = (event.notification.request.content.data as { kind?: string } | undefined)?.kind;
    if (kind !== 'realityCheck') return;
    const responded: RealityCheckAnswer =
      event.actionIdentifier === 'DONE' ? 'DONE' : event.actionIdentifier === 'LATER' ? 'LATER' : 'NONE';
    void recordRealityCheck(new Date().toISOString(), responded).catch(() => undefined);
  });
  return () => subscription.remove();
}

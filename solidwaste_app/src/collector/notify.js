// Notifications on the collector's phone.
//
// * From the server (push): new / changed / cancelled emergency pickups, a truck stop's new time,
//   new announcements. Needs the installed app (APK) and a Firebase project for Android; Expo Go
//   cannot receive them. See SETUP.md, "Notifications".
// * On the phone (local): reminder 15 minutes before the day's first truck stop, "You're at …"
//   when the truck reaches a stop, "Standby time is over". These also work in Expo Go.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';

const KEYS = { token: 'ecollect-push-token', reminder: 'ecollect-reminder' };
const CHANNEL = 'default';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Show notifications while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let channelReady = null;
function ensureChannel() {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'ECollect',
    description: 'Garbage pickups, the truck, reports, announcements and reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#1f6b4a',
  }).catch(() => null);
  return channelReady;
}

/** Asks for permission once (Android 13+ / iOS). Returns true when notifications may be shown. */
export async function ensurePermission() {
  try {
    await ensureChannel();
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (!cur.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

const quiet = async () => { try { return (await Notifications.getPermissionsAsync()).granted; } catch { return false; } };

/** Shows a notification now (only if permission was given). */
export async function notifyNow(title, body, data = {}) {
  if (!(await quiet())) return null;
  await ensureChannel();
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: 'default' },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  }).catch(() => null);
}

/** Schedules a notification for a time; returns its id (null if not allowed or in the past). */
export async function scheduleAt(date, title, body, data = {}) {
  if (date.getTime() <= Date.now() + 5000 || !(await quiet())) return null;
  await ensureChannel();
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL },
  }).catch(() => null);
}

export async function cancelScheduled(id) { if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {}); }

/**
 * Reminder 15 minutes before the first truck stop of the day that is not done yet.
 * Called whenever the day is loaded; re-schedules only when the stop or time changed.
 */
export async function scheduleFirstStopReminder(day) {
  try {
    const first = (day?.stops ?? []).find((s) => s.state === 'upcoming' && s.start);
    const prev = JSON.parse((await AsyncStorage.getItem(KEYS.reminder)) || 'null');
    const at = first ? new Date(Date.parse(`${day.date}T${first.start}+08:00`) - 15 * 60000) : null;
    const key = first ? `${day.date}|${first.id}|${first.start}` : null;
    if (prev?.key === key) return;
    if (prev?.id) await cancelScheduled(prev.id);
    const id = at ? await scheduleAt(at, `${first.name} in 15 minutes`,
      `Truck stop ${first.name} starts at ${fmt(first.start)}. Remember to start your shift and location sharing.`, { kind: 'reminder', id: first.id }) : null;
    await AsyncStorage.setItem(KEYS.reminder, JSON.stringify({ key: id ? key : null, id }));
  } catch { /* reminders are a convenience; never block the screen */ }
}
const fmt = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

/**
 * Server notifications: gets this phone's Expo push token and gives it to the server.
 * Returns '' when it worked, or a short reason why this phone will not get them.
 */
export async function registerForPush(register) {
  if (isExpoGo) return 'Notifications from the barangay need the installed ECollect app (Expo Go cannot receive them).';
  if (!(await ensurePermission())) return 'Notifications are turned off for ECollect in your phone settings.';
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return 'This build is not linked to an Expo project yet, so it cannot receive notifications.';
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await register(token);
    await AsyncStorage.setItem(KEYS.token, token);
    return '';
  } catch (e) {
    return `Could not turn on notifications: ${e.message}`;
  }
}

/** On log out: this phone stops receiving this account's notifications; local ones are cleared. */
export async function forgetPush(unregister) {
  try {
    const token = await AsyncStorage.getItem(KEYS.token);
    if (token) await unregister(token).catch(() => {});
    await AsyncStorage.multiRemove([KEYS.token, KEYS.reminder, 'ecollect-resident-reminders']);
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch { /* ignore */ }
}

/** Calls fn(data) when the collector taps a notification (also the one that opened the app). */
let handledTap = null;
export function onNotificationTap(fn) {
  const handle = (r) => {
    const id = r?.notification?.request?.identifier;
    if (!r || id === handledTap) return;
    handledTap = id;
    fn(r.notification.request.content.data ?? {});
  };
  try { handle(Notifications.getLastNotificationResponse()); } catch { /* ignore */ }
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

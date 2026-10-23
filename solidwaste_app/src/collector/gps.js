// Truck GPS sharing for the collector app.
//
// * Installed app (development / preview build): background location with an Android
//   "ECollect is sharing your location" notification, so it keeps working when the phone
//   is locked or another app is open.
// * Expo Go (cannot run background location): shares while the app is open, and keeps the
//   screen awake.
// Either way: high accuracy, at most one send every 10 seconds, the newest position is
// retried if a send fails (weak signal), and sharing stops by itself after the day's work.
//
// This file must be imported once at start-up (index.js) so the background task is defined
// before Android wakes the app for it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { supabase } from '../lib/supabase';
import { cachedCollectorId } from '../data/collector';
import { checkArrival } from './arrival';
import { flushOutbox } from './offline';
import { ensurePermission } from './notify';

export const GPS_TASK = 'ecollect-truck-gps';
const KEYS = { stopAt: 'ecollect-gps-stop-at', last: 'ecollect-gps-last', error: 'ecollect-gps-error', pending: 'ecollect-gps-pending' };
const MIN_GAP_MS = 10000;
const KEEP_AWAKE_TAG = 'ecollect-sharing';

/** Expo Go cannot share in the background. */
export const backgroundSupported = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

// ---------- small status store the screens subscribe to ----------
const listeners = new Set();
let state = { sharing: false, mode: null, lastSentAt: null, error: '', stopAt: null };
function setState(patch) { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); }
export function subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
export const getState = () => state;

const store = {
  get: async (k) => { try { return await AsyncStorage.getItem(k); } catch { return null; } },
  set: async (k, v) => { try { if (v === null || v === undefined) await AsyncStorage.removeItem(k); else await AsyncStorage.setItem(k, String(v)); } catch { /* ignore */ } },
};

// ---------- sending ----------
let lastPostMs = 0;
let sending = false;

/** Sends one position. On failure it is kept, and sent with the next attempt (newest only). */
async function deliver(coords) {
  const now = Date.now();
  checkArrival(coords).catch(() => {});   // "You're at …" prompt, on every reading
  const stopAt = Number(await store.get(KEYS.stopAt)) || null;
  if (stopAt && now > stopAt) { await stopSharing('Sharing stopped by itself after the day\'s collection.'); return; }
  if (sending || now - lastPostMs < MIN_GAP_MS) {
    await store.set(KEYS.pending, JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }));
    return;
  }
  sending = true;
  lastPostMs = now;
  try {
    // Refresh the sign-in if it expired while the app was in the background.
    const { data } = await supabase.auth.getSession();
    if (!data?.session) throw new Error('Signed out. Open the app and sign in again.');
    const id = await cachedCollectorId();
    if (!id) throw new Error('Open the app once so it knows your collector account.');
    await flushOutbox().catch(() => {});   // a "Start shift" saved without signal goes first
    const { error } = await supabase.from('location_history').insert({ garbage_collector_id: id, latitude: coords.latitude, longitude: coords.longitude });
    if (error) throw new Error(error.message);
    const at = new Date().toISOString();
    await store.set(KEYS.last, at);
    await store.set(KEYS.error, null);
    await store.set(KEYS.pending, null);
    setState({ lastSentAt: new Date(at), error: '' });
    flushOutbox().catch(() => {});   // signal is back: send taps saved while offline
  } catch (e) {
    if (/shift/i.test(String(e?.message))) {   // the shift ended (or never started): stop sharing
      sending = false;
      await stopSharing('Location sharing stopped: it works only during your shift.');
      return;
    }
    const msg = /fetch|network/i.test(String(e?.message)) ? 'No signal. The position will be sent when the phone is back online.' : String(e?.message || e);
    await store.set(KEYS.error, msg);
    await store.set(KEYS.pending, JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }));
    setState({ error: msg });
  } finally {
    sending = false;
  }
}

/** Retries the newest unsent position (called on each new reading and when the app opens). */
async function flushPending() {
  const raw = await store.get(KEYS.pending);
  if (!raw) return;
  try { const p = JSON.parse(raw); lastPostMs = 0; await deliver(p); } catch { /* ignore */ }
}

// ---------- background task (must be defined at start-up) ----------
if (backgroundSupported && !TaskManager.isTaskDefined(GPS_TASK)) {
  TaskManager.defineTask(GPS_TASK, async ({ data, error }) => {
    if (error) { await store.set(KEYS.error, error.message); return; }
    const locations = data?.locations ?? [];
    const newest = locations[locations.length - 1];
    if (newest?.coords) await deliver(newest.coords);
  });
}

// ---------- start / stop ----------
let foregroundSub = null;

/**
 * Starts sharing. stopAt (ms) = when to stop by itself. Returns { mode, warning }.
 * mode 'background' (keeps going when locked) or 'foreground' (keep the app open).
 */
export async function startSharing({ stopAt } = {}) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new Error('Allow location access so residents and the barangay can see the truck.');
  if (!(await Location.hasServicesEnabledAsync())) throw new Error('Turn on Location (GPS) in your phone settings, then try again.');
  await store.set(KEYS.stopAt, stopAt ?? null);
  ensurePermission().catch(() => {});   // for the arrival and standby alerts

  let mode = 'foreground';
  let warning = '';
  if (backgroundSupported) {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status === 'granted') {
      await Location.startLocationUpdatesAsync(GPS_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 15000,
        distanceInterval: 10,
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.AutomotiveNavigation,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'ECollect is sharing the truck\'s location',
          notificationBody: 'Residents and the barangay can see the truck. Open ECollect to stop.',
          notificationColor: '#1f6b4a',
          killServiceOnDestroy: false,
        },
      });
      mode = 'background';
    } else {
      warning = 'Location is allowed only while the app is open. Keep ECollect open, or allow location "All the time" in your phone settings.';
    }
  } else {
    warning = 'In Expo Go, sharing works only while the app is open. The installed app keeps sharing when the phone is locked.';
  }
  if (mode === 'foreground') {
    foregroundSub?.remove();
    foregroundSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 0 },
      (pos) => { deliver(pos.coords); },
    );
    try { await activateKeepAwakeAsync(KEEP_AWAKE_TAG); } catch { /* ignore */ }
  }
  setState({ sharing: true, mode, error: '', stopAt: stopAt ?? null });
  // Send a first position right away so the truck appears on the map immediately.
  Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then((p) => { lastPostMs = 0; deliver(p.coords); }).catch(() => {});
  return { mode, warning };
}

export async function stopSharing(reason = '') {
  foregroundSub?.remove();
  foregroundSub = null;
  try { deactivateKeepAwake(KEEP_AWAKE_TAG); } catch { /* ignore */ }
  if (backgroundSupported) {
    try { if (await Location.hasStartedLocationUpdatesAsync(GPS_TASK)) await Location.stopLocationUpdatesAsync(GPS_TASK); } catch { /* ignore */ }
  }
  await store.set(KEYS.stopAt, null);
  await store.set(KEYS.pending, null);
  setState({ sharing: false, mode: null, error: reason, stopAt: null });
}

/** When the app opens: pick up a background session that is still running, and retry unsent data. */
export async function restoreSharing() {
  const last = await store.get(KEYS.last);
  const error = (await store.get(KEYS.error)) || '';
  const stopAt = Number(await store.get(KEYS.stopAt)) || null;
  let running = false;
  if (backgroundSupported) {
    try { running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK); } catch { running = false; }
  }
  if (running && stopAt && Date.now() > stopAt) { await stopSharing('Sharing stopped by itself after the day\'s collection.'); return; }
  setState({ sharing: running || Boolean(foregroundSub), mode: running ? 'background' : foregroundSub ? 'foreground' : null,
             lastSentAt: last ? new Date(last) : null, error, stopAt });
  if (running) flushPending();
}

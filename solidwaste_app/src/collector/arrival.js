// Arrival prompt and standby timer (collector app).
//
// While location sharing is on, every GPS reading is checked against today's truck stops.
// Within ARRIVE_METERS of a stop that is not done yet, the stop is marked "arrived" on the phone:
// the app says "You're at Phil Am", starts the standby countdown (the stop's standby minutes,
// from the moment of arrival), and reminds the collector when the standby time is over.
// It is only a prompt: nothing is marked done automatically.
//
// The collector can also start the standby timer by hand (for example when GPS is off).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cachedDay } from './offline';
import { notifyNow, scheduleAt, cancelScheduled } from './notify';

export const ARRIVE_METERS = 50;
const KEY = 'ecollect-arrivals';

/** Metres between two points (good enough at barangay scale). */
export function distanceM(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const x = (bLng - aLng) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

// ---------- store: { date, list: { [stopId]: { at, standby, endId } } } ----------
const listeners = new Set();
let arrivals = { date: null, list: {} };
const emit = () => listeners.forEach((l) => l(arrivals));
export function subscribeArrivals(fn) { listeners.add(fn); fn(arrivals); load().then(emit); return () => listeners.delete(fn); }

async function load() {
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) arrivals = JSON.parse(raw); } catch { /* ignore */ }
  return arrivals;
}
async function save() { try { await AsyncStorage.setItem(KEY, JSON.stringify(arrivals)); } catch { /* ignore */ } emit(); }

/** Starts the standby timer for a stop (on arrival, or by hand). */
export async function startStandby(stop, date, { auto = false } = {}) {
  await load();
  if (arrivals.date !== date) arrivals = { date, list: {} };
  if (arrivals.list[stop.id]) return arrivals.list[stop.id];
  const at = Date.now();
  const minutes = Number(stop.standby) || 0;
  let endId = null;
  if (minutes > 0) {
    endId = await scheduleAt(new Date(at + minutes * 60000), 'Standby time is over',
      `${stop.name}: tap "Done", or "Not collected" if residents did not come.`, { kind: 'standby', id: stop.id });
  }
  arrivals.list[stop.id] = { at, standby: minutes, endId, auto };
  await save();
  if (auto) {
    await notifyNow(`You're at ${stop.name}`, minutes ? `Stand by ${minutes} min while residents bring their garbage.` : 'Stand by while residents bring their garbage.', { kind: 'arrived', id: stop.id });
  }
  return arrivals.list[stop.id];
}

/** The stop was marked done / couldn't collect / undone: stop its timer reminder. */
export async function endStandby(stopId, { forget = false } = {}) {
  await load();
  const a = arrivals.list[stopId];
  if (!a) return;
  if (a.endId) await cancelScheduled(a.endId);
  if (forget) delete arrivals.list[stopId];
  else arrivals.list[stopId] = { ...a, endId: null, closed: true };
  await save();
}

/** Called with each GPS reading while sharing (also from the background task). */
export async function checkArrival(coords) {
  if (!coords) return;
  const day = await cachedDay();
  if (!day?.stops?.length) return;
  await load();
  if (arrivals.date !== day.date) arrivals = { date: day.date, list: {} };
  for (const s of day.stops) {
    if (s.lat == null || s.state === 'done' || s.state === 'missed' || arrivals.list[s.id]) continue;
    if (distanceM(coords.latitude, coords.longitude, Number(s.lat), Number(s.lng)) <= ARRIVE_METERS) {
      await startStandby(s, day.date, { auto: true });
      break;
    }
  }
}

/** Seconds of standby left (negative when over), or null when the timer has not started. */
export function standbyLeft(a, now = Date.now()) {
  if (!a || !a.standby) return null;
  return Math.round((a.at + a.standby * 60000 - now) / 1000);
}

export async function clearArrivals() { arrivals = { date: null, list: {} }; try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ } emit(); }

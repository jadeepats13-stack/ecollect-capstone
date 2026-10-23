// Works without signal (collector app).
//
// * The last day loaded from the server is kept on the phone, so Today still shows the stops
//   when there is no signal.
// * Taps that need the server (Done, Not collected, Undo, emergency status, shift, problem
//   reports) are saved in an outbox with the time they were tapped, shown on screen right away,
//   and sent in order when the phone is back online. The server keeps the tap time (up to a
//   day back), so a pickup done without signal still shows when it really happened.
// * If the server refuses a saved tap (for example the stop was removed meanwhile), it is
//   dropped and the collector is told once.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const KEYS = { day: 'ecollect-day', outbox: 'ecollect-outbox', failed: 'ecollect-outbox-failed', emergencies: 'ecollect-emergencies' };

/** True when an error means "no connection" (as opposed to the server saying no). */
export function isOffline(err) {
  return /network request failed|failed to fetch|fetch failed|networkerror|network error|timed? ?out|aborted|cannot reach the server/i.test(String(err?.message ?? err ?? ''));
}

const read = async (k, fallback) => { try { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = async (k, v) => { try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// ---------- status the screens subscribe to ----------
const listeners = new Set();
let status = { pending: 0, sending: false, failed: [] };
function setStatus(patch) { status = { ...status, ...patch }; listeners.forEach((l) => l(status)); }
export function subscribeOutbox(fn) { listeners.add(fn); fn(status); refreshStatus(); return () => listeners.delete(fn); }
async function refreshStatus() { setStatus({ pending: (await read(KEYS.outbox, [])).length, failed: await read(KEYS.failed, []) }); }
export async function clearFailed() { await write(KEYS.failed, []); setStatus({ failed: [] }); }

// ---------- the day ----------
export async function saveDay(day) { if (day?.date) await write(KEYS.day, { ...day, cachedAt: Date.now() }); }

// ---------- on shift? (collector actions are locked without a shift) ----------
const shiftListeners = new Set();
let onShift = null;   // null = not known yet
export function setOnShift(v) { if (onShift === v) return; onShift = v; shiftListeners.forEach((l) => l(v)); }
export function subscribeShift(fn) {
  shiftListeners.add(fn); fn(onShift);
  if (onShift === null) cachedDay().then((d) => withPending(d)).then((d) => { if (d && onShift === null) setOnShift(Boolean(d.shift)); }).catch(() => {});
  return () => shiftListeners.delete(fn);
}
export async function cachedDay() { return read(KEYS.day, null); }
/** Emergency lists saved per filter ('open', 'Completed', 'Cancelled'). */
export async function saveEmergencies(list, key = 'open') { const all = await read(KEYS.emergencies, {}); await write(KEYS.emergencies, { ...(Array.isArray(all) ? {} : all), [key]: list }); }
export async function cachedEmergencies(key = 'open') { const all = await read(KEYS.emergencies, {}); return Array.isArray(all) ? (key === 'open' ? all : null) : all[key] ?? null; }

/** Emergency pickups with the status taps not yet sent shown on them. */
export async function emergenciesWithPending(list) {
  if (!list) return list;
  const box = await read(KEYS.outbox, []);
  const out = list.map((e) => ({ ...e }));
  for (const a of box) {
    if (a.kind !== 'emergency') continue;
    const e = out.find((x) => x.id === a.id);
    if (e) Object.assign(e, { status: a.status, pending: true, completed_at: a.status === 'Completed' ? (e.completed_at ?? a.at) : null });
  }
  return out;
}

// ---------- sending one action ----------
/** Calls the server for one saved action. Throws on failure. Returns the updated day when the server sends one. */
async function send(a) {
  let res;
  switch (a.kind) {
    case 'stop':
      res = await supabase.rpc('collector_stop_action', {
        p_point: a.point, p_action: a.action, p_at: a.at, p_load: a.load ?? null, p_reason: a.reason ?? null, p_note: a.note ?? null,
      });
      break;
    case 'emergency':
      res = await supabase.rpc('collector_set_emergency', { p_id: a.id, p_status: a.status, p_at: a.at });
      break;
    case 'shift':
      res = await supabase.rpc(a.action === 'start' ? 'collector_start_shift' : 'collector_end_shift', { p_at: a.at });
      break;
    case 'report':
      res = await supabase.from('field_report').insert({ ...a.row, created_at: a.at });
      break;
    default:
      return null;
  }
  if (res.error) throw new Error(res.error.message);
  return a.kind === 'report' ? null : res.data;
}

let flushing = null;
/** Sends saved actions in order. Stops at the first connection problem. Returns the newest day, if any. */
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    let day = null;
    let box = await read(KEYS.outbox, []);
    if (!box.length) { flushing = null; return null; }
    setStatus({ sending: true });
    try {
      while (box.length) {
        const a = box[0];
        try {
          day = (await send(a)) ?? day;
        } catch (e) {
          if (isOffline(e)) break;
          const failed = [...(await read(KEYS.failed, [])), { label: a.label, message: e.message, at: a.at }].slice(-10);
          await write(KEYS.failed, failed);
        }
        box = box.slice(1);
        await write(KEYS.outbox, box);
      }
    } finally {
      if (day) await saveDay(day);
      setStatus({ sending: false });
      await refreshStatus();
      flushing = null;
    }
    return day;
  })();
  return flushing;
}

/**
 * Runs an action now, or saves it for later when there is no signal.
 * Returns { day, queued }: the updated day from the server, or the cached day with the saved
 * actions shown on it.
 */
export async function runAction(action) {
  const a = { ...action, at: new Date().toISOString(), key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  if (a.kind === 'shift') setOnShift(a.action === 'start');
  const box = await read(KEYS.outbox, []);
  if (!box.length) {
    try {
      const day = await send(a);
      if (day) await saveDay(day);
      if (day && 'shift' in day) setOnShift(Boolean(day.shift));
      return { day, queued: false };
    } catch (e) {
      if (!isOffline(e)) throw e;
    }
  }
  await write(KEYS.outbox, [...box, a]);
  await refreshStatus();
  flushOutbox();   // older saved actions first; this one follows
  return { day: await withPending(await cachedDay()), queued: true };
}

/** Philippine time now ("17:05:00"), from the phone clock; used only while offline. */
const phNow = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 19);
const stateByTime = (s) => (s.end && phNow() > s.end ? 'late' : s.start && phNow() >= s.start ? 'now' : 'upcoming');

/** The cached day with the saved (not yet sent) actions applied, so the screen shows what the collector did. */
export async function withPending(day) {
  if (!day) return day;
  const box = await read(KEYS.outbox, []);
  if (!box.length) return day;
  const d = { ...day, stops: (day.stops ?? []).map((s) => ({ ...s })), emergencies: (day.emergencies ?? []).map((e) => ({ ...e })) };
  for (const a of box) {
    if (a.kind === 'stop') {
      const s = d.stops.find((x) => x.id === a.point);
      if (!s) continue;
      s.pending = true;
      if (a.action === 'done') Object.assign(s, { state: 'done', done_at: a.at, missed_at: null, missed_reason: null, note: null, load: a.load ?? s.load ?? null });
      else if (a.action === 'missed') Object.assign(s, { state: 'missed', missed_at: a.at, done_at: null, missed_reason: a.reason, note: a.note ?? null, load: null });
      else Object.assign(s, { state: stateByTime(s), done_at: null, missed_at: null, missed_reason: null, note: null, load: null });
    } else if (a.kind === 'emergency') {
      const e = d.emergencies.find((x) => x.id === a.id);
      if (e) Object.assign(e, { status: a.status, pending: true });
    } else if (a.kind === 'shift') {
      d.shift = a.action === 'start' ? (d.shift ?? { id: null, started_at: a.at, pending: true }) : null;
    }
  }
  // A zone counts as done when every one of today's stops serving it is done.
  const doneZones = new Set();
  const allZones = new Set();
  for (const s of d.stops) for (const z of s.zones ?? []) allZones.add(z.route_id);
  for (const zid of allZones) {
    if (d.stops.filter((s) => (s.zones ?? []).some((z) => z.route_id === zid)).every((s) => s.state === 'done')) doneZones.add(zid);
  }
  d.stops = d.stops.map((s) => ({ ...s, zones: (s.zones ?? []).map((z) => ({ ...z, done: doneZones.has(z.route_id) })) }));
  return d;
}

/** Forget everything on log out (another collector may sign in on this phone). */
export async function clearOffline() {
  try { await AsyncStorage.multiRemove([KEYS.day, KEYS.outbox, KEYS.failed, KEYS.emergencies]); } catch { /* ignore */ }
  setStatus({ pending: 0, failed: [], sending: false });
  setOnShift(null);
}

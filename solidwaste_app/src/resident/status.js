// Resident app: what today's pickup looks like, in plain words (pure functions; tested in appunit).
import { colors } from '../theme';
import { fmtRange, fmtTime } from '../utils/schedule';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Tomorrow", "Thursday, Oct 22" for a YYYY-MM-DD date. */
export function dayName(iso, today, long = true) {
  if (iso === today) return 'Today';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Math.round((d - new Date(`${today}T00:00:00Z`)) / 86400000) === 1) return 'Tomorrow';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${long ? names[d.getUTCDay()] : WEEK[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export const weekday = (iso) => WEEK[new Date(`${iso}T00:00:00Z`).getUTCDay()];
export const dateNum = (iso) => Number(iso.slice(8, 10));

/** Philippine clock time of a timestamp: "5:12 PM". */
export function phClock(ts) {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() + 8 * 3600000);
  return fmtTime(`${d.getUTCHours()}:${d.getUTCMinutes()}:00`);
}

export const TONES = {
  done: { fg: colors.done, bg: colors.doneLight, icon: 'checkmark-circle' },
  now: { fg: colors.blue, bg: colors.blueLight, icon: 'car' },
  upcoming: { fg: colors.primaryDark, bg: colors.primaryLight, icon: 'time' },
  late: { fg: colors.amber, bg: colors.amberLight, icon: 'hourglass' },
  missed: { fg: colors.danger, bg: colors.dangerLight, icon: 'close-circle' },
  idle: { fg: colors.muted, bg: colors.surface2, icon: 'calendar' },
};

/** Today's stops of my zone with their names and times: [{ ...stop, state, done_at, missed_reason }]. */
export function todayStops(day) {
  const byId = new Map((day?.stops ?? []).map((s) => [s.id, s]));
  return (day?.today?.stops ?? []).map((t) => ({ ...byId.get(t.id), ...t })).filter((s) => s.name);
}

/** The next day (from today) that has a pickup still to come: { date, stops[] } or null. */
export function nextPickup(day) {
  const byId = new Map((day?.stops ?? []).map((s) => [s.id, s]));
  const open = new Set(todayStops(day).filter((s) => s.state === 'upcoming' || s.state === 'now').map((s) => s.id));
  for (const d of day?.next ?? []) {
    const ids = d.date === day.date ? (d.stops ?? []).filter((id) => open.has(id)) : d.stops ?? [];
    if (ids.length) return { date: d.date, stops: ids.map((id) => byId.get(id)).filter(Boolean) };
  }
  return null;
}

/** The big card on Home: { tone, title, text }. */
export function todayStatus(day) {
  const list = todayStops(day);
  if (!list.length) {
    const n = nextPickup(day);
    return { tone: 'idle', title: 'No garbage pickup today',
      text: n ? `Next pickup: ${dayName(n.date, day.date)}, ${fmtRange(n.stops[0].start, n.stops[0].end)} at ${n.stops[0].name}.` : 'No pickups are scheduled for your zone in the next 7 days.' };
  }
  const missed = list.filter((s) => s.state === 'missed');
  if (missed.length) {
    return { tone: 'missed', title: 'Not collected today',
      text: missed.map((s) => `${s.name}: ${s.missed_reason || 'the truck could not collect'}`).join('\n') + '\nThe barangay has been told.' };
  }
  if (list.every((s) => s.state === 'done')) {
    const last = list.map((s) => s.done_at).filter(Boolean).sort().pop();
    return { tone: 'done', title: 'Collected today', text: last ? `The truck collected at ${phClock(last)}. Thank you!` : 'Thank you!' };
  }
  const now = list.find((s) => s.state === 'now');
  if (now) return { tone: 'now', title: 'The truck stop is open now', text: `${now.name}, ${fmtRange(now.start, now.end)}. Bring out your garbage.` };
  const next = list.find((s) => s.state === 'upcoming');
  if (next) return { tone: 'upcoming', title: 'Garbage pickup today', text: `${next.name}, ${fmtRange(next.start, next.end)}.` };
  return { tone: 'late', title: 'Waiting for the truck', text: 'The pickup time has passed but the truck has not marked it collected yet.' };
}

/** Show "Rate today's pickup"? Only on a pickup day, once, after the truck came or the time passed. */
export function canRate(day) {
  if (!day || day.rated_today) return false;
  const list = todayStops(day);
  if (!list.length) return false;
  return list.some((s) => s.state === 'done' || s.state === 'missed') || list.every((s) => s.state === 'late');
}

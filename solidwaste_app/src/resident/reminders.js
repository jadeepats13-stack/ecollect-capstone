// Resident app: pickup reminders on the phone (work without internet once scheduled, also in Expo Go).
//  * 7:00 PM the day before a pickup day: "Garbage pickup tomorrow".
//  * 30 minutes before each truck stop of my zone: "Garbage truck in 30 minutes".
// Scheduled for the next 7 days whenever Home loads; re-scheduled only when something changed.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cancelScheduled, ensurePermission, scheduleAt } from '../collector/notify';
import { fmtRange, fmtTime } from '../utils/schedule';

const KEY = 'ecollect-resident-reminders';
const PREF = 'ecollect-reminders-on';

export async function remindersOn() {
  try { return (await AsyncStorage.getItem(PREF)) !== 'off'; } catch { return true; }
}

async function cancelAll() {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null');
    for (const id of saved?.ids ?? []) await cancelScheduled(id);
    await AsyncStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export async function setRemindersOn(on, day) {
  await AsyncStorage.setItem(PREF, on ? 'on' : 'off');
  if (!on) return cancelAll();
  if (!(await ensurePermission())) return false;
  if (day) await scheduleReminders(day);
  return true;
}

const at = (date, time) => new Date(Date.parse(`${date}T${time}+08:00`));
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The reminders wanted for this day data (pure; exported for tests). */
export function plannedReminders(day, now = Date.now()) {
  if (!day?.me?.zone_id || day.me.mode === 'drop_off') return [];
  const stops = new Map((day.stops ?? []).map((s) => [s.id, s]));
  const doneToday = new Set((day.today?.stops ?? []).filter((s) => s.state === 'done' || s.state === 'missed').map((s) => s.id));
  const out = [];
  for (const d of day.next ?? []) {
    const list = (d.stops ?? []).map((id) => stops.get(id)).filter((s) => s?.start);
    if (!list.length) continue;
    const first = list[0];
    const where = list.length === 1 ? `${first.name}, ${fmtRange(first.start, first.end)}` : list.map((s) => `${s.name} ${fmtTime(s.start)}`).join(' · ');
    out.push({ key: `eve|${d.date}`, at: at(addDays(d.date, -1), '19:00:00'), title: 'Garbage pickup tomorrow', body: `Prepare your garbage. Truck stop: ${where}.`, data: { kind: 'reminder' } });
    for (const s of list) {
      if (d.date === day.date && doneToday.has(s.id)) continue;
      out.push({ key: `soon|${d.date}|${s.id}|${s.start}`, at: new Date(at(d.date, s.start).getTime() - 30 * 60000), title: 'Garbage truck in 30 minutes',
        body: `${s.name}: the truck stands by ${fmtRange(s.start, s.end)}. Bring out your garbage.`, data: { kind: 'reminder', id: s.id } });
    }
  }
  return out.filter((r) => r.at.getTime() > now + 60000);
}

export async function scheduleReminders(day) {
  try {
    if (!(await remindersOn())) return;
    const want = plannedReminders(day);
    const sig = want.map((r) => `${r.key}@${r.at.getTime()}`).join(',');
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null');
    if (saved?.sig === sig) return;
    for (const id of saved?.ids ?? []) await cancelScheduled(id);
    const ids = [];
    for (const r of want) {
      const id = await scheduleAt(r.at, r.title, r.body, r.data);
      if (id) ids.push(id);
    }
    await AsyncStorage.setItem(KEY, JSON.stringify({ sig: ids.length ? sig : null, ids }));
  } catch { /* reminders are a convenience; never block the screen */ }
}

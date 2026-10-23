export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "07:00:00" -> "7:00 AM" */
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function fmtRange(start, end) {
  if (!start) return 'Time to be announced';
  return end ? `${fmtTime(start)} – ${fmtTime(end)}` : fmtTime(start);
}

export function fmtDate(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Postgres timestamp -> Date. Timestamps without a timezone are treated as UTC. */
export function parseTs(ts) {
  if (!ts) return null;
  let s = String(ts).replace(' ', 'T');
  if (!/(Z|[+-]\d{2}(:?\d{2})?)$/.test(s)) s += 'Z';
  return new Date(s);
}

/** Local date as YYYY-MM-DD (matches a Postgres `date` column). */
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function minutesSince(ts) {
  const d = parseTs(ts);
  return d ? Math.max(0, Math.round((Date.now() - d.getTime()) / 60000)) : 0;
}

export function fmtDateTime(ts) {
  const d = parseTs(ts);
  if (!d || isNaN(d)) return '';
  return `${fmtDate(d)}, ${d.getFullYear()} at ${fmtTime(`${d.getHours()}:${d.getMinutes()}:00`)}`;
}

export function timeAgo(minutes) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} day(s) ago`;
}

/**
 * Finds the next pickup day among the schedule rows, plus every row on that day.
 * A pickup still in progress today counts as "Today".
 */
export function nextPickup(schedules, now = new Date()) {
  let best = null;

  for (const s of schedules) {
    const dayIdx = DAYS.indexOf(s.day_of_week);
    if (dayIdx < 0) continue;

    const [sh, sm] = (s.start_time || '00:00:00').split(':').map(Number);
    const [eh, em] = (s.end_time || s.start_time || '23:59:00').split(':').map(Number);

    const start = new Date(now);
    start.setDate(now.getDate() + ((dayIdx - now.getDay() + 7) % 7));
    start.setHours(sh, sm, 0, 0);

    const end = new Date(start);
    end.setHours(eh, em, 0, 0);

    if (end < now) {            // already finished -> same weekday next week
      start.setDate(start.getDate() + 7);
    }
    if (!best || start < best.start) best = { start, dayIdx };
  }
  if (!best) return null;

  const items = schedules.filter((s) => DAYS.indexOf(s.day_of_week) === best.dayIdx);
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target0 = new Date(best.start.getFullYear(), best.start.getMonth(), best.start.getDate());
  const diffDays = Math.round((target0 - today0) / 86400000);

  return {
    label: diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : DAYS[best.dayIdx],
    dateText: fmtDate(best.start),
    items,
  };
}

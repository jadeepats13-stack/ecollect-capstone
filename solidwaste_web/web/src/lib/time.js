// Dates and times, always in Philippine time (Asia/Manila), whatever the computer's time zone.
// Dates are passed around as 'YYYY-MM-DD' strings and times as 'HH:MM:SS', like the PHP version.

const TZ = 'Asia/Manila';
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_BY_JS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Timestamp (ISO string or Date) -> 'YYYY-MM-DD HH:MM:SS' in Manila time. */
export function toManila(ts) {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

const utc = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (dt) => dt.toISOString().slice(0, 10);

export function addDays(date, n) { const d = utc(date); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
export function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
export function weekday(date) { return DAY_BY_JS[utc(date).getUTCDay()]; }
export function mondayOf(date) { const d = utc(date); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return iso(d); }
export function firstOfMonth(date) { return date.slice(0, 8) + '01'; }

/** ISO week key, like PHP date('o-\WW'). */
export function isoWeek(date) {
  const d = utc(date);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = utc(s);
  return iso(d) === s ? s : null;
}

/** '17:00:00' -> '5:00 PM' */
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function fmtWindow(start, end) {
  if (!start || !end) return 'No time set';
  return `${fmtTime(start)}–${fmtTime(end)}`;
}

/** Date formats used by the PHP pages. */
export function fmtDate(date, style = 'M j') {
  if (!date) return '';
  const d = utc(String(date).slice(0, 10));
  const M = MONTHS[d.getUTCMonth()].slice(0, 3);
  const F = MONTHS[d.getUTCMonth()];
  const j = d.getUTCDate();
  const Y = d.getUTCFullYear();
  const l = DAY_BY_JS[d.getUTCDay()];
  const D = l.slice(0, 3);
  switch (style) {
    case 'M j': return `${M} ${j}`;
    case 'M j, Y': return `${M} ${j}, ${Y}`;
    case 'D, M j': return `${D}, ${M} ${j}`;
    case 'l, M j': return `${l}, ${M} ${j}`;
    case 'l, F j, Y': return `${l}, ${F} ${j}, ${Y}`;
    case 'D': return D;
    case 'j': return String(j);
    default: return `${M} ${j}, ${Y}`;
  }
}

/** 'YYYY-MM-DD HH:MM:SS' (Manila) -> 'Oct 19, 9:41 AM' */
export function fmtStamp(manila, withYear = false) {
  if (!manila) return '';
  const date = manila.slice(0, 10);
  return `${fmtDate(date, withYear ? 'M j, Y' : 'M j')}, ${fmtTime(manila.slice(11, 19))}`;
}

export function ago(minutes) {
  if (minutes === null || minutes === undefined) return 'never';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
}

/**
 * Server clock (Philippine time) from the app_clock() database function, kept ticking
 * locally so the dashboards agree with the database about what "today" is.
 */
let offsetMs = 0;
export function setServerClock(clock) {
  if (!clock?.now) return;
  const server = new Date(clock.now.replace(' ', 'T') + '+08:00').getTime();
  offsetMs = server - Date.now();
}
export function nowManila() { return toManila(new Date(Date.now() + offsetMs)); }
export function clockNow() {
  const n = nowManila();
  return { date: n.slice(0, 10), time: n.slice(11, 19), now: n, day: weekday(n.slice(0, 10)) };
}

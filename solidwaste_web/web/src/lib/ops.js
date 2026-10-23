/**
 * Operations data layer shared by both dashboards, the live map and the reports.
 * A line-by-line port of includes/ops.php + includes/fixed_schedule.php (read side)
 * from the PHP version. Every number is computed from database rows.
 *
 * COLLECTION STATUS MODEL
 * An "expected collection" on date D is an Active collection_schedule row whose
 * day_of_week is D's weekday (from its effective_from date). Its status comes from
 * pickup_log, written by the collector app when a pickup is marked done:
 *   completed  a pickup_log row exists for (schedule, D)  (late = logged after the window end)
 *   delayed    no log and the window has ended (D in the past, or today after end_time)
 *   ongoing    no log, today, inside the window
 *   pending    no log, today, before the window
 *   upcoming   D is in the future
 *   untracked  D is before pickup tracking started (not counted as missed)
 * A truck stop the collector marked "Couldn't collect" (stop_visit.outcome = 'missed') makes the zones
 * it serves 'delayed' at once, with item.missed = { reason, note, stop, at }.
 * Completion rate = completed / (completed + delayed).
 */
import { supabase, must } from './supabase';
import {
  DAYS, addDays, ago as fmtAgo, clockNow, daysBetween, fmtDate, fmtTime, fmtWindow,
  isoWeek, mondayOf, setServerClock, toManila, validDate, weekday, firstOfMonth,
} from './time';
import {
  FEEDBACK_CLOSED_STATUSES, FIXED_ZONE_COUNT, GPS_LIVE_MINUTES, GPS_RECENT_MINUTES, PERFORMANCE_TRACKING_START,
} from '../config';

export const ZONE_COLORS = ['#0f766e', '#6d28d9', '#b45309', '#be185d', '#0369a1', '#4d7c0f', '#c2410c', '#475569', '#a21caf', '#1e40af'];
export const STATUS_LABELS = {
  completed: 'Completed', ongoing: 'Ongoing', pending: 'Pending', delayed: 'Delayed', upcoming: 'Upcoming', untracked: 'Before tracking',
};
/** Status text for a collection item ("Missed: Blocked road" when the collector said why). */
export const stateLabel = (it) => (it.missed && it.state === 'delayed' ? `Missed: ${it.missed.reason}` : STATUS_LABELS[it.state] ?? it.state);
/** Truck load levels the collector picks (stop_visit.load_level). */
export const LOAD_LABELS = { 1: '¼ full', 2: '½ full', 3: '¾ full', 4: 'Full' };
export const EMERGENCY_STATUSES = ['Scheduled', 'In progress', 'Completed', 'Cancelled'];

// ---------- small helpers ----------
export function rate(completed, delayed) {
  const due = completed + delayed;
  return due > 0 ? Math.round((completed / due) * 1000) / 10 : null;
}
export function zoneNumber(name) { const m = /(\d+)/.exec(String(name ?? '')); return m ? Number(m[1]) : null; }
export function zoneColor(number, fallbackIndex = 0) {
  const i = number !== null && number >= 1 ? number - 1 : fallbackIndex;
  return ZONE_COLORS[i % ZONE_COLORS.length];
}
export function daysList(csv) {
  const parts = String(csv ?? '').split(',').map((s) => s.trim());
  return DAYS.filter((d) => parts.includes(d));
}
const sub8 = (t) => (t ? String(t).slice(0, 8) : null);

/**
 * Route / boundary coordinates -> [[lat, lng], ...]. Reads both the app's JSON
 * ([{"latitude":..,"longitude":..}] or [[lat,lng]]) and the PHP text format ("lat,lng; lat,lng").
 */
export function parsePath(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return [];
  const s = String(raw).trim();
  const ok = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (s.startsWith('[')) {
    try {
      return JSON.parse(s).map((p) => {
        if (Array.isArray(p)) {
          const [a, b] = p.map(Number);
          return Math.abs(a) <= 90 && Math.abs(b) > 90 ? [a, b] : [b, a];
        }
        return [Number(p?.latitude ?? p?.lat), Number(p?.longitude ?? p?.lng ?? p?.lon)];
      }).filter(([a, b]) => ok(a, b));
    } catch { return []; }
  }
  const pts = [];
  for (const pair of s.split(/[;\n]+/)) {
    const p = pair.split(',').map((x) => x.trim());
    if (p.length === 2 && p[0] !== '' && p[1] !== '' && !Number.isNaN(Number(p[0])) && !Number.isNaN(Number(p[1]))) {
      const lat = Number(p[0]), lng = Number(p[1]);
      if (ok(lat, lng)) pts.push([lat, lng]);
    }
  }
  return pts;
}
/** [[lat, lng], ...] -> "lat,lng; lat,lng" for the route text box. */
export const pathToText = (pts) => pts.map(([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`).join('; ');

export function gpsState(minutes) {
  if (minutes === null || minutes === undefined) return 'none';
  if (minutes <= GPS_LIVE_MINUTES) return 'live';
  return minutes <= GPS_RECENT_MINUTES ? 'recent' : 'stale';
}
export const feedbackIsOpen = (status) => !FEEDBACK_CLOSED_STATUSES.includes(String(status ?? ''));
const blankCounts = () => ({ expected: 0, completed: 0, late: 0, delayed: 0, ongoing: 0, pending: 0, rate: null });

/** Is a Google Maps link safe to show? Mirrors fs_clean_maps_url() in the PHP version. */
export function cleanMapsUrl(url) {
  let u = String(url ?? '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  u = u.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]/gu, (c) => encodeURIComponent(c));
  if (u.length > 1000) return null;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  const ok = (['www.google.com', 'google.com', 'maps.google.com', 'www.google.com.ph', 'google.com.ph'].includes(host)
      && (host === 'maps.google.com' || path.startsWith('/maps')))
    || host === 'maps.app.goo.gl' || (host === 'goo.gl' && path.startsWith('/maps'));
  if (!ok) return null;
  return 'https://' + host + u.slice(u.indexOf(host) + host.length);
}

/** Reads ?range= into [from, to, label, key] like ops_range_from_request(). */
export function rangeFrom(key, today, custom = {}) {
  const from = validDate(custom.from), to = validDate(custom.to);
  if (from && to) {
    let [a, b] = from > to ? [to, from] : [from, to];
    if (daysBetween(a, b) > 366) a = addDays(b, -366);
    return [a, b, `${fmtDate(a, 'M j, Y')} – ${fmtDate(b, 'M j, Y')}`, 'custom'];
  }
  switch (String(key)) {
    case 'today': return [today, today, 'Today', 'today'];
    case '7': return [addDays(today, -6), today, 'Last 7 days', '7'];
    case '14': return [addDays(today, -13), today, 'Last 14 days', '14'];
    case '90': return [addDays(today, -89), today, 'Last 90 days', '90'];
    case 'month': return [firstOfMonth(today), today, 'This month', 'month'];
    default: return [addDays(today, -29), today, 'Last 30 days', '30'];
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Server clock in Philippine time; also syncs the local ticking clock. */
export async function loadClock() {
  const { data, error } = await supabase.rpc('app_clock');
  if (!error && data) { setServerClock(data); return data; }
  return clockNow();
}

/**
 * Loads everything the operations views need, in parallel.
 * opts.logsFrom/logsTo: pickup_log range. opts.feedback: also load resident reports.
 * opts.activity / opts.emergency / opts.fleet: optional parts.
 */
export async function loadOps(opts = {}) {
  const clock = await loadClock();
  if (opts.logsToday) opts = { ...opts, logsFrom: clock.date, logsTo: clock.date };
  const q = {
    routes: supabase.from('route').select('*, barangay_admin(firstname, lastname)'),
    schedules: supabase.from('collection_schedule').select('*, waste_category(category_name), garbage_collector(first_name, last_name, truck(plate_number)), collection_point(name)'),
    points: supabase.from('collection_point').select('*'),
    cpz: supabase.from('collection_point_zone').select('*'),
    firstLog: supabase.from('pickup_log').select('pickup_date').order('pickup_date', { ascending: true }).limit(1),
  };
  if (opts.logsFrom && opts.logsTo) {
    q.logs = supabase.from('pickup_log').select('collection_schedule_id, pickup_date, completed_at')
      .gte('pickup_date', opts.logsFrom).lte('pickup_date', opts.logsTo);
    q.visits = supabase.from('stop_visit').select('collection_point_id, visit_date, outcome, missed_reason, note, load_level, completed_at')
      .gte('visit_date', opts.logsFrom).lte('visit_date', opts.logsTo);
  }
  if (opts.fleet !== false) {
    q.collectors = supabase.from('garbage_collector').select('garbage_collector_id, first_name, last_name, route_id, truck_id, email, auth_user_id, truck(plate_number, max_capacity_kg)');
    q.trucks = supabase.from('truck').select('*').order('plate_number');
    q.latest = supabase.rpc('admin_latest_locations');
  }
  if (opts.feedback) {
    q.feedback = supabase.from('feedback_report').select('*, resident(first_name, last_name, email, contact_number, route_id)').order('feedback_report_id', { ascending: false });
  }
  if (opts.emergency) {
    q.emergency = supabase.from('emergency_collection').select('*, garbage_collector(first_name, last_name), truck(plate_number), barangay_admin(firstname, lastname)');
  }
  if (opts.activity) {
    q.actPickups = supabase.from('pickup_log').select('completed_at, collection_schedule(route_id, waste_category(category_name)), garbage_collector(first_name, last_name)').order('completed_at', { ascending: false }).limit(12);
    q.actFeedback = supabase.from('feedback_report').select('created_at, report_type, resident(first_name, last_name)').order('created_at', { ascending: false }).limit(12);
    q.actAnnouncements = supabase.from('announcement').select('published_timestamp, title').order('published_timestamp', { ascending: false }).limit(12);
  }
  const keys = Object.keys(q);
  const res = await Promise.all(keys.map((k) => q[k]));
  const data = {};
  keys.forEach((k, i) => { data[k] = must(res[i]); });
  return new Ops(clock, data);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
export class Ops {
  constructor(clock, d) {
    this.clock = { date: clock.date, time: clock.time, now: clock.now, day: clock.day || weekday(clock.date) };
    this.d = d;
    this._zones = this.buildZones();
    this._zoneById = new Map(this._zones.map((z) => [z.id, z]));
    this._schedules = null;
    this._fleet = null;
    this.logs = {};
    for (const r of d.logs ?? []) {
      this.logs[`${r.collection_schedule_id}|${r.pickup_date}`] = toManila(r.completed_at) ?? r.pickup_date;
    }
    // "Couldn't collect" at a truck stop -> every zone that stop serves, that date
    this.missed = {};
    const pointName = new Map((d.points ?? []).map((p) => [p.collection_point_id, p.name]));
    const served = {};
    for (const l of d.cpz ?? []) (served[l.collection_point_id] ??= []).push(l.route_id);
    for (const v of d.visits ?? []) {
      if (v.outcome !== 'missed') continue;
      const info = { reason: v.missed_reason || 'Other', note: v.note ?? '', stop: pointName.get(v.collection_point_id) ?? 'Truck stop', at: toManila(v.completed_at) };
      for (const z of served[v.collection_point_id] ?? []) this.missed[`${z}|${v.visit_date}`] ??= info;
    }
  }

  // ---------- zones ----------
  buildZones() {
    const zones = (this.d.routes ?? []).map((r) => {
      const name = String(r.zone_name ?? '').trim() !== '' ? String(r.zone_name).trim() : `Route #${r.route_id}`;
      return {
        id: r.route_id, name, number: zoneNumber(r.zone_name),
        days: daysList(r.collection_days), start: r.start_time, end: r.end_time,
        window: fmtWindow(r.start_time, r.end_time),
        path: parsePath(r.path_coordinates), boundary: parsePath(r.boundary_coordinates),
        boundary_source: String(r.boundary_source ?? ''),
        mode: r.collection_mode === 'drop_off' ? 'drop_off' : 'truck',
        admin: `${r.barangay_admin?.firstname ?? ''} ${r.barangay_admin?.lastname ?? ''}`.trim(),
        admin_id: r.barangay_admin_id ?? null,
        raw_path: r.path_coordinates, color: '',
      };
    });
    zones.sort((a, b) => ((a.number ?? Infinity) - (b.number ?? Infinity)) || a.name.localeCompare(b.name) || a.id - b.id);
    zones.forEach((z, i) => { z.color = zoneColor(z.number, i); });
    return zones;
  }
  zones() { return this._zones; }
  zoneById(id) { return id === null || id === undefined ? null : this._zoneById.get(Number(id)) ?? null; }

  /** Checks the fixed 10-zone structure without changing anything. */
  zoneIntegrity() {
    const zones = this._zones, problems = [], numbers = {};
    for (const z of zones) {
      if (z.number === null) { problems.push(`${z.name} (route #${z.id}) has no zone number in its name.`); continue; }
      (numbers[z.number] ??= []).push(z.id);
    }
    if (zones.length !== FIXED_ZONE_COUNT) problems.push(`The route table has ${zones.length} zone rows; Barangay Poblacion has exactly ${FIXED_ZONE_COUNT}.`);
    for (let n = 1; n <= FIXED_ZONE_COUNT; n++) {
      if (!numbers[n]) problems.push(`Zone ${n} is missing.`);
      else if (numbers[n].length > 1) problems.push(`Zone ${n} appears ${numbers[n].length} times (route #${numbers[n].join(', #')}).`);
    }
    for (const n of Object.keys(numbers).map(Number)) {
      if (n < 1 || n > FIXED_ZONE_COUNT) problems.push(`Zone ${n} is outside the 1–${FIXED_ZONE_COUNT} range.`);
    }
    return { ok: problems.length === 0, count: zones.length, problems };
  }

  // ---------- schedules ----------
  schedules(activeOnly = false) {
    if (!this._schedules) {
      const order = (d) => { const i = DAYS.indexOf(d); return i < 0 ? 0 : i + 1; };   // MySQL FIELD(): unknown = 0
      const rows = [...(this.d.schedules ?? [])].sort((a, b) =>
        (order(a.day_of_week) - order(b.day_of_week)) || String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')) || a.collection_schedule_id - b.collection_schedule_id);
      this._schedules = rows.map((r) => {
        const zr = (this.d.routes ?? []).find((x) => x.route_id === r.route_id);
        const start = r.start_time || zr?.start_time || null;
        const end = r.end_time || zr?.end_time || null;
        const zone = this.zoneById(r.route_id);
        const gc = r.garbage_collector;
        return {
          id: r.collection_schedule_id, day: String(r.day_of_week ?? ''), status: String(r.schedule_status ?? ''),
          zone_id: r.route_id ?? null, zone: zone?.name ?? (zr?.zone_name || 'No zone'), zone_no: zone?.number ?? null,
          color: zone?.color ?? '#75837c',
          collector_id: r.garbage_collector_id ?? null,
          collector: `${gc?.first_name ?? ''} ${gc?.last_name ?? ''}`.trim()
            || (r.garbage_collector_id !== null ? `Collector #${r.garbage_collector_id} (account not found)` : 'Unassigned'),
          truck: gc?.truck?.plate_number || null,
          category: r.waste_category?.category_name || 'Garbage',
          type: r.schedule_type ?? 'custom', point_id: r.collection_point_id ?? null, point: r.collection_point?.name ?? null,
          effective_from: r.effective_from ?? null,
          start: sub8(start), end: sub8(end), window: fmtWindow(start, end),
          waste_category_id: r.waste_category_id ?? null,
        };
      });
    }
    return activeOnly ? this._schedules.filter((s) => s.status === 'Active') : this._schedules;
  }

  trackingStart() {
    if (this._track) return this._track;
    const configured = validDate(PERFORMANCE_TRACKING_START || null);
    this._track = configured || this.d.firstLog?.[0]?.pickup_date || this.clock.date;
    return this._track;
  }

  itemStatus(s, date, completedAt, missed = null) {
    const clock = this.clock;
    if (completedAt !== null && completedAt !== undefined) {
      let late = false;
      if (s.end && completedAt.length > 10) {
        late = completedAt.slice(0, 10) > date || (completedAt.slice(0, 10) === date && completedAt.slice(11, 19) > s.end);
      }
      return { status: 'completed', late };
    }
    if (date > clock.date) return { status: 'upcoming', late: false };
    if (missed) return { status: 'delayed', late: false };
    if (date < clock.date) return { status: date < this.trackingStart() ? 'untracked' : 'delayed', late: false };
    const start = s.start ?? '00:00:00', end = s.end ?? '23:59:59';
    if (clock.time < start) return { status: 'pending', late: false };
    if (clock.time <= end) return { status: 'ongoing', late: false };
    return { status: 'delayed', late: false };
  }

  /** Expected collections for one date, each with its status. */
  dayItems(date, logs = this.logs) {
    const day = weekday(date), items = [];
    for (const s of this.schedules(false)) {
      const logged = logs[`${s.id}|${date}`] ?? null;
      const expected = s.status === 'Active' && s.day === day && (s.effective_from === null || s.effective_from <= date);
      if (!expected && logged === null) continue;
      const missed = logged === null && s.type === 'fixed' ? this.missed[`${s.zone_id}|${date}`] ?? null : null;
      const st = this.itemStatus(s, date, logged, missed);
      items.push({ ...s, date, state: st.status, late: st.late, completed_at: logged, missed: st.status === 'delayed' ? missed : null });
    }
    items.sort((a, b) => String(a.start ?? '99').localeCompare(String(b.start ?? '99')) || ((a.zone_no ?? 99) - (b.zone_no ?? 99)));
    return items;
  }

  /** Performance over a date range (inclusive). Future dates are ignored. */
  period(from, to, zoneId = null) {
    const track = this.trackingStart();
    const effFrom = from > track ? from : track;
    const effTo = to < this.clock.date ? to : this.clock.date;
    const result = {
      from, to, effective_from: effFrom, effective_to: effTo, tracking_start: track,
      totals: blankCounts(), zones: {}, dates: {}, weeks: {}, categories: {}, delayed_items: [],
    };
    for (const z of this._zones) result.zones[z.id] = { ...blankCounts(), name: z.name, color: z.color, number: z.number };
    if (effFrom > effTo) return result;
    for (let d = effFrom; d <= effTo; d = addDays(d, 1)) {
      result.dates[d] = blankCounts();
      const wk = isoWeek(d);
      result.weeks[wk] ??= { ...blankCounts(), start: d };
      for (const it of this.dayItems(d)) {
        if (zoneId !== null && it.zone_id !== zoneId) continue;
        const buckets = [result.totals, result.dates[d], result.weeks[wk]];
        if (it.zone_id !== null && result.zones[it.zone_id]) buckets.push(result.zones[it.zone_id]);
        result.categories[it.category] ??= blankCounts();
        buckets.push(result.categories[it.category]);
        for (const b of buckets) {
          b.expected++;
          if (b[it.state] !== undefined && it.state !== 'expected' && it.state !== 'rate') b[it.state]++;
          if (it.late) b.late++;
        }
        if (it.state === 'delayed') result.delayed_items.push(it);
      }
    }
    const fill = (c) => { c.rate = rate(c.completed, c.delayed); };
    fill(result.totals);
    Object.values(result.zones).forEach(fill);
    Object.values(result.dates).forEach(fill);
    Object.values(result.weeks).forEach(fill);
    Object.values(result.categories).forEach(fill);
    result.delayed_items.sort((a, b) => (b.date + (b.start ?? '')).localeCompare(a.date + (a.start ?? '')));
    return result;
  }

  /** Upcoming expected collections for the next `days` days (after today). */
  upcoming(days = 7, limit = 12) {
    const out = [];
    for (let i = 1; i <= days && out.length < limit; i++) {
      const d = addDays(this.clock.date, i);
      const day = weekday(d);
      const active = this.schedules(true).filter((s) => s.day === day && (s.effective_from === null || s.effective_from <= d));
      const items = active.map((s) => ({ ...s, date: d, state: 'upcoming', late: false, completed_at: null }))
        .sort((a, b) => String(a.start ?? '99').localeCompare(String(b.start ?? '99')) || ((a.zone_no ?? 99) - (b.zone_no ?? 99)));
      for (const it of items) { out.push(it); if (out.length >= limit) break; }
    }
    return out;
  }

  /** Every expected collection in a range (from the tracking start, up to today), newest first. */
  itemsRange(from, to, zoneId = null) {
    const track = this.trackingStart();
    const f = from > track ? from : track;
    const t = to < this.clock.date ? to : this.clock.date;
    if (f > t) return [];
    const out = [];
    for (let d = t; d >= f; d = addDays(d, -1)) {
      for (const it of this.dayItems(d)) if (zoneId === null || it.zone_id === zoneId) out.push(it);
    }
    return out;
  }

  // ---------- fleet ----------
  fleet() {
    if (this._fleet) return this._fleet;
    const latest = new Map((this.d.latest ?? []).map((l) => [l.garbage_collector_id, l]));
    const byCollector = {};
    for (const it of this.dayItems(this.clock.date)) {
      if (it.collector_id !== null) (byCollector[it.collector_id] ??= []).push(it);
    }
    const rows = [...(this.d.collectors ?? [])].sort((a, b) =>
      String(a.last_name).localeCompare(String(b.last_name)) || String(a.first_name).localeCompare(String(b.first_name)));
    this._fleet = rows.map((r) => {
      const l = latest.get(r.garbage_collector_id);
      const mins = l ? Math.max(0, l.minutes_ago) : null;
      const items = byCollector[r.garbage_collector_id] ?? [];
      const done = items.filter((i) => i.state === 'completed').length;
      const zone = this.zoneById(r.route_id);
      return {
        id: r.garbage_collector_id, name: `${r.first_name} ${r.last_name}`.trim(), email: r.email,
        has_login: Boolean(r.auth_user_id),
        zone_id: zone?.id ?? null, zone: zone?.name ?? 'No zone', color: zone?.color ?? '#75837c',
        truck_id: r.truck_id ?? null, truck: r.truck?.plate_number ?? null,
        lat: l ? Number(l.latitude) : null, lng: l ? Number(l.longitude) : null, heading: l && l.heading !== null ? Number(l.heading) : null,
        ping_at: l ? toManila(l.ping_at) : null, minutes_ago: mins, ago: fmtAgo(mins), gps: gpsState(mins),
        today_total: items.length, today_done: done, on_duty: items.some((i) => i.state === 'ongoing'),
        duty_text: items.length === 0 ? 'No pickups today' : `${done} of ${items.length} pickups done`,
        first_name: r.first_name, last_name: r.last_name,
      };
    });
    return this._fleet;
  }

  trucks() {
    const fleet = this.fleet();
    const byTruck = {};
    for (const c of fleet) if (c.truck_id !== null) (byTruck[c.truck_id] ??= []).push(c);
    return (this.d.trucks ?? []).map((t) => {
      const crew = byTruck[t.truck_id] ?? [];
      let best = null;
      for (const c of crew) if (c.minutes_ago !== null && (best === null || c.minutes_ago < best.minutes_ago)) best = c;
      const todayTotal = crew.reduce((s, c) => s + c.today_total, 0);
      const todayDone = crew.reduce((s, c) => s + c.today_done, 0);
      const state = !crew.length ? 'unassigned' : best && best.gps === 'live' ? 'live' : todayTotal > 0 ? 'scheduled' : 'idle';
      return {
        id: t.truck_id, plate: t.plate_number, capacity: t.max_capacity_kg !== null ? Number(t.max_capacity_kg) : null,
        crew: crew.map((c) => c.name), zones: [...new Set(crew.map((c) => c.zone))], state,
        last_seen: best ? best.ago : 'never', today_total: todayTotal, today_done: todayDone,
      };
    });
  }

  // ---------- resident feedback ----------
  feedback(f = {}) {
    let rows = (this.d.feedback ?? []).map((r) => {
      const created = toManila(r.created_at);
      const zone = this.zoneById(r.route_id ?? r.resident?.route_id ?? null);
      const status = r.status || 'Pending';
      return {
        response: r.response ?? '', responded_at: toManila(r.responded_at), resolved_at: toManila(r.resolved_at), updated_at: toManila(r.updated_at),
        resident_id: r.resident_id ?? null, photo_path: r.photo_path ?? null,
        stars: r.rating ?? null, stars_comment: r.rating_comment ?? '', stars_photo: r.rating_photo ?? null, rated_at: toManila(r.rated_at),
        rating: r.report_type === 'Pickup rating' ? (/^good/i.test(String(r.description ?? '')) ? 'good' : 'poor') : null,
        id: r.feedback_report_id, type: r.report_type || 'Other', description: String(r.description ?? ''),
        status, open: feedbackIsOpen(status), created_at: created,
        lat: r.latitude !== null ? Number(r.latitude) : null, lng: r.longitude !== null ? Number(r.longitude) : null,
        resident: `${r.resident?.first_name ?? ''} ${r.resident?.last_name ?? ''}`.trim() || 'Unknown resident',
        email: r.resident?.email ?? null, contact: r.resident?.contact_number ?? null,
        zone_id: zone?.id ?? null, zone: zone?.name ?? 'No zone on file',
        age_days: r.created_at ? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000) : null,
      };
    });
    // "Good" pickup ratings need no action, so they are not listed as reports (see ratingSummary);
    // "Had a problem" ratings are concerns and are listed. ratings: 'only' lists just the ratings.
    if (f.ratings === 'only') rows = rows.filter((r) => r.rating);
    else if (!f.ratings) rows = rows.filter((r) => r.rating !== 'good');
    if (f.from) rows = rows.filter((r) => r.created_at && r.created_at.slice(0, 10) >= f.from);
    if (f.to) rows = rows.filter((r) => r.created_at && r.created_at.slice(0, 10) <= f.to);
    if (f.status === 'open') rows = rows.filter((r) => r.open);
    else if (f.status === 'closed') rows = rows.filter((r) => !r.open);
    else if (f.status) rows = rows.filter((r) => r.status === f.status);
    if (f.type) rows = rows.filter((r) => r.type === f.type);
    if (f.zone_id) rows = rows.filter((r) => r.zone_id === Number(f.zone_id));
    if (f.limit) rows = rows.slice(0, f.limit);
    return rows;
  }

  /** Residents' "Rate today's pickup" answers in a period: overall, by zone, and the problems they described. */
  ratingSummary(from, to, zoneId = null) {
    const rows = this.feedback({ from, to, ratings: 'only', zone_id: zoneId || undefined });
    const byZone = {};
    for (const r of rows) { const z = (byZone[r.zone] ??= { good: 0, poor: 0 }); z[r.rating]++; }
    const good = rows.filter((r) => r.rating === 'good').length, poor = rows.length - good;
    return {
      good, poor, total: rows.length, pct: rows.length ? Math.round((good / rows.length) * 100) : null,
      by_zone: Object.entries(byZone).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })),
      problems: rows.filter((r) => r.rating === 'poor').map((r) => ({ id: r.id, created_at: r.created_at, zone: r.zone, text: r.description.replace(/^had a problem:?\s*/i, '') })),
    };
  }

  /**
   * Residents' 1-5 star ratings of how the barangay handled their reports (rated after resolving/closing),
   * in a period (by the date rated): average, by month, by report type, and the low ones (1-2 stars).
   */
  satisfactionSummary(from, to, zoneId = null) {
    let rows = this.feedback({ zone_id: zoneId || undefined }).filter((r) => r.stars && r.rated_at);
    if (from) rows = rows.filter((r) => r.rated_at.slice(0, 10) >= from);
    if (to) rows = rows.filter((r) => r.rated_at.slice(0, 10) <= to);
    const group = (key) => {
      const g = {};
      for (const r of rows) { const k = key(r); (g[k] ??= { n: 0, sum: 0 }); g[k].n++; g[k].sum += r.stars; }
      return Object.entries(g).map(([k, v]) => ({ key: k, n: v.n, avg: Math.round((v.sum / v.n) * 10) / 10 }));
    };
    const sum = rows.reduce((a, r) => a + r.stars, 0);
    const dist = [1, 2, 3, 4, 5].map((n) => rows.filter((r) => r.stars === n).length);
    return {
      n: rows.length, avg: rows.length ? Math.round((sum / rows.length) * 10) / 10 : null,
      satisfied_pct: rows.length ? Math.round((rows.filter((r) => r.stars >= 4).length / rows.length) * 100) : null,
      dist,
      by_month: group((r) => r.rated_at.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
      by_type: group((r) => r.type).sort((a, b) => a.avg - b.avg || b.n - a.n),
      low: rows.filter((r) => r.stars <= 2).sort((a, b) => b.rated_at.localeCompare(a.rated_at)),
    };
  }

  feedbackStatuses() {
    const list = ['Pending', 'In Progress', 'Resolved', 'Dismissed'];
    for (const r of this.d.feedback ?? []) if (r.status && !list.includes(r.status)) list.push(r.status);
    return list;
  }

  feedbackSummary(from, to) {
    const rows = this.feedback({ from, to });
    const byType = {}, byStatus = {}, byZone = {}, weeks = {};
    const ages = [];
    let open = 0;
    for (const r of rows) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byZone[r.zone] = (byZone[r.zone] ?? 0) + 1;
      if (r.open) { open++; if (r.age_days !== null) ages.push(r.age_days); }
      if (r.created_at) {
        const d = r.created_at.slice(0, 10), wk = isoWeek(d);
        weeks[wk] ??= { submitted: 0, open: 0, start: mondayOf(d) };
        weeks[wk].submitted++;
        if (r.open) weeks[wk].open++;
      }
    }
    const sortedType = Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1]));
    const sortedWeeks = Object.fromEntries(Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0])));
    const allOpen = (this.d.feedback ?? []).filter((r) => feedbackIsOpen(r.status || 'Pending')).length;
    let median = null;
    if (ages.length) {
      const a = [...ages].sort((x, y) => x - y), n = a.length;
      median = n % 2 ? a[Math.floor(n / 2)] : Math.floor((a[n / 2 - 1] + a[n / 2]) / 2);
    }
    return {
      total: rows.length, open, open_all_time: allOpen, by_type: sortedType, by_status: byStatus, by_zone: byZone,
      weeks: sortedWeeks, oldest_open_days: ages.length ? Math.max(...ages) : null, median_open_days: median,
    };
  }

  // ---------- activity ----------
  activity(limit = 12) {
    const events = [];
    for (const r of this.d.actPickups ?? []) {
      const zone = this.zoneById(r.collection_schedule?.route_id ?? null);
      const who = `${r.garbage_collector?.first_name ?? ''} ${r.garbage_collector?.last_name ?? ''}`.trim();
      events.push({ at: toManila(r.completed_at), kind: 'pickup', title: `${zone?.name || 'Pickup'} collected`,
        meta: [r.collection_schedule?.waste_category?.category_name || '', who].filter(Boolean).join(' · ') });
    }
    for (const r of this.d.actFeedback ?? []) {
      events.push({ at: toManila(r.created_at), kind: 'feedback', title: `New report: ${r.report_type || 'Feedback'}`,
        meta: `${r.resident?.first_name ?? ''} ${r.resident?.last_name ?? ''}`.trim() || 'Resident' });
    }
    for (const r of this.d.actAnnouncements ?? []) {
      events.push({ at: toManila(r.published_timestamp), kind: 'announcement', title: 'Announcement posted', meta: r.title });
    }
    events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return events.slice(0, limit);
  }

  // ---------- fixed schedule (truck stops) ----------
  points(activeOnly = false) {
    const links = {};
    for (const l of this.d.cpz ?? []) (links[l.collection_point_id] ??= []).push(l.route_id);
    let rows = [...(this.d.points ?? [])];
    if (activeOnly) rows = rows.filter((r) => r.is_active);
    // ORDER BY start_time, stop_order, name (MySQL puts empty times first)
    rows.sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')) || a.stop_order - b.stop_order || a.name.localeCompare(b.name));
    return rows.map((r) => {
      const served = (links[r.collection_point_id] ?? []).map((id) => this.zoneById(id)).filter(Boolean)
        .sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
      const loc = this.zoneById(r.route_id);
      return {
        id: r.collection_point_id, name: r.name, landmark: String(r.landmark ?? ''),
        zone_id: loc?.id ?? null, zone: loc?.name ?? '',
        lat: r.latitude !== null ? Number(r.latitude) : null, lng: r.longitude !== null ? Number(r.longitude) : null,
        source: String(r.location_source ?? ''), confirmed: Boolean(r.location_confirmed),
        maps_url: cleanMapsUrl(r.maps_url), raw_maps_url: r.maps_url ?? '',
        days: daysList(r.collection_days), start: sub8(r.start_time), end: sub8(r.end_time),
        window: fmtWindow(r.start_time, r.end_time),
        standby: r.standby_minutes ?? null, order: r.stop_order, active: Boolean(r.is_active),
        served_ids: served.map((z) => z.id), served: served.map((z) => z.name),
        color: loc?.color ?? served[0]?.color ?? '#475569',
      };
    });
  }

  /** Times when the single truck would need to be in two places at once. */
  conflicts(points) {
    const out = [];
    for (const day of DAYS) {
      const today = points.filter((p) => p.active && p.days.includes(day) && p.start && p.end);
      for (let i = 0; i < today.length; i++) {
        for (let j = i + 1; j < today.length; j++) {
          const a = today[i], b = today[j];
          if (a.start < b.end && b.start < a.end) out.push({ day, a, b });
        }
      }
    }
    return out;
  }

  /** Collector currently assigned to the fixed schedule (null if none or mixed). */
  crew() {
    const ids = [...new Set((this.d.schedules ?? []).filter((s) => s.schedule_type === 'fixed' && s.schedule_status === 'Active')
      .map((s) => s.garbage_collector_id ?? null))];
    return { collector_id: ids.length === 1 ? ids[0] : null, mixed: ids.length > 1 };
  }

  /** The week laid out by day: stops in time order. */
  week(points) {
    const week = {};
    for (const day of DAYS) {
      week[day] = points.filter((p) => p.active && p.days.includes(day))
        .sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.order - b.order);
    }
    return week;
  }

  // ---------- emergency collections ----------
  emList(f = {}) {
    let rows = [...(this.d.emergency ?? [])];
    if (f.from) rows = rows.filter((r) => r.collection_date >= f.from);
    if (f.to) rows = rows.filter((r) => r.collection_date <= f.to);
    if (f.status === 'open') rows = rows.filter((r) => ['Scheduled', 'In progress'].includes(r.status));
    else if (f.status) rows = rows.filter((r) => r.status === f.status);
    if (f.zone_id) rows = rows.filter((r) => r.route_id === Number(f.zone_id));
    if (f.id) rows = rows.filter((r) => r.emergency_collection_id === Number(f.id));
    const asc = f.order === 'asc';
    rows.sort((a, b) => (asc ? a.collection_date.localeCompare(b.collection_date) : b.collection_date.localeCompare(a.collection_date))
      || String(a.start_time).localeCompare(String(b.start_time)));
    if (f.limit) rows = rows.slice(0, f.limit);
    const clock = this.clock;
    return rows.map((r) => {
      const zone = this.zoneById(r.route_id);
      const overdue = ['Scheduled', 'In progress'].includes(r.status)
        && (r.collection_date < clock.date || (r.collection_date === clock.date && r.end_time && sub8(r.end_time) < clock.time));
      return {
        id: r.emergency_collection_id, date: r.collection_date, start: sub8(r.start_time), end: sub8(r.end_time),
        window: r.end_time ? fmtWindow(r.start_time, r.end_time) : `From ${fmtTime(r.start_time)}`,
        zone_id: zone?.id ?? null, zone: zone?.name ?? 'No zone', color: zone?.color ?? '#c2412d',
        location: r.location_text, lat: r.latitude !== null ? Number(r.latitude) : null, lng: r.longitude !== null ? Number(r.longitude) : null,
        reason: r.reason, collector_id: r.garbage_collector_id ?? null,
        collector: `${r.garbage_collector?.first_name ?? ''} ${r.garbage_collector?.last_name ?? ''}`.trim() || 'Not assigned',
        truck_id: r.truck_id ?? null, truck: r.truck?.plate_number ?? null,
        status: r.status, overdue: Boolean(overdue), notes: String(r.notes ?? ''),
        created_by: `${r.barangay_admin?.firstname ?? ''} ${r.barangay_admin?.lastname ?? ''}`.trim() || 'Barangay Admin',
        created_at: toManila(r.created_at), completed_at: toManila(r.completed_at),
      };
    });
  }

  emSummary(from, to) {
    const rows = this.emList({ from, to });
    const c = { total: rows.length, Scheduled: 0, 'In progress': 0, Completed: 0, Cancelled: 0, overdue: 0, by_zone: {} };
    for (const r of rows) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (r.overdue) c.overdue++;
      c.by_zone[r.zone] = (c.by_zone[r.zone] ?? 0) + 1;
    }
    return c;
  }

  // ---------- map ----------
  mapPayload(date = null) {
    const d = validDate(date) ?? this.clock.date;
    const items = this.dayItems(d);
    const zoneState = {};
    for (const it of items) {
      if (it.zone_id === null) continue;
      (zoneState[it.zone_id] ??= []).push({ id: it.id, state: it.state, late: it.late, window: it.window, category: it.category, collector: it.collector, truck: it.truck, missed: it.missed });
    }
    const fleet = this.fleet();
    const zones = this._zones.map((z) => {
      const list = zoneState[z.id] ?? [];
      const states = list.map((x) => x.state);
      const status = ['delayed', 'ongoing', 'pending', 'upcoming', 'completed', 'untracked'].find((s) => states.includes(s)) ?? 'none';
      return {
        id: z.id, name: z.name, number: z.number, color: z.color, days: z.days, window: z.window, admin: z.admin,
        path: z.path, boundary: z.boundary, boundary_source: z.boundary_source, mode: z.mode,
        status, items: list, collectors: fleet.filter((c) => c.zone_id === z.id).map((c) => c.name),
      };
    });
    const day = weekday(d);
    return {
      date: d, today: this.clock.date, server_time: this.clock.now, zones,
      vehicles: fleet.filter((c) => c.lat !== null).map(({ id, name, zone, zone_id, color, truck, lat, lng, heading, ago, gps, minutes_ago, duty_text, ping_at }) =>
        ({ id, name, zone, zone_id, color, truck, lat, lng, heading, ago, gps, minutes_ago, duty_text, ping_at })),
      feedback: this.feedback({ status: 'open', limit: 300 }).filter((f) => f.lat !== null)
        .map(({ id, type, status, lat, lng, created_at, zone, description }) => ({ id, type, status, lat, lng, created_at, zone, description })),
      points: this.points(true).map((p) => ({ ...p, today: p.days.includes(day) })),
      emergencies: this.emList({ from: d, to: d, order: 'asc' }),
      day,
    };
  }
}

/** Loads only what the live map needs for a date. */
export async function loadMap(date = null) {
  const clock = await loadClock();
  const d = validDate(date) ?? clock.date;
  // Today's pickups are always needed too (collector progress on the map).
  const [from, to] = d < clock.date ? [d, clock.date] : [clock.date, d];
  const ops = await loadOps({ logsFrom: from, logsTo: to, feedback: true, emergency: true });
  return ops.mapPayload(d);
}

export { fmtTime, fmtWindow, fmtDate };

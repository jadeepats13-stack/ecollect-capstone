/**
 * Data for the two dashboards (port of includes/dashboard_data.php).
 * The same function feeds the first render and every live refresh.
 */
import { loadOps, rangeFrom } from './ops';
import { supabase, must } from './supabase';
import { addDays, daysBetween, fmtDate, fmtTime, toManila } from './time';
import { loadClock } from './ops';

const itemView = (it) => ({
  id: it.id, date: it.date, zone: it.zone, zone_id: it.zone_id, zone_no: it.zone_no, color: it.color,
  category: it.category, collector: it.collector, truck: it.truck, start: it.start, end: it.end,
  window: it.window, state: it.state, late: it.late, completed_at: it.completed_at, missed: it.missed ?? null,
});
const missedText = (m) => `Couldn't collect at ${m.stop}: ${m.reason}${m.note ? ` (${m.note})` : ''}`;

function series(period, bucket = 'dates') {
  const out = { labels: [], completed: [], delayed: [], late: [], rate: [] };
  for (const [key, c] of Object.entries(period[bucket])) {
    out.labels.push(bucket === 'dates' ? fmtDate(key, 'M j') : `Wk of ${fmtDate(c.start, 'M j')}`);
    out.completed.push(c.completed); out.delayed.push(c.delayed); out.late.push(c.late); out.rate.push(c.rate);
  }
  return out;
}

const zoneSeries = (period) => Object.entries(period.zones).map(([id, z]) => ({
  id: Number(id), name: z.name, color: z.color, completed: z.completed, delayed: z.delayed, late: z.late, expected: z.expected, rate: z.rate,
}));
// Keep zone order (Zone 1 … 10), as PHP keeps insertion order.
const zoneSeriesOrdered = (ops, period) => ops.zones().map((z) => zoneSeries({ zones: { [z.id]: period.zones[z.id] } })[0]);

/** Barangay Admin: today's operations plus a short look back. */
/** Problems the truck crew reported from the collector app: unresolved first, then the latest resolved. */
export async function loadFieldReports(limit = 8) {
  const rows = must(await supabase.from('field_report')
    .select('field_report_id, report_type, description, status, created_at, resolved_at, garbage_collector(first_name, last_name), collection_point(name), route(zone_name)')
    .order('created_at', { ascending: false }).limit(40));
  const list = rows.map((r) => ({
    id: r.field_report_id, type: r.report_type, description: r.description ?? '', status: r.status,
    at: toManila(r.created_at), open: r.status !== 'Resolved',
    collector: `${r.garbage_collector?.first_name ?? ''} ${r.garbage_collector?.last_name ?? ''}`.trim() || 'Collector',
    place: r.collection_point?.name || r.route?.zone_name || '',
  }));
  return { open: list.filter((r) => r.open).length, items: [...list.filter((r) => r.open), ...list.filter((r) => !r.open)].slice(0, limit) };
}

export async function barangayDashboard(range = '14') {
  const clock = await loadClock();
  const [from, to, label, key] = rangeFrom(['7', '14', '30'].includes(String(range)) ? range : '14', clock.date);
  const [ops, field] = await Promise.all([
    loadOps({ logsFrom: from < clock.date ? from : clock.date, logsTo: clock.date, feedback: true, emergency: true, activity: true }),
    loadFieldReports(),
  ]);
  const today = ops.dayItems(ops.clock.date);
  const counts = { pending: 0, ongoing: 0, completed: 0, delayed: 0 };
  for (const it of today) if (counts[it.state] !== undefined) counts[it.state]++;
  const period = ops.period(from, to);
  const fleet = ops.fleet();
  const fb = ops.feedbackSummary(from, to);
  const openFeedback = ops.feedback({ status: 'open', limit: 6 });

  const attention = [];
  for (const it of today) {
    if (it.state === 'delayed') attention.push({ ...itemView(it), reason: it.missed ? missedText(it.missed) : `Window ended ${fmtTime(it.end)} with no pickup logged` });
  }
  for (const it of period.delayed_items) {
    if (it.date === ops.clock.date) continue;
    if (attention.length >= 8) break;
    attention.push({ ...itemView(it), reason: `${it.missed ? missedText(it.missed) : 'Missed'} on ${fmtDate(it.date, 'D, M j')}` });
  }
  const gps = { live: 0, recent: 0, stale: 0, none: 0 };
  for (const c of fleet) gps[c.gps]++;

  return {
    generated_at: ops.clock.now,
    today: { date: ops.clock.date, day: ops.clock.day, time: ops.clock.time, counts, total: today.length, items: today.map(itemView) },
    range: { key, label, from, to, effective_from: period.effective_from, tracking_start: period.tracking_start },
    period: period.totals,
    trend: series(period, 'dates'),
    zones: zoneSeriesOrdered(ops, period),
    categories: period.categories,
    attention,
    upcoming: ops.upcoming(7, 10).map(itemView),
    fleet: fleet.map(({ id, name, zone, color, truck, gps: g, ago, duty_text, today_total, today_done, on_duty }) =>
      ({ id, name, zone, color, truck, gps: g, ago, duty_text, today_total, today_done, on_duty })),
    gps,
    trucks: ops.trucks(),
    feedback: { summary: fb, open: openFeedback },
    activity: ops.activity(10),
    zone_check: ops.zoneIntegrity(),
    emergency: { open: ops.emList({ status: 'open', order: 'asc', limit: 6 }), summary: ops.emSummary(from, to) },
    field,
    stops_today: ops.points(true).filter((p) => p.days.includes(ops.clock.day)),
    ops,
  };
}

/** LGU Admin: performance over a period, compared with the period before it. */
export async function lguDashboard(range = '30') {
  const clock = await loadClock();
  const [from, to, label, key] = rangeFrom(['7', '30', '90', 'month'].includes(String(range)) ? range : '30', clock.date);
  const days = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const stripFrom = addDays(clock.date, -13);
  const logsFrom = [prevFrom, stripFrom].sort()[0];
  const [ops, field] = await Promise.all([
    loadOps({ logsFrom, logsTo: clock.date, feedback: true, emergency: true, activity: true }),
    loadFieldReports(6),
  ]);

  const period = ops.period(from, to);
  const prev = ops.period(prevFrom, prevTo);
  const strip = ops.period(stripFrom, ops.clock.date);
  const stripDays = [];
  for (let d = stripFrom; d <= ops.clock.date; d = addDays(d, 1)) stripDays.push(d);
  const matrix = {};
  for (const z of ops.zones()) {
    const row = { id: z.id, name: z.name, color: z.color, cells: {}, rate: strip.zones[z.id]?.rate ?? null };
    for (const d of stripDays) row.cells[d] = { expected: 0, completed: 0, delayed: 0, open: 0 };
    matrix[z.id] = row;
  }
  for (const d of stripDays) {
    if (d < strip.tracking_start) continue;
    for (const it of ops.dayItems(d)) {
      if (it.zone_id === null || !matrix[it.zone_id]) continue;
      const c = matrix[it.zone_id].cells[d];
      c.expected++;
      if (it.state === 'completed') c.completed++;
      else if (it.state === 'delayed') c.delayed++;
      else c.open++;
    }
  }

  const fleet = ops.fleet();
  const trucks = ops.trucks();
  const truckStates = { live: 0, scheduled: 0, idle: 0, unassigned: 0 };
  for (const t of trucks) truckStates[t.state]++;
  const gps = { live: 0, recent: 0, stale: 0, none: 0 };
  for (const c of fleet) gps[c.gps]++;
  const todayItems = ops.dayItems(ops.clock.date);
  const todayCounts = { pending: 0, ongoing: 0, completed: 0, delayed: 0 };
  for (const it of todayItems) if (todayCounts[it.state] !== undefined) todayCounts[it.state]++;
  const fb = ops.feedbackSummary(from, to);
  const oldestOpen = ops.feedback({ status: 'open' }).sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));

  return {
    generated_at: ops.clock.now,
    today: { date: ops.clock.date, counts: todayCounts, total: todayItems.length },
    range: { key, label, from, to, days, effective_from: period.effective_from, tracking_start: period.tracking_start, prev_from: prevFrom, prev_to: prevTo },
    totals: period.totals,
    prev: { ...prev.totals, has_data: prev.effective_from <= prev.effective_to },
    trend_daily: series(period, 'dates'),
    trend_weekly: series(period, 'weeks'),
    zones: zoneSeriesOrdered(ops, period),
    strip: { days: stripDays, rows: ops.zones().map((z) => matrix[z.id]), tracking_start: strip.tracking_start },
    delayed: period.delayed_items.slice(0, 15).map(itemView),
    delayed_total: period.delayed_items.length,
    fleet: { collectors: fleet.length, gps, trucks: trucks.length, truck_states: truckStates, on_duty: fleet.filter((c) => c.today_total > 0).length },
    feedback: { summary: fb, oldest_open: oldestOpen.slice(0, 6) },
    activity: ops.activity(8),
    zone_check: ops.zoneIntegrity(),
    emergency: { recent: ops.emList({ from, to: addDays(ops.clock.date, 30), limit: 8 }), summary: ops.emSummary(from, to) },
    field,
    ops,
  };
}

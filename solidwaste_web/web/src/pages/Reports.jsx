// Reports (port of reports.php + includes/report_view.php), generated live from the database.
//   Barangay Admin: operations report (what was collected, by zone, by whom).
//   LGU Admin: performance report (rates, comparison with the previous period, missed pickups by collector).
// Same period rules and formulas as the dashboards (lib/ops.js). CSV download, print, and a report log.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, Messages, PageHead, useLoad } from '../components/common';
import { usePanel } from '../components/Layout';
import { loadClock, loadOps, rangeFrom, rate, stateLabel } from '../lib/ops';
import { supabase, must, explain } from '../lib/supabase';
import { addDays, daysBetween, fmtDate, fmtStamp, fmtTime, mondayOf, nowManila, toManila } from '../lib/time';
import { confirmDialog, downloadCsv } from '../lib/ui';
import { SITE_NAME } from '../config';

const STATE_CSS = { completed: 'done', ongoing: 'ongoing', pending: 'pending', delayed: 'delayed', upcoming: 'pending', untracked: '' };
const STATUS_FILTERS = [['', 'All'], ['completed', 'Completed'], ['late', 'Completed late'], ['delayed', 'Delayed / missed'], ['open', 'Not due yet (today)']];
const QUICK = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['90', '90 days']];
const emCss = (status, overdue) => (overdue ? 'delayed' : ({ Scheduled: 'pending', 'In progress': 'ongoing', Completed: 'done', Cancelled: '' }[status] ?? ''));
const rateText = (r) => (r === null || r === undefined ? 'n/a' : `${Number(r.toFixed(1))}%`);
const barColor = (r) => ((r ?? 100) < 70 ? 'var(--st-delayed)' : (r ?? 100) < 90 ? 'var(--st-pending)' : undefined);

function matches(it, status) {
  switch (status) {
    case 'completed': return it.state === 'completed';
    case 'delayed': return it.state === 'delayed';
    case 'late': return it.late;
    case 'open': return it.state === 'pending' || it.state === 'ongoing';
    default: return true;
  }
}

async function loadReport({ key, from, to, zone, status, role }) {
  const clock = await loadClock();
  const [rFrom, rTo, label, rKey] = rangeFrom(key || '30', clock.date, { from, to });
  const days = daysBetween(rFrom, rTo) + 1;
  const prevTo = addDays(rFrom, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const [ops, shifts, log] = await Promise.all([
    loadOps({ logsFrom: role === 'lgu' ? prevFrom : rFrom, logsTo: rTo, fleet: false, feedback: true, emergency: true }),
    supabase.rpc('admin_shifts', { p_from: rFrom, p_to: rTo }),
    supabase.from('reports').select('*, lgu_admin:lgu_admin_id(first_name, last_name), barangay_admin(firstname, lastname)').eq('submitted', false)
      .order('generated_timestamp', { ascending: false }).order('report_id', { ascending: false }).limit(50),
  ]);
  const zoneId = zone ? Number(zone) : null;
  const period = ops.period(rFrom, rTo, zoneId);
  const all = ops.itemsRange(rFrom, rTo, zoneId);
  const items = all.filter((it) => matches(it, status));
  const byCollector = {};
  for (const it of all) {
    if (it.state !== 'completed' && it.state !== 'delayed') continue;
    const c = (byCollector[it.collector] ??= { completed: 0, delayed: 0, late: 0, truck: it.truck });
    c[it.state]++;
    if (it.late) c.late++;
  }
  return {
    ops, today: clock.date, from: rFrom, to: rTo, label, key: rKey, zoneId, status,
    period, items, prevFrom, prevTo,
    prev: role === 'lgu' ? ops.period(prevFrom, prevTo, zoneId) : null,
    collectors: Object.entries(byCollector).sort((a, b) => b[1].delayed - a[1].delayed),
    fb: ops.feedbackSummary(rFrom, rTo),
    ratings: ops.ratingSummary(rFrom, rTo, zoneId),
    sat: ops.satisfactionSummary(rFrom, rTo, zoneId),
    ems: ops.emList({ from: rFrom, to: rTo, zone_id: zoneId, order: 'asc' }),
    es: ops.emSummary(rFrom, rTo),
    stops: stopSummary(ops, rFrom, rTo, zoneId),
    shifts: must(shifts),
    log: must(log),
  };
}

/** Truck stops in the period: done, couldn't collect (with reasons), and the truck load the collector estimated. */
function stopSummary(ops, from, to, zoneId) {
  const points = ops.points(false).filter((p) => zoneId === null || p.served_ids.includes(zoneId));
  const byId = new Map(points.map((p) => [p.id, { name: p.name, window: p.window, served: p.served, done: 0, missed: 0, reasons: {}, loads: [] }]));
  for (const v of ops.d.visits ?? []) {
    if (v.visit_date < from || v.visit_date > to) continue;
    const row = byId.get(v.collection_point_id);
    if (!row) continue;
    if (v.outcome === 'missed') { row.missed++; const k = v.missed_reason || 'Other'; row.reasons[k] = (row.reasons[k] ?? 0) + 1; }
    else { row.done++; if (v.load_level) row.loads.push(v.load_level); }
  }
  return [...byId.values()].filter((r) => r.done || r.missed);
}
const loadText = (loads) => {
  if (!loads.length) return '–';
  const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
  return `about ${Math.round(avg * 25)}% full`;
};
const clockOf = (ts) => fmtTime(String(toManila(ts) ?? '').slice(11, 19));
const hoursText = (h) => { const m = Math.round(Number(h) * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const SHIFT_NOTE = { open: 'On shift now', not_ended: 'Not ended in the app; counted to the last GPS reading', ended: '' };

/** The figures saved with a report submitted to the LGU (kept exactly as sent). */
export function reportSummary(r, zrows, zoneName) {
  const t = r.period.totals;
  const hours = r.shifts.reduce((a, x) => a + Number(x.hours), 0);
  return {
    label: r.label, zone: zoneName || 'All zones',
    completion: { rate: t.rate === null || t.rate === undefined ? null : Number(t.rate.toFixed(1)), due: t.completed + t.delayed, completed: t.completed, late: t.late, missed: t.delayed },
    by_zone: zrows.filter((z) => z.completed + z.delayed > 0).map((z) => ({ zone: z.name, due: z.completed + z.delayed, completed: z.completed, late: z.late, missed: z.delayed,
      rate: z.rate === null || z.rate === undefined ? null : Number(z.rate.toFixed(1)) })),
    emergencies: { total: r.es.total, completed: r.es.Completed ?? 0, cancelled: r.es.Cancelled ?? 0, open: (r.es.Scheduled ?? 0) + (r.es['In progress'] ?? 0), overdue: r.es.overdue },
    resident_reports: { submitted: r.fb.total, unresolved: r.fb.open, by_type: r.fb.by_type },
    pickup_ratings: { good: r.ratings.good, had_a_problem: r.ratings.poor, good_pct: r.ratings.pct },
    handling_ratings: { count: r.sat.n, average: r.sat.avg, satisfied_pct: r.sat.satisfied_pct },
    truck_hours: { shifts: r.shifts.length, hours: Math.round(hours * 10) / 10 },
  };
}

/** Barangay Admin: send the report shown on screen to the LGU, with a title and remarks. */
function SubmitForm({ r, zrows, zoneName, me, onCancel, onSent }) {
  const [title, setTitle] = useState(`Operations report: ${r.label}${zoneName ? `, ${zoneName}` : ''}`.slice(0, 100));
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Give the report a title.'); return; }
    setBusy(true); setErr('');
    const { data, error: er } = await supabase.from('reports').insert({
      barangay_admin_id: me.id, submitted: true, report_type: title.trim().slice(0, 100), remarks: remarks.trim() || null,
      period_from: r.from, period_to: r.to, zone_id: r.zoneId || null, summary: reportSummary(r, zrows, zoneName),
    }).select('report_id').single();
    setBusy(false);
    if (er) { setErr(explain(er)); return; }
    onSent(data.report_id);
  };
  return (
    <section className="panel mb no-print" aria-labelledby="submitTitle">
      <div className="panel-head"><h2 id="submitTitle">Submit this report to the LGU</h2>
        <p>The LGU Admin gets the figures for <strong>{r.label}{zoneName ? `, ${zoneName}` : ''}</strong> exactly as shown now, with your remarks, and can mark it reviewed or return it with comments.</p></div>
      <form className="panel-body form-grid" onSubmit={send}>
        <div className="field wide"><label htmlFor="subTitle">Title</label>
          <input className="input" id="subTitle" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div className="field wide"><label htmlFor="subRemarks">Remarks for the LGU <span className="muted">(optional)</span></label>
          <textarea className="textarea" id="subRemarks" rows={4} maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder="For example: the truck broke down on Oct 16, so Zones 1 and 2 were not collected; it was repaired the next day." /></div>
        {err ? <div className="field wide"><div className="alert alert-error" role="alert">{err}</div></div> : null}
        <div className="field wide btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="send" />{busy ? 'Sending…' : 'Submit to the LGU'}</button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

function Filters({ r, onApply }) {
  const [f, setF] = useState({ from: r.from, to: r.to, zone: r.zoneId ?? 0, status: r.status });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form className="filters panel-body" onSubmit={(e) => { e.preventDefault(); onApply({ range: null, from: f.from, to: f.to, zone: Number(f.zone) || null, status: f.status || null }); }}>
      <div className="field"><label htmlFor="rFrom">From</label><input className="input" type="date" id="rFrom" value={f.from} max={r.today} onChange={set('from')} /></div>
      <div className="field"><label htmlFor="rTo">To</label><input className="input" type="date" id="rTo" value={f.to} max={r.today} onChange={set('to')} /></div>
      <div className="field"><label htmlFor="rZone">Zone</label>
        <select className="select" id="rZone" value={f.zone} onChange={set('zone')}><option value={0}>All zones</option>
          {r.ops.zones().map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></div>
      <div className="field"><label htmlFor="rStatus">Collections</label>
        <select className="select" id="rStatus" value={f.status} onChange={set('status')}>
          {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <button className="btn btn-primary" type="submit">Update report</button>
      <div className="seg" aria-label="Quick periods">
        {QUICK.map(([k, l]) => (
          <button key={k} type="button" aria-current={r.key === k ? 'true' : undefined}
            onClick={() => onApply({ range: k, from: null, to: null, zone: r.zoneId, status: r.status || null })}>{l}</button>
        ))}
      </div>
    </form>
  );
}

export default function Reports() {
  const { role, me } = usePanel();
  const isLgu = role === 'lgu';
  const [params, setParams] = useSearchParams();
  const q = { key: params.get('range') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '', zone: params.get('zone') ?? '', status: params.get('status') ?? '' };
  if (!['', 'completed', 'delayed', 'late', 'open'].includes(q.status)) q.status = '';
  const { data: r, error, loading, reload } = useLoad(() => loadReport({ ...q, role }), [params.toString(), role]);
  const [msg, setMsg] = useState({ success: '', errors: [] });
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const apply = (v) => {
    const n = new URLSearchParams();
    Object.entries(v).forEach(([k, val]) => { if (val !== null && val !== undefined && val !== '') n.set(k, val); });
    setParams(n);
  };
  const zoneName = r?.zoneId ? r.ops.zoneById(r.zoneId)?.name ?? '' : '';

  const csv = () => {
    const rows = [['Date', 'Day', 'Zone', 'Waste category', 'Window start', 'Window end', 'Collector', 'Truck', 'Status', 'Completed late', 'Logged at', 'Collector note']];
    for (const it of r.items) {
      rows.push([it.date, it.day, it.zone, it.category, it.start ?? '', it.end ?? '', it.collector, it.truck ?? '',
        stateLabel(it), it.late ? 'Yes' : 'No', it.completed_at && it.completed_at.length > 10 ? it.completed_at : '', it.missed?.note ?? '']);
    }
    downloadCsv(`ecollect-${isLgu ? 'performance' : 'operations'}-${r.from}-to-${r.to}.csv`, rows);
  };

  const saveLog = async () => {
    const title = (isLgu
      ? `Performance report: ${r.label}${zoneName ? `, ${zoneName}` : ', all zones'}`
      : `Operations report (${me?.name || 'Barangay Admin'}): ${r.label}${zoneName ? `, ${zoneName}` : ''}`).slice(0, 100);
    const row = isLgu ? { lgu_admin_id: me.id, report_type: title } : { barangay_admin_id: me.id, report_type: title };
    const { error: err } = await supabase.from('reports').insert(row);
    setMsg(err ? { success: '', errors: [explain(err)] } : { success: 'Saved to the report log.', errors: [] });
    if (!err) reload();
  };

  const removeLog = async (row) => {
    if (!(await confirmDialog({ title: 'Remove this log entry?', message: 'Only the log entry is removed; no collection data changes.', action: 'Remove' }))) return;
    const { error: err } = await supabase.from('reports').delete().eq('report_id', row.report_id);
    setMsg(err ? { success: '', errors: [explain(err)] } : { success: 'Log entry removed.', errors: [] });
    reload();
  };

  const t = r?.period.totals;
  // Zone 1-10 order (the object is keyed by route_id, which is not the zone number).
  const zrows = r ? Object.values(r.period.zones).sort((a, b) => (a.number ?? 99) - (b.number ?? 99)) : [];
  if (r && isLgu) zrows.sort((a, b) => ((b.rate ?? -1) - (a.rate ?? -1)) || ((a.number ?? 99) - (b.number ?? 99)));

  return (
    <>
      <PageHead title={isLgu ? 'Performance report' : 'Operations report'} topTitle={isLgu ? 'Performance reports' : 'Reports'}
        desc={isLgu
          ? 'Completion rates, missed collections and resident concerns across the 10 zones, compared with the previous period.'
          : 'What was collected, where and by whom, for any period. Built from the pickups collectors log in the mobile app.'} />
      <Messages success={msg.success} errors={msg.errors} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !r && <Loading label="Building the report…" />}
      {r && (
        <>
          <section className="panel mb no-print">
            <Filters key={params.toString()} r={r} onApply={apply} />
            <div className="panel-foot btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Period: <strong>{r.label}</strong>{r.period.effective_from > r.from ? ` · counted from ${fmtDate(r.period.effective_from, 'M j, Y')}, when pickup tracking started` : ''}</span>
              <span className="btn-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={csv}><Icon name="download" />Download CSV</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}><Icon name="print" />Print</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={saveLog}><Icon name="report" />Save to report log</button>
                {!isLgu ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setSubmitting(true)}><Icon name="send" />Submit to LGU</button> : null}
              </span>
            </div>
          </section>

          {submitting && !isLgu ? (
            <SubmitForm r={r} zrows={zrows} zoneName={zoneName} me={me} onCancel={() => setSubmitting(false)}
              onSent={(id) => navigate(`/barangay/submitted?sent=${id}`)} />
          ) : null}

          <div className="print-only" style={{ marginBottom: 12 }}>
            <h1>{SITE_NAME} — {isLgu ? 'Collection performance report' : 'Collection operations report'}</h1>
            <p>Barangay Poblacion, Iligan City · {r.label}{zoneName ? ` · ${zoneName}` : ''} · generated {fmtStamp(nowManila(), true)}</p>
          </div>

          <div className="status-strip mb">
            <div className="status-cell cell-brand"><span className="lbl">Completion rate</span><span className="num">{rateText(t.rate)}</span><span className="sub">{t.completed} of {t.completed + t.delayed} due pickups</span></div>
            <div className="status-cell cell-done"><span className="lbl">Completed</span><span className="num">{t.completed}</span><span className="sub">{t.late} after the window</span></div>
            <div className="status-cell cell-delayed"><span className="lbl">Missed</span><span className="num">{t.delayed}</span><span className="sub">Window ended, no pickup logged</span></div>
            <div className="status-cell cell-pending"><span className="lbl">Not due yet</span><span className="num">{t.ongoing + t.pending}</span><span className="sub">Later today; not in the rate</span></div>
            <div className="status-cell cell-idle"><span className="lbl">Resident reports</span><span className="num">{r.fb.total}</span><span className="sub">{r.fb.open} still unresolved</span></div>
          </div>

          {r.prev && (
            <div className="callout info mb"><div>
              <strong>Compared with {fmtDate(r.prevFrom)}–{fmtDate(r.prevTo, 'M j, Y')}:</strong>{' '}
              {r.prev.totals.rate === null || t.rate === null
                ? 'not enough tracked pickups in one of the periods to compare.'
                : (() => {
                  const diff = Math.round((t.rate - r.prev.totals.rate) * 10) / 10;
                  return `completion rate ${diff === 0 ? 'unchanged' : `${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)} points`} (${rateText(r.prev.totals.rate)} → ${rateText(t.rate)}), missed pickups ${r.prev.totals.delayed} → ${t.delayed}.`;
                })()}
            </div></div>
          )}

          <div className="grid grid-2 mb">
            <section className="panel">
              <div className="panel-head"><h2>{isLgu ? 'Zones ranked by completion rate' : 'By zone'}</h2></div>
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                <thead><tr><th>Zone</th><th className="num">Due</th><th className="num">Done</th><th className="num">Late</th><th className="num">Missed</th><th>Rate</th></tr></thead>
                <tbody>
                  {zrows.filter((z) => !(r.zoneId && z.expected === 0)).map((z) => (
                    <tr key={z.name}>
                      <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: z.color }}>●</span> {z.name}</td>
                      <td className="num">{z.completed + z.delayed}</td><td className="num">{z.completed}</td><td className="num">{z.late}</td><td className="num">{z.delayed}</td>
                      <td><div className="bar-cell"><div className="bar"><i style={{ width: `${z.rate ?? 0}%`, background: barColor(z.rate) }} /></div><span>{rateText(z.rate)}</span></div></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>{isLgu ? 'Missed pickups by collector' : 'By collector'}</h2></div>
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                <thead><tr><th>Collector</th><th>Truck</th><th className="num">Done</th><th className="num">Late</th><th className="num">Missed</th><th>Rate</th></tr></thead>
                <tbody>
                  {!r.collectors.length && <tr><td colSpan={6}><Empty title="Nothing was due" text="No pickups were due in this period." /></td></tr>}
                  {r.collectors.map(([name, c]) => (
                    <tr key={name}><td>{name}</td><td>{c.truck ?? '–'}</td><td className="num">{c.completed}</td><td className="num">{c.late}</td><td className="num">{c.delayed}</td><td>{rateText(rate(c.completed, c.delayed))}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </section>
            {isLgu ? (
              <section className="panel">
                <div className="panel-head"><h2>By week</h2></div>
                <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                  <thead><tr><th>Week starting</th><th className="num">Done</th><th className="num">Late</th><th className="num">Missed</th><th>Rate</th></tr></thead>
                  <tbody>
                    {!Object.keys(r.period.weeks).length && <tr><td colSpan={5}><Empty title="No tracked days" text="This period is before pickup tracking started." /></td></tr>}
                    {Object.entries(r.period.weeks).map(([k, w]) => (
                      <tr key={k}><td>{fmtDate(mondayOf(w.start), 'M j, Y')}</td><td className="num">{w.completed}</td><td className="num">{w.late}</td><td className="num">{w.delayed}</td><td>{rateText(w.rate)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              </section>
            ) : (
              <section className="panel">
                <div className="panel-head"><h2>By waste category</h2></div>
                <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                  <thead><tr><th>Category</th><th className="num">Done</th><th className="num">Missed</th><th>Rate</th></tr></thead>
                  <tbody>
                    {!Object.keys(r.period.categories).length && <tr><td colSpan={4}><Empty title="Nothing scheduled" text="No pickups in this period." /></td></tr>}
                    {Object.entries(r.period.categories).map(([name, c]) => (
                      <tr key={name}><td>{name}</td><td className="num">{c.completed}</td><td className="num">{c.delayed}</td><td>{rateText(c.rate)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              </section>
            )}
            <section className="panel">
              <div className="panel-head"><h2>Resident reports</h2></div>
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                <thead><tr><th>Type</th><th className="num">Submitted</th></tr></thead>
                <tbody>
                  {!Object.keys(r.fb.by_type).length && <tr><td colSpan={2}><Empty icon="message" title="No reports" text="Residents sent no reports in this period." /></td></tr>}
                  {Object.entries(r.fb.by_type).map(([type, n]) => <tr key={type}><td>{type}</td><td className="num">{n}</td></tr>)}
                </tbody>
              </table></div>
              <div className="panel-foot">By status: {Object.keys(r.fb.by_status).length ? Object.entries(r.fb.by_status).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}.
                {r.fb.median_open_days !== null ? ` Unresolved reports from this period have been open ${r.fb.median_open_days} days (median).` : ''}</div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>How residents rated report handling</h2>
                <p>1–5 stars a resident gives after the barangay resolves or closes their report (by the date rated){r.zoneId ? ` · ${zoneName}` : ''}.
                  {r.sat.n ? ` Average ${r.sat.avg} ★ from ${r.sat.n} rating${r.sat.n === 1 ? '' : 's'}; ${r.sat.satisfied_pct}% gave 4–5 stars.` : ''}</p></div>
              {!r.sat.n ? <Empty icon="message" title="No ratings" text="Residents rated no resolved reports in this period." /> : (
                <>
                  <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                    <thead><tr><th>Month</th><th className="num">Ratings</th><th className="num">Average</th></tr></thead>
                    <tbody>{r.sat.by_month.map((m) => <tr key={m.key}><td>{m.key}</td><td className="num">{m.n}</td><td className="num">{m.avg} ★</td></tr>)}</tbody>
                  </table></div>
                  <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                    <thead><tr><th>Report type</th><th className="num">Ratings</th><th className="num">Average</th></tr></thead>
                    <tbody>{r.sat.by_type.map((t) => <tr key={t.key}><td>{t.key}</td><td className="num">{t.n}</td><td className="num">{t.avg} ★</td></tr>)}</tbody>
                  </table></div>
                  <div className="panel-foot">Stars given: {r.sat.dist.map((n, i) => `${i + 1}★ ${n}`).join(' · ')}.
                    {r.sat.low.length ? ` Low ratings (1–2 ★) to follow up: ${r.sat.low.slice(0, 5).map((x) => `#${x.id} ${x.type} (${x.zone})${x.stars_comment ? ` – “${x.stars_comment}”` : ''}`).join('; ')}${r.sat.low.length > 5 ? ` and ${r.sat.low.length - 5} more` : ''}.` : ' No low ratings.'}</div>
                </>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Resident pickup ratings</h2>
                <p>From “Rate today’s pickup” in the resident app{r.zoneId ? ` · ${zoneName}` : ''}. {r.ratings.total ? `${r.ratings.pct}% good (${r.ratings.good} of ${r.ratings.total}).` : ''}</p></div>
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                <thead><tr><th>Zone</th><th className="num">Good</th><th className="num">Had a problem</th></tr></thead>
                <tbody>
                  {!r.ratings.total && <tr><td colSpan={3}><Empty icon="message" title="No ratings" text="Residents gave no pickup ratings in this period." /></td></tr>}
                  {r.ratings.by_zone.map(([zone, v]) => <tr key={zone}><td>{zone}</td><td className="num">{v.good}</td><td className="num">{v.poor}</td></tr>)}
                </tbody>
              </table></div>
              {r.ratings.problems.length ? (
                <div className="panel-foot">Problems residents described: {r.ratings.problems.slice(0, 5).map((p) => `${p.zone}${p.text ? ` – “${p.text}”` : ''}`).join('; ')}{r.ratings.problems.length > 5 ? ` and ${r.ratings.problems.length - 5} more (see Resident feedback)` : ''}.</div>
              ) : null}
            </section>
          </div>

          <div className="grid grid-2 mb">
            <section className="panel">
              <div className="panel-head"><h2>Truck stops</h2><p>From the collector app. Truck load is the collector’s estimate after the stop.</p></div>
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                <thead><tr><th>Stop</th><th className="num">Done</th><th className="num">Couldn’t collect</th><th>Truck load (avg)</th></tr></thead>
                <tbody>
                  {!r.stops.length && <tr><td colSpan={4}><Empty title="No stops logged" text="Stops appear when the collector taps Done or Couldn’t collect in the app." /></td></tr>}
                  {r.stops.map((st) => (
                    <tr key={st.name}>
                      <td>{st.name}<div className="muted">{st.served.join(', ')}</div></td>
                      <td className="num">{st.done}</td>
                      <td className="num">{st.missed}{st.missed ? <div className="muted" style={{ whiteSpace: 'normal' }}>{Object.entries(st.reasons).map(([k, n]) => `${k} ${n}`).join(', ')}</div> : null}</td>
                      <td>{loadText(st.loads)}{st.loads.filter((l) => l === 4).length ? <div className="muted">Full {st.loads.filter((l) => l === 4).length}×</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Truck hours</h2>
                <span className="note">{r.shifts.length ? `${hoursText(r.shifts.reduce((a, x) => a + Number(x.hours), 0))} in ${r.shifts.length} shift${r.shifts.length === 1 ? '' : 's'}` : ''}</span>
                <p>From “Start shift” and “End shift” in the collector app.</p></div>
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
                <thead><tr><th>Date</th><th>Collector · truck</th><th>Shift</th><th>Hours</th></tr></thead>
                <tbody>
                  {!r.shifts.length && <tr><td colSpan={4}><Empty title="No shifts" text="Shifts appear when collectors use Start shift in the app." /></td></tr>}
                  {r.shifts.map((x) => (
                    <tr key={x.shift_id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(x.shift_date, 'D, M j')}</td>
                      <td>{x.collector}<div className="muted">{x.truck ?? 'No truck'}</div></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{clockOf(x.started_at)} – {x.status === 'open' ? 'now' : clockOf(x.ended_at)}
                        {SHIFT_NOTE[x.status] ? <div className="muted" style={{ whiteSpace: 'normal' }}>{SHIFT_NOTE[x.status]}</div> : null}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{hoursText(x.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          </div>

          <section className="panel mb">
            <div className="panel-head"><h2>Emergency collections</h2>
              <span className="note">{r.ems.length} in this period: {r.es.Completed} completed, {r.es.Scheduled + r.es['In progress']} pending{r.es.overdue ? `, ${r.es.overdue} overdue` : ''}, {r.es.Cancelled} cancelled</span>
              <p>One-time pickups outside the fixed schedule. Not included in the completion rate above.</p></div>
            <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
              <thead><tr><th>Date</th><th>Where</th><th>Reason</th><th>Collector</th><th>Status</th></tr></thead>
              <tbody>
                {!r.ems.length && <tr><td colSpan={5}><Empty icon="alert" title="None in this period" text="No emergency collections were arranged." /></td></tr>}
                {r.ems.map((em) => (
                  <tr key={em.id}>
                    <td>{fmtDate(em.date, 'D, M j')}<div className="muted">{em.window}</div></td>
                    <td>{em.location}<div className="muted">{em.zone}</div></td>
                    <td>{em.reason}</td><td>{em.collector}</td>
                    <td><span className={`chip ${emCss(em.status, em.overdue)}`}>{em.status}{em.overdue ? ' · overdue' : ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>

          <section className="panel mb">
            <div className="panel-head"><h2>Collections in this report</h2><span className="note">{r.items.length} rows{r.items.length > 100 ? ', first 100 shown; download the CSV for all' : ''}</span></div>
            <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
              <thead><tr><th>Date</th><th>Zone</th><th>Waste</th><th>Window</th><th>Collector · truck</th><th>Status</th><th>Logged</th></tr></thead>
              <tbody>
                {!r.items.length && <tr><td colSpan={7}><Empty title="No collections match" text="Change the period, zone or status filter." /></td></tr>}
                {r.items.slice(0, 100).map((it) => (
                  <tr key={`${it.id}|${it.date}`}>
                    <td>{fmtDate(it.date, 'D, M j')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><span style={{ color: it.color }}>●</span> {it.zone}</td>
                    <td>{it.category}</td><td>{it.window}</td>
                    <td>{it.collector}<div className="muted">{it.truck ?? ''}</div></td>
                    <td><span className={`chip ${STATE_CSS[it.state]}`}>{stateLabel(it)}</span>{it.late && <> <span className="chip pending plain">Late</span></>}{it.missed?.note ? <div className="muted">{it.missed.note}</div> : null}</td>
                    <td className="muted">{it.completed_at && it.completed_at.length > 10 ? fmtStamp(it.completed_at) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <p className="note mb">How these numbers are worked out: a pickup is expected when an active schedule falls on that weekday. It is <strong>completed</strong> when the collector marked it done in the mobile app, <strong>late</strong> if that happened after the window ended, and <strong>missed</strong> if the window ended with nothing logged or the collector marked its truck stop “Couldn’t collect”. Completion rate = completed ÷ (completed + missed). Fixed-schedule pickups count from the date the official schedule was loaded; earlier days use the schedule list at that time plus any pickup that was actually logged.</p>

          <section className="panel mb no-print">
            <div className="panel-head"><h2>Report log</h2><p>Reports saved with “Save to report log”. Open one again by choosing the same period above.</p></div>
            <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl">
              <thead><tr><th>Report</th><th>Saved by</th><th>Saved</th>{isLgu && <th />}</tr></thead>
              <tbody>
                {!r.log.length && <tr><td colSpan={isLgu ? 4 : 3}><Empty icon="report" title="No saved reports" text='Use "Save to report log" to keep a record of a report.' /></td></tr>}
                {r.log.map((row) => {
                  const by = row.lgu_admin ? `${row.lgu_admin.first_name ?? ''} ${row.lgu_admin.last_name ?? ''}`.trim()
                    : row.barangay_admin ? `${row.barangay_admin.firstname ?? ''} ${row.barangay_admin.lastname ?? ''}`.trim() : '';
                  return (
                    <tr key={row.report_id}>
                      <td>{row.report_type}</td>
                      <td>{by || (row.lgu_admin_id ? 'LGU Admin' : 'Barangay Admin')}</td>
                      <td>{fmtStamp(toManila(row.generated_timestamp), true)}</td>
                      {isLgu && <td className="actions"><button type="button" className="btn btn-danger btn-sm" onClick={() => removeLog(row)}><Icon name="trash" />Remove</button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}

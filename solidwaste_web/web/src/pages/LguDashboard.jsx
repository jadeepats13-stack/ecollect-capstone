// LGU Admin dashboard: overall monitoring of collection performance (port of users/lgu_admin/dashboard.php + dash-lgu.js). Read-only.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { PageHead, LoadError } from '../components/common';
import ZoneMapPanel from '../components/ZoneMapPanel';
import FieldReports from '../components/FieldReports';
import ChartBox, { useThemeTick } from '../components/ChartBox';
import { usePanel } from '../components/Layout';
import { lguDashboard } from '../lib/dashboard';
import { color as C, poll } from '../lib/ui';
import { fmtDate, fmtStamp, weekday } from '../lib/time';
import { EmptyLi } from './BarangayDashboard';

const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month']];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (x) => `${weekday(x)}, ${MONTHS_LONG[Number(x.slice(5, 7)) - 1]} ${Number(x.slice(8, 10))}`;

function Heat({ d }) {
  const days = d.strip.days, today = d.today.date;
  if (!d.strip.rows.length) return <div className="empty"><strong>No zones found</strong><span>The route table has no zone records.</span></div>;
  return (
    <table>
      <thead><tr><th />{days.map((x) => <th key={x} scope="col" title={longDate(x)}>{weekday(x).charAt(0)}<br />{fmtDate(x, 'j')}</th>)}<th>Rate</th></tr></thead>
      <tbody>{d.strip.rows.map((r) => (
        <tr key={r.id}>
          <th className="z" scope="row"><span style={{ color: r.color }}>●</span> {r.name}</th>
          {days.map((x) => {
            const c = r.cells[x];
            const label = `${r.name}, ${fmtDate(x, 'M j')}: `;
            if (x < d.strip.tracking_start) return <td key={x} className="none" title={`${label}before tracking started`} />;
            if (!c.expected) return <td key={x} title={`${label}no collection scheduled`} />;
            if (c.open && x === today) return <td key={x} className="open" title={`${label}${c.completed} done, ${c.open} still open, ${c.delayed} missed`}>{c.completed}</td>;
            const due = c.completed + c.delayed;
            const ratio = due ? c.completed / due : 1;
            const cls = ratio >= 1 ? 'r4' : ratio >= 0.75 ? 'r3' : ratio >= 0.4 ? 'r2' : ratio > 0 ? 'r1' : 'r0';
            return <td key={x} className={cls} title={`${label}${c.completed} of ${due} done`}>{c.completed}</td>;
          })}
          <td className="rate">{r.rate === null ? <span className="muted">n/a</span> : `${Math.round(r.rate)}%`}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

export default function LguDashboard() {
  const panel = usePanel();
  const [params, setParams] = useSearchParams();
  const range = RANGES.some(([k]) => k === params.get('range')) ? params.get('range') : '30';
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const theme = useThemeTick();
  const p = (path) => `/lgu/${path}`;

  useEffect(() => {
    const poller = poll(() => lguDashboard(range), 30000, (data) => { setD(data); setError(''); },
      (s) => { panel?.setLive(s); if (s.state === 'error') setError((e) => e || 'Dashboard data could not be loaded. Check your internet connection.'); });
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const charts = useMemo(() => {
    if (!d) return null;
    const w = d.range.days > 31 || d.range.key === 'month' || d.range.days >= 28 ? d.trend_weekly : d.trend_daily;
    const isWeekly = w === d.trend_weekly;
    const z = d.zones, fb = d.feedback.summary, wk = Object.keys(fb.weeks), ts = d.fleet.truck_states, g = d.fleet.gps;
    return {
      weekly: { empty: !(w.completed.some(Boolean) || w.delayed.some(Boolean)), config: {
        type: 'bar',
        data: { labels: w.labels, datasets: [
          { type: 'line', label: 'Completion rate', data: w.rate, yAxisID: 'y1', borderColor: C('ink'), backgroundColor: C('ink'), tension: 0.3, spanGaps: true, pointRadius: 3 },
          { label: 'Completed', data: w.completed, backgroundColor: C('st-done'), stack: 's', borderRadius: 3 },
          { label: 'Missed', data: w.delayed, backgroundColor: C('st-delayed'), stack: 's', borderRadius: 3 }] },
        options: { plugins: { legend: { position: 'bottom' }, title: { display: true, text: isWeekly ? 'By week' : 'By day', align: 'start', color: C('ink-3'), font: { weight: 500 } } },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Pickups' } },
            y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: (v) => `${v}%` } } } },
      } },
      zones: { empty: !z.some((x) => x.expected), config: {
        type: 'bar',
        data: { labels: z.map((x) => x.name), datasets: [
          { label: 'On time', data: z.map((x) => x.completed - x.late), backgroundColor: C('st-done'), stack: 's' },
          { label: 'Completed late', data: z.map((x) => x.late), backgroundColor: '#7fbf9f', stack: 's' },
          { label: 'Missed', data: z.map((x) => x.delayed), backgroundColor: C('st-delayed'), stack: 's' }] },
        options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { footer: (items) => { const r = z[items[0].dataIndex]; return r.rate === null ? 'Nothing due' : `Completion rate ${r.rate}%`; } } } },
          scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } } },
      } },
      feedback: { empty: !wk.length, config: {
        type: 'line',
        data: { labels: wk.map((k) => `Wk of ${fmtDate(fb.weeks[k].start, 'M j')}`), datasets: [
          { label: 'Submitted', data: wk.map((k) => fb.weeks[k].submitted), borderColor: C('brand'), backgroundColor: C('brand'), tension: 0.3 },
          { label: 'Still unresolved', data: wk.map((k) => fb.weeks[k].open), borderColor: C('st-delayed'), backgroundColor: C('st-delayed'), borderDash: [5, 4], tension: 0.3 }] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
      } },
      trucks: { config: {
        type: 'doughnut',
        data: { labels: ['Live GPS', 'Scheduled today', 'Idle today', 'No crew'], datasets: [{ data: [ts.live, ts.scheduled, ts.idle, ts.unassigned], backgroundColor: [C('st-ongoing'), C('st-done'), C('st-idle'), C('line-strong')], borderWidth: 0 }] },
        options: { cutout: '62%', plugins: { legend: { position: 'bottom' }, title: { display: true, text: `${d.fleet.trucks} trucks`, color: C('ink'), font: { weight: 600 } } } },
      } },
      gps: { config: {
        type: 'doughnut',
        data: { labels: ['Live (≤ 5 min)', 'Recent (≤ 1 h)', 'Old', 'Never sent'], datasets: [{ data: [g.live, g.recent, g.stale, g.none], backgroundColor: [C('st-ongoing'), C('st-pending'), C('st-idle'), C('line-strong')], borderWidth: 0 }] },
        options: { cutout: '62%', plugins: { legend: { position: 'bottom' }, title: { display: true, text: `${d.fleet.collectors} collectors`, color: C('ink'), font: { weight: 600 } } } },
      } },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, theme]);

  const t = d?.totals, pv = d?.prev;
  const rate = t?.rate ?? null;
  const circ = 314.16;
  const onTime = t && t.completed ? Math.round(((t.completed - t.late) / t.completed) * 100) : null;
  let compare = '';
  if (d) {
    if (pv.has_data && pv.rate !== null && rate !== null) {
      const diff = Math.round((rate - pv.rate) * 10) / 10;
      compare = `${diff === 0 ? 'Same as' : diff > 0 ? `Up ${diff} points from ` : `Down ${Math.abs(diff)} points from `} the previous ${d.range.days} days (${pv.rate}%, ${pv.completed} of ${pv.completed + pv.delayed}).`;
    } else compare = 'No earlier period with tracked pickups to compare against.';
    if (d.range.effective_from > d.range.from) compare += ` Counted from ${fmtDate(d.range.effective_from, 'M j, Y')}, when pickup tracking started.`;
  }
  const fb = d?.feedback.summary;
  const types = fb ? Object.keys(fb.by_type) : [];
  const em = d?.emergency;

  return (
    <>
      <PageHead topTitle="Overview" title="Collection performance" desc="Barangay Poblacion, all 10 zones. Figures come from schedules and the pickups collectors log in the mobile app.">
        <div className="seg" role="group" aria-label="Reporting period">
          {RANGES.map(([k, l]) => <button key={k} type="button" aria-pressed={k === range} onClick={() => setParams({ range: k }, { replace: true })}>{l}</button>)}
        </div>
        <Link className="btn btn-ghost" to={p('reports')}><Icon name="report" />Performance report</Link>
      </PageHead>

      {error && !d && <LoadError message={error} />}
      {d && !d.zone_check.ok && <div className="callout danger mb" role="alert"><div><strong>Zone records are inconsistent.</strong> {d.zone_check.problems.join(' ')} No data was changed.</div></div>}

      <div className="grid grid-main-side mb">
        <section className="panel" aria-labelledby="rateTitle">
          <div className="panel-head"><h2 id="rateTitle">Completion rate</h2><span className="note">{d?.range.label}</span>
            <p>Completed pickups ÷ pickups that were due. Pickups not due yet are not counted.</p></div>
          <div className="panel-body">
            <div className="gauge">
              <svg viewBox="0 0 120 120" role="img" aria-labelledby="gaugeText">
                <circle className="g-track" cx="60" cy="60" r="50" />
                <circle className="g-val" cx="60" cy="60" r="50" strokeDasharray="314.16"
                  style={{ strokeDashoffset: rate === null ? circ : (circ * (1 - rate / 100)).toFixed(1), stroke: rate === null ? 'var(--st-idle)' : rate >= 90 ? 'var(--st-done)' : rate >= 70 ? 'var(--st-pending)' : 'var(--st-delayed)' }} />
                <text id="gaugeText" x="60" y="66" textAnchor="middle" fontSize="22">{!d ? '–' : rate === null ? 'n/a' : `${Math.round(rate)}%`}</text>
              </svg>
              <div className="figures">{d && [[t.completed, 'Completed'], [t.delayed, 'Missed'], [t.late, 'Completed late'],
                [onTime === null ? 'n/a' : `${onTime}%`, 'Of completed, on time'], [t.ongoing + t.pending, 'Not due yet (today)']].map(([n, l]) => (
                <div className="figure" key={l}><span className="num">{n}</span><span className="lbl">{l}</span></div>))}</div>
            </div>
            <p className="note" style={{ marginTop: 12 }}>{compare}</p>
          </div>
        </section>
        <section className="panel" aria-labelledby="todayTitle">
          <div className="panel-head"><h2 id="todayTitle">Today so far</h2><Link className="panel-link" to={p('map')}>Live map</Link></div>
          <div className="panel-body">
            <div className="status-strip" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
              <div className="status-cell cell-done"><span className="lbl">Completed</span><span className="num">{d ? d.today.counts.completed : '–'}</span></div>
              <div className="status-cell cell-ongoing"><span className="lbl">Ongoing</span><span className="num">{d ? d.today.counts.ongoing : '–'}</span></div>
              <div className="status-cell cell-pending" style={{ borderTop: '1px solid var(--line)' }}><span className="lbl">Pending</span><span className="num">{d ? d.today.counts.pending : '–'}</span></div>
              <div className="status-cell cell-delayed" style={{ borderTop: '1px solid var(--line)' }}><span className="lbl">Delayed</span><span className="num">{d ? d.today.counts.delayed : '–'}</span></div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel mb" aria-labelledby="stripTitle">
        <div className="panel-head"><h2 id="stripTitle">Zone performance, last 14 days</h2>
          <p>One square per zone per day. Hover a square for the count. The right column is each zone's 14-day completion rate.</p></div>
        <div className="heat">{d ? <Heat d={d} /> : <div className="skeleton" style={{ height: 200 }} />}</div>
        <div className="heat-legend">
          <span><i style={{ background: 'var(--st-done)' }} />All done</span>
          <span><i style={{ background: 'color-mix(in srgb,var(--st-done) 55%,var(--surface))' }} />Mostly done</span>
          <span><i style={{ background: 'var(--st-pending)' }} />About half</span>
          <span><i style={{ background: 'var(--st-delayed)' }} />None done</span>
          <span><i style={{ background: 'var(--st-ongoing-soft)', boxShadow: 'inset 0 0 0 1.5px var(--st-ongoing)' }} />Still open today</span>
          <span><i style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }} />No collection scheduled</span>
        </div>
      </section>

      <div className="grid grid-2 mb">
        <section className="panel"><div className="panel-head"><h2>Weekly trend</h2><p>Pickups completed and missed per week, with the completion rate.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.weekly} tall emptyText="Trends appear once collectors log pickups in the app." label="Weekly completed and missed collections with completion rate" />}</div></section>
        <section className="panel"><div className="panel-head"><h2>Zone comparison</h2><p>Completed, completed late and missed pickups per zone in the period.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.zones} tall emptyText="No collections were scheduled in this period." label="Completed, late and missed pickups per zone" />}</div></section>
        <section className="panel"><div className="panel-head"><h2>Resident concerns</h2><Link className="panel-link" to={p('feedback')}>All reports</Link><p>Reports submitted each week, and how many of them are still unresolved.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.feedback} emptyText="No resident reports in this period." label="Weekly resident reports submitted and still open" />}
            {fb && <p className="note" style={{ marginTop: 10 }}><strong>{fb.total}</strong> reports in the period, <strong>{fb.open}</strong> still unresolved. <strong>{fb.open_all_time}</strong> unresolved in total{fb.oldest_open_days !== null ? `, the oldest ${fb.oldest_open_days} days old` : ''}. {types.length ? `Most common: ${types[0]} (${fb.by_type[types[0]]}).` : ''}</p>}</div></section>
        <section className="panel"><div className="panel-head"><h2>Fleet and crews</h2><Link className="panel-link" to={p('trucks')}>Trucks</Link><p>Truck status today and how recently each collector's phone reported its GPS position.</p></div>
          <div className="panel-body">
            <div className="grid grid-2">
              <div>{charts && <ChartBox {...charts.trucks} short label="Truck status" />}</div>
              <div>{charts && <ChartBox {...charts.gps} short label="Collector GPS freshness" />}</div>
            </div>
            {d && <p className="note" style={{ marginTop: 10 }}>{d.fleet.on_duty} of {d.fleet.collectors} collectors have pickups today. Positions come from the collector mobile app; a collector who has not opened the app shows as "Never sent".</p>}
          </div></section>
      </div>

      <div className="grid grid-main-side mb">
        <section className="panel" aria-labelledby="accTitle">
          <div className="panel-head"><h2 id="accTitle">Missed collections</h2><Link className="panel-link" to={p('reports?status=delayed')}>Full list</Link>
            <p>{d ? `${d.delayed_total} missed in ${d.range.label.toLowerCase()}${d.delayed_total > d.delayed.length ? `; showing the latest ${d.delayed.length}.` : '.'}` : 'Scheduled pickups whose window ended with no pickup logged.'}</p></div>
          <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl"><thead><tr><th>Date</th><th>Zone</th><th>Waste</th><th>Window</th><th>Collector · truck</th></tr></thead>
            <tbody>{d && (d.delayed.length ? d.delayed.map((i) => (
              <tr key={`${i.id}|${i.date}`}><td>{fmtDate(i.date, 'D, M j')}</td><td><span style={{ color: i.color }}>●</span> {i.zone}</td><td>{i.category}</td><td>{i.window}</td><td>{i.collector}<div className="muted">{i.missed ? `Couldn't collect: ${i.missed.reason}` : i.truck || 'No truck'}</div></td></tr>
            )) : <tr><td colSpan={5}><div className="empty"><strong>No missed collections</strong><span>Every pickup due in this period was logged.</span></div></td></tr>)}</tbody></table></div>
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2>Emergency collections</h2><Link className="panel-link" to={p('emergency')}>All</Link>
              <p>{em ? (em.summary.total ? `${em.summary.total} in ${d.range.label.toLowerCase()}: ${em.summary.Completed || 0} completed, ${(em.summary.Scheduled || 0) + (em.summary['In progress'] || 0)} pending${em.summary.overdue ? `, ${em.summary.overdue} overdue` : ''}. Not counted in the completion rate.` : 'One-time pickups the barangay arranges outside the fixed schedule.') : ''}</p></div>
            <div className="panel-body flush"><ul className="list">{em && (em.recent.length ? em.recent.map((e) => (
              <li key={e.id}><span className={`mark ${e.overdue ? 'delayed' : e.status === 'Completed' ? 'done' : 'pending'}`}>!</span><span className="grow"><span className="title">{e.location} · {e.zone}</span>
                <span className="meta">{fmtDate(e.date, 'M j')} {e.window} — {e.reason}</span></span><span className="when">{e.overdue ? 'Overdue' : e.status}</span></li>
            )) : <EmptyLi title="None in this period" text="The barangay has not arranged emergency pickups." />)}</ul></div>
          </section>
          <section className="panel"><div className="panel-head"><h2>Oldest unresolved concerns</h2></div>
            <div className="panel-body flush"><ul className="list">{d && (d.feedback.oldest_open.length ? d.feedback.oldest_open.map((f) => (
              <li key={f.id}><span className="mark pending">{f.type.charAt(0)}</span><span className="grow"><span className="title">{f.type} · {f.status}</span>
                <span className="meta">{f.zone}{f.description ? ` — ${f.description.slice(0, 70)}` : ''}</span></span><span className="when">{f.age_days !== null ? `${f.age_days} days` : ''}</span></li>
            )) : <EmptyLi title="No unresolved concerns" text="All resident reports have been resolved." />)}</ul></div></section>
          <FieldReports field={d?.field} editable={false} />
          <section className="panel"><div className="panel-head"><h2>Recent activity</h2></div>
            <div className="panel-body flush"><ul className="list">{d && (d.activity.length ? d.activity.map((a, i) => (
              <li key={i}><span className={`mark ${a.kind === 'pickup' ? 'done' : a.kind === 'feedback' ? 'pending' : ''}`}>{a.kind.charAt(0).toUpperCase()}</span><span className="grow"><span className="title">{a.title}</span><span className="meta">{a.meta}</span></span><span className="when">{fmtStamp(a.at)}</span></li>
            )) : <EmptyLi title="No activity yet" text="Pickups, reports and announcements will show here." />)}</ul></div></section>
        </div>
      </div>

      <ZoneMapPanel title="Barangay map" desc="Same zones, routes and GPS positions the Barangay Admin sees. View only." showFeedback live={false}
        actions={<Link className="panel-link" to={p('map')}>Full screen</Link>} />
    </>
  );
}

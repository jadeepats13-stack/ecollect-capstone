// Barangay Admin dashboard: day-to-day collection operations (port of users/barangay_admin/dashboard.php + dash-barangay.js).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { PageHead, LoadError, zoneBadgeStyle } from '../components/common';
import ZoneMapPanel from '../components/ZoneMapPanel';
import FieldReports from '../components/FieldReports';
import ChartBox, { useThemeTick } from '../components/ChartBox';
import { usePanel } from '../components/Layout';
import { barangayDashboard } from '../lib/dashboard';
import { color as C, poll } from '../lib/ui';
import { fmtDate, fmtStamp, fmtTime } from '../lib/time';

export const STATE_LABEL = { completed: 'Completed', ongoing: 'Ongoing', pending: 'Pending', delayed: 'Delayed', upcoming: 'Upcoming', untracked: 'Before tracking' };
export const STATE_CSS = { completed: 'done', ongoing: 'ongoing', pending: 'pending', delayed: 'delayed', upcoming: 'pending', untracked: '' };
const mins = (t) => (t ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]) : null);

export function EmptyLi({ title, text }) {
  return <li className="empty" style={{ display: 'grid' }}><strong>{title}</strong><span>{text}</span></li>;
}

export function ZoneCheck({ check }) {
  if (!check || check.ok) return null;
  return (
    <div className="callout danger mb" role="alert"><div><strong>The zone records need attention.</strong> {check.problems.join(' ')} Zones cannot be added or deleted from the web, so ask your system administrator to review the route table. No data was changed.</div></div>
  );
}

function Timeline({ d, onSelect }) {
  const items = d.today.items;
  if (!items.length) {
    return <div className="empty"><strong>No collections scheduled today</strong><span>{d.today.day} has no active schedules.</span></div>;
  }
  let lo = 24 * 60, hi = 0;
  for (const i of items) { const s = mins(i.start), e = mins(i.end); if (s !== null) lo = Math.min(lo, s); if (e !== null) hi = Math.max(hi, e); }
  const now = mins(d.today.time);
  lo = Math.min(lo, now); hi = Math.max(hi, now);
  lo = Math.max(0, Math.floor(lo / 60) * 60 - 60); hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60 + 60);
  const span = hi - lo;
  const pct = (m) => `${(((m - lo) / span) * 100).toFixed(2)}%`;
  const step = span > 12 * 60 ? 120 : 60;
  const ticks = [];
  for (let m = lo; m <= hi; m += step) { const h = Math.floor(m / 60) % 24; ticks.push(<span key={m} className="tick" style={{ left: pct(m) }}>{(h % 12) || 12}{h < 12 ? 'a' : 'p'}</span>); }
  const byZone = {};
  for (const i of items) (byZone[i.zone] ??= []).push(i);
  const zones = Object.keys(byZone).sort((a, b) => (byZone[a][0].zone_no || 99) - (byZone[b][0].zone_no || 99));
  return (
    <div style={{ position: 'relative' }}>
      <div className="tl-axis"><div /><div className="tl-track">{ticks}</div></div>
      {zones.map((z) => (
        <div className="tl-row" key={z}>
          <div className="tl-zone"><span className="zone-badge" style={zoneBadgeStyle(byZone[z][0].color, true)}>{byZone[z][0].zone_no || ''}</span>{z}</div>
          <div className="tl-track">
            {byZone[z].map((i) => {
              const s = mins(i.start) ?? lo, e = mins(i.end) ?? hi;
              const title = `${z}: ${i.category}, ${fmtTime(i.start)}–${fmtTime(i.end)}, ${i.collector} — ${i.missed ? `Missed at ${i.missed.stop}: ${i.missed.reason}${i.missed.note ? ` (${i.missed.note})` : ''}` : STATE_LABEL[i.state]}${i.late ? ' (late)' : ''}${i.completed_at ? `, logged ${fmtStamp(i.completed_at)}` : ''}`;
              return (
                <button key={i.id} type="button" className={`tl-bar ${STATE_CSS[i.state] || ''}`} title={title} aria-label={title}
                  style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} onClick={() => i.zone_id && onSelect(i.zone_id)}>
                  {i.missed ? `Missed: ${i.missed.reason}` : `${i.category} · ${i.collector}`}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="tl-axis" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', alignItems: 'stretch' }}>
        <div /><div style={{ position: 'relative' }}><div className="tl-now" style={{ left: pct(now) }}><span>Now {fmtTime(d.today.time)}</span></div></div>
      </div>
    </div>
  );
}

export function GpsChip({ gps }) {
  if (gps === 'live') return <span className="chip ongoing">Live</span>;
  if (gps === 'recent') return <span className="chip pending">Recent</span>;
  if (gps === 'stale') return <span className="chip">Old</span>;
  return <span className="chip plain">No GPS</span>;
}

export default function BarangayDashboard() {
  const panel = usePanel();
  const [params, setParams] = useSearchParams();
  const range = ['7', '14', '30'].includes(params.get('range')) ? params.get('range') : '14';
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const mapRef = useRef(null);
  const pollerRef = useRef(null);
  const theme = useThemeTick();
  const p = (path) => `/barangay/${path}`;

  useEffect(() => {
    const poller = poll(() => barangayDashboard(range), 20000, (data) => { setD(data); setError(''); panel?.refreshBadges(); },
      (s) => { panel?.setLive(s); if (s.state === 'error') setError((e) => e || 'Dashboard data could not be loaded. Check your internet connection.'); });
    pollerRef.current = poller;
    return () => poller.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const charts = useMemo(() => {
    if (!d) return null;
    const tr = d.trend, z = d.zones, pr = d.period, fb = d.feedback.summary;
    const delayZones = z.filter((x) => x.delayed || x.late);
    const statusVals = [pr.completed - pr.late, pr.late, pr.delayed, pr.ongoing, pr.pending];
    const types = Object.keys(fb.by_type);
    return {
      trend: { empty: !(tr.completed.some(Boolean) || tr.delayed.some(Boolean)), config: {
        type: 'bar',
        data: { labels: tr.labels, datasets: [
          { label: 'Completed', data: tr.completed, backgroundColor: C('st-done'), borderRadius: 3, stack: 's' },
          { label: 'Delayed', data: tr.delayed, backgroundColor: C('st-delayed'), borderRadius: 3, stack: 's' }] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
      } },
      zone: { empty: !z.some((x) => x.rate !== null), config: {
        type: 'bar',
        data: { labels: z.map((x) => x.name), datasets: [{ label: 'Completion rate', data: z.map((x) => x.rate), backgroundColor: z.map((x) => x.color), borderRadius: 3 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const r = z[c.dataIndex]; return r.rate === null ? 'Nothing due' : `${r.rate}% (${r.completed} of ${r.completed + r.delayed} due)`; } } } },
          scales: { x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } }, y: { grid: { display: false } } } },
      } },
      status: { empty: !statusVals.some(Boolean), config: {
        type: 'doughnut',
        data: { labels: ['Completed on time', 'Completed late', 'Delayed / missed', 'Ongoing', 'Pending'], datasets: [{ data: statusVals, backgroundColor: [C('st-done'), '#7fbf9f', C('st-delayed'), C('st-ongoing'), C('st-pending')], borderWidth: 0 }] },
        options: { cutout: '64%', plugins: { legend: { position: 'right' } } },
      } },
      delay: { empty: !delayZones.length, config: {
        type: 'bar',
        data: { labels: delayZones.map((x) => x.name), datasets: [
          { label: 'Missed', data: delayZones.map((x) => x.delayed), backgroundColor: C('st-delayed'), borderRadius: 3 },
          { label: 'Completed late', data: delayZones.map((x) => x.late), backgroundColor: C('st-pending'), borderRadius: 3 }] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } },
      } },
      feedback: { empty: !types.length, config: {
        type: 'bar',
        data: { labels: types, datasets: [{ label: 'Reports', data: types.map((t) => fb.by_type[t]), backgroundColor: C('brand'), borderRadius: 3 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, subtitle: { display: true, text: Object.entries(fb.by_status).map(([s, n]) => `${s}: ${n}`).join('   '), position: 'bottom' } },
          scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
      } },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, theme]);

  const today = d?.today;
  const c = today?.counts ?? {};
  const stops = d?.stops_today ?? [];
  const pr = d?.period;

  return (
    <>
      <PageHead topTitle="Dashboard" title="Collection today"
        desc={`${today ? fmtDate(today.date, 'l, F j, Y').replace(/, \d{4}$/, '') : ''} in Barangay Poblacion. Pickups update as collectors mark them done in the mobile app.`}>
        <Link className="btn btn-ghost" to={p('map')}><Icon name="map" />Open live map</Link>
        <Link className="btn btn-primary" to={p('emergency?new=1')}><Icon name="alert" />Schedule emergency collection</Link>
      </PageHead>

      {error && !d && <LoadError message={error} />}
      <ZoneCheck check={d?.zone_check} />

      <div className="status-strip mb" aria-label="Today's collections">
        <Link className="status-cell cell-pending" to={p('schedules')}><span className="lbl">Pending</span><span className="num">{d ? c.pending : '–'}</span><span className="sub">Window not started</span></Link>
        <Link className="status-cell cell-ongoing" to={p('map')}><span className="lbl">Ongoing</span><span className="num">{d ? c.ongoing : '–'}</span><span className="sub">Inside collection window</span></Link>
        <Link className="status-cell cell-done" to={p('reports?range=today')}><span className="lbl">Completed</span><span className="num">{d ? c.completed : '–'}</span><span className="sub">{d ? (today.total ? `${c.completed} of ${today.total} scheduled today` : 'No pickups scheduled today') : 'Logged by collectors'}</span></Link>
        <a className="status-cell cell-delayed" href="#attention"><span className="lbl">Delayed</span><span className="num">{d ? c.delayed : '–'}</span><span className="sub">Window ended, no pickup</span></a>
        <Link className="status-cell cell-idle" to={p('feedback?status=open')}><span className="lbl">Open resident reports</span><span className="num">{d ? d.feedback.summary.open_all_time : '–'}</span><span className="sub">{d && d.feedback.summary.oldest_open_days !== null ? `Oldest is ${d.feedback.summary.oldest_open_days} day(s) old` : 'Unresolved'}</span></Link>
      </div>

      <section className="panel mb" aria-labelledby="tlTitle">
        <div className="panel-head">
          <h2 id="tlTitle">Today's collection windows</h2>
          <div className="panel-tools"><span className="note">{d && today.items.length ? `${today.items.length} pickups scheduled on ${today.day}` : ''}</span></div>
          <p>Each bar is one zone's pickup at a truck stop, placed on the clock. Select a bar to see it on the map. {d ? (stops.length ? `Truck stops today: ${stops.map((s) => `${s.name} (${s.window})`).join(', ')}.` : 'No truck stops today.') : ''}</p>
        </div>
        <div className="timeline">{d ? <Timeline d={d} onSelect={(id) => mapRef.current?.select(id)} /> : <div className="skeleton" style={{ height: 120 }} />}</div>
        <div className="tl-legend">
          <span><i style={{ background: 'var(--st-done)' }} />Completed</span>
          <span><i style={{ background: 'var(--st-ongoing)' }} />Ongoing</span>
          <span><i style={{ boxShadow: 'inset 0 0 0 1.5px var(--st-pending)' }} />Pending</span>
          <span><i style={{ background: 'var(--st-delayed)' }} />Delayed</span>
        </div>
      </section>

      <div className="grid grid-2 mb">
        <section className="panel" id="attention" aria-labelledby="attTitle">
          <div className="panel-head"><h2 id="attTitle">Needs attention</h2><Link className="panel-link" to={p('reports?status=delayed')}>All delays</Link></div>
          <div className="panel-body flush"><ul className="list list-scroll">
            {d && (d.attention.length ? d.attention.map((i) => (
              <li key={`${i.id}|${i.date}`}><span className="mark delayed">!</span><span className="grow"><span className="title">{i.zone} · {i.category}</span><span className="meta">{i.reason} · {i.collector}</span></span></li>
            )) : <EmptyLi title="Nothing delayed" text="Every pickup that was due has been logged." />)}
          </ul></div>
        </section>
        <section className="panel" aria-labelledby="emTitle">
          <div className="panel-head"><h2 id="emTitle">Emergency collections</h2><Link className="panel-link" to={p('emergency')}>Manage</Link></div>
          <div className="panel-body flush"><ul className="list list-scroll">
            {d && (d.emergency.open.length ? d.emergency.open.map((e) => (
              <li key={e.id}><span className={`mark ${e.overdue ? 'delayed' : 'pending'}`}>!</span><span className="grow"><span className="title">{e.location}</span>
                <span className="meta">{fmtDate(e.date, 'D, M j')} · {e.window} · {e.zone} — {e.reason}</span></span>
                <span className={`chip ${e.overdue ? 'delayed' : ({ Scheduled: 'pending', 'In progress': 'ongoing', Completed: 'done' }[e.status] || '')}`}>{e.overdue ? 'Overdue' : e.status}</span></li>
            )) : <EmptyLi title="None pending" text="Emergency pickups you schedule appear here." />)}
          </ul></div>
        </section>
        <section className="panel" aria-labelledby="fbTitle">
          <div className="panel-head"><h2 id="fbTitle">Unresolved resident reports</h2><Link className="panel-link" to={p('feedback?status=open')}>Manage</Link></div>
          <div className="panel-body flush"><ul className="list list-scroll">
            {d && (d.feedback.open.length ? d.feedback.open.map((f) => (
              <li key={f.id}><span className="mark pending">{f.type.charAt(0)}</span><span className="grow"><span className="title">{f.type}</span>
                <span className="meta">{f.zone} · {f.resident}{f.description ? ` — ${f.description.slice(0, 70)}` : ''}</span></span>
                <span className="when">{f.age_days !== null ? (f.age_days === 0 ? 'today' : `${f.age_days}d`) : ''}</span></li>
            )) : <EmptyLi title="No open reports" text="Resident concerns from the mobile app will appear here." />)}
          </ul></div>
        </section>
        <FieldReports field={d?.field} editable onChanged={() => pollerRef.current?.refresh()} />
      </div>

      <ZoneMapPanel ref={mapRef} showFeedback title="Zones and collectors" desc="Zone status for the selected date, saved routes, and the last GPS position of each collector."
        actions={<Link className="panel-link" to={p('map')}>Full screen</Link>} live={false} />

      <div className="page-head" style={{ margin: '28px 0 14px' }}>
        <div><h1 style={{ fontSize: 'var(--fs-lg)' }}>Recent performance</h1>
          <p>{d ? `${d.range.label}. ${pr.rate !== null ? `${pr.rate}% of due pickups were completed (${pr.completed} of ${pr.completed + pr.delayed}).` : 'No pickups were due yet.'}${d.range.effective_from > d.range.from ? ` Counted from ${d.range.effective_from}, when pickup tracking started.` : ''}` : ''}</p></div>
        <div className="seg" role="group" aria-label="Period">
          {[['7', '7 days'], ['14', '14 days'], ['30', '30 days']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={k === range} onClick={() => setParams({ range: k }, { replace: true })}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-2 mb">
        <section className="panel"><div className="panel-head"><h2>Daily pickups</h2><p>Completed versus delayed collections per day.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.trend} emptyText="Pickups appear once collectors start logging them in the app." label="Daily completed and delayed collections" />}</div></section>
        <section className="panel"><div className="panel-head"><h2>Completion rate by zone</h2><p>Completed ÷ (completed + delayed) for the period.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.zone} emptyText="No collections were due in this period." label="Completion rate per zone" />}</div></section>
        <section className="panel"><div className="panel-head"><h2>Collection status</h2><p>All expected collections in the period.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.status} short emptyText="Nothing was scheduled in this period." label="Collection status distribution" />}</div></section>
        <section className="panel"><div className="panel-head"><h2>Delays by zone</h2><p>Missed or late pickups in the period.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.delay} short emptyText="No missed or late pickups." label="Delayed and late collections per zone" />}</div></section>
        <section className="panel"><div className="panel-head"><h2>Resident reports by type</h2><p>Submitted in the period, split by status.</p></div>
          <div className="panel-body">{charts && <ChartBox {...charts.feedback} short emptyText="No resident reports were submitted in this period." label="Resident reports by type and status" />}</div></section>
        <section className="panel">
          <div className="panel-head"><h2>Collectors and trucks</h2><Link className="panel-link" to={p('collectors')}>Manage</Link><p>Today's progress and the freshness of each collector's GPS position.</p></div>
          <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl"><thead><tr><th>Collector</th><th>Zone · truck</th><th>Today</th><th>GPS</th></tr></thead>
            <tbody>{d && (d.fleet.length ? d.fleet.map((f) => {
              const pctDone = f.today_total ? Math.round((f.today_done / f.today_total) * 100) : 0;
              return (
                <tr key={f.id}><td><strong>{f.name}</strong></td><td><span style={{ color: f.color }}>●</span> {f.zone}<div className="muted">{f.truck || 'No truck'}</div></td>
                  <td>{f.today_total ? <div className="bar-cell"><div className="bar"><i style={{ width: `${pctDone}%` }} /></div><span>{f.today_done}/{f.today_total}</span></div> : <span className="muted">Off today</span>}</td>
                  <td><GpsChip gps={f.gps} /><div className="muted">{f.gps === 'none' ? 'No location sent' : f.ago}</div></td></tr>
              );
            }) : <tr><td colSpan={4}><div className="empty"><strong>No collectors yet</strong><span>Add collector accounts under Garbage collectors.</span></div></td></tr>)}</tbody></table></div>
        </section>
      </div>

      <div className="grid grid-2 mb">
        <section className="panel"><div className="panel-head"><h2>Next 7 days</h2><Link className="panel-link" to={p('schedules')}>Schedule</Link></div>
          <div className="panel-body flush"><ul className="list">
            {d && (d.upcoming.length ? d.upcoming.map((i) => (
              <li key={`${i.id}|${i.date}`}><span className="mark" style={{ background: i.color, color: '#fff' }}>{i.zone_no || ''}</span><span className="grow"><span className="title">{i.zone} · {i.category}</span><span className="meta">{i.window} · {i.collector}</span></span><span className="when">{fmtDate(i.date, 'D, M j')}</span></li>
            )) : <EmptyLi title="Nothing scheduled" text="No active schedules in the next 7 days." />)}
          </ul></div></section>
        <section className="panel"><div className="panel-head"><h2>Recent activity</h2></div>
          <div className="panel-body flush"><ActivityList items={d?.activity} /></div></section>
      </div>
    </>
  );
}

export function ActivityList({ items }) {
  if (!items) return <ul className="list" />;
  const css = { pickup: 'done', feedback: 'pending', announcement: '' };
  return (
    <ul className="list">
      {items.length ? items.map((a, i) => (
        <li key={i}><span className={`mark ${css[a.kind] || ''}`}>{a.kind.charAt(0).toUpperCase()}</span><span className="grow"><span className="title">{a.title}</span><span className="meta">{a.meta}</span></span><span className="when">{fmtStamp(a.at)}</span></li>
      )) : <EmptyLi title="No activity yet" text="Pickups, reports and announcements will show here." />}
    </ul>
  );
}

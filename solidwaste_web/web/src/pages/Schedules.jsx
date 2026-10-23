// Collection schedule: Barangay Poblacion's fixed schedule (port of schedules.php, schedule_week.php, schedule_list.php).
// Barangay Admin edits truck stops and the crew; the LGU Admin views.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, NoMatchRow, PageHead, ReadonlyBanner, SearchBar, useLoad, useSearchText } from '../components/common';
import { usePanel } from '../components/Layout';
import { cleanMapsUrl, loadOps, STATUS_LABELS } from '../lib/ops';
import { supabase } from '../lib/supabase';
import { addDays, DAYS, fmtDate, mondayOf } from '../lib/time';
import { toast } from '../lib/ui';

/** "Zone 1, Zone 2, Zone 5" -> "Zones 1, 2, 5" */
export function zonesShort(names) {
  const nums = [];
  for (const n of names) { const m = /^Zone\s+(\d+)$/i.exec(String(n).trim()); if (!m) return names.join(', '); nums.push(m[1]); }
  if (!nums.length) return '';
  return (nums.length === 1 ? 'Zone ' : 'Zones ') + nums.join(', ');
}
const gmapsFor = (p) => p.maps_url || `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

export function WeekView({ ops, points }) {
  const clock = ops.clock;
  const monday = mondayOf(clock.date);
  const sunday = addDays(monday, 6);
  const week = ops.week(points);
  const conflictIds = {};
  for (const c of ops.conflicts(points)) { (conflictIds[c.day] ??= {})[c.a.id] = true; conflictIds[c.day][c.b.id] = true; }
  const emByDate = {};
  for (const e of ops.emList({ from: monday, to: sunday, order: 'asc' })) (emByDate[e.date] ??= []).push(e);
  const dropOff = ops.zones().filter((z) => z.mode === 'drop_off');
  return (
    <section className="panel mb" aria-labelledby="weekTitle">
      <div className="panel-head">
        <h2 id="weekTitle">This week</h2>
        <span className="note">{fmtDate(monday, 'M j')}–{fmtDate(sunday, 'M j, Y')}</span>
        <p>Each card is one truck stop: where the truck parks and stands by while residents bring their garbage.</p>
      </div>
      <div className="week">
        {DAYS.map((day, i) => {
          const date = addDays(monday, i);
          const isToday = date === clock.date;
          const stops = week[day];
          const ems = emByDate[date] ?? [];
          return (
            <div className={`week-day${isToday ? ' is-today' : ''}`} key={day}>
              <h3>{day} <small>{fmtDate(date, 'M j')}{isToday ? ' · today' : ''}</small></h3>
              {stops.map((p) => {
                const conflict = Boolean(conflictIds[day]?.[p.id]);
                return (
                  <div key={p.id} className={`week-stop${conflict ? ' conflict' : ''}`} style={{ '--stop': p.color }} title={conflict ? 'Overlaps another stop; the barangay has one truck' : undefined}>
                    <span className="t">{p.window}</span>
                    <strong>{p.name}</strong>
                    <span className="z">{zonesShort(p.served)}{p.standby ? ` · ${p.standby} min standby` : ''}</span>
                    {conflict && <div style={{ color: 'var(--st-pending)', fontWeight: 600, marginTop: 3 }}>Overlaps another stop</div>}
                  </div>
                );
              })}
              {ems.map((em) => (
                <div className="week-stop emergency" key={`e${em.id}`}>
                  <span className="t">{em.window}</span><strong>Emergency: {em.location}</strong><span className="z">{em.zone} · {em.status}</span>
                </div>
              ))}
              {!stops.length && !ems.length && <div className="week-empty">{day === 'Sunday' ? 'No collection on Sunday' : 'No truck stops'}</div>}
            </div>
          );
        })}
      </div>
      {dropOff.length > 0 && <div className="panel-foot">{dropOff.map((z) => z.name).join(', ')}: no truck stop. Residents bring their garbage directly to the designated place.</div>}
    </section>
  );
}

export function ConflictCallout({ ops, points }) {
  const lines = {};
  for (const c of ops.conflicts(points)) {
    const key = `${c.a.name}|${c.b.name}`;
    (lines[key] ??= { days: [], text: `${c.a.name} (${c.a.window}) and ${c.b.name} (${c.b.window})` }).days.push(c.day.slice(0, 3));
  }
  if (!Object.keys(lines).length) return null;
  return (
    <div className="callout warn mb" role="note"><div><strong>Needs confirmation with the barangay:</strong> the barangay runs one truck, but these stops overlap: {Object.values(lines).map((l) => `${l.text} on ${l.days.join('/')}`).join('; ')}. The schedule is shown exactly as the barangay provided it. Adjust the stop times once the actual order is confirmed.</div></div>
  );
}

function PointsTable({ points, total, q, editable, onEdit }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr><th>Truck stop</th><th>Days</th><th>Time</th><th className="num">Standby</th><th>Serves</th><th>Location</th>{editable && <th />}</tr></thead>
        <tbody>
          {!points.length && total > 0 && <NoMatchRow colSpan={editable ? 7 : 6} q={q} />}
          {!total && <tr><td colSpan={editable ? 7 : 6}><Empty title="No truck stops yet" text="Run supabase/setup/04_data.sql to load the barangay's fixed schedule." /></td></tr>}
          {points.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong><div className="muted">{p.landmark}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>{p.days.length ? p.days.map((d) => d.slice(0, 3)).join(', ') : <span className="muted">None</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{p.window}</td>
              <td className="num">{p.standby ? `${p.standby} min` : '–'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{zonesShort(p.served)}</td>
              <td>{p.lat !== null
                ? <><span className={`chip ${p.confirmed ? 'done' : 'pending'}`}>{p.confirmed ? 'Confirmed' : 'Not yet confirmed'}</span><div className="muted">{p.source}</div>
                  <a href={gmapsFor(p)} target="_blank" rel="noopener noreferrer">Open in Google Maps</a></>
                : <span className="chip plain">Not set</span>}</td>
              {editable && <td className="actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(p.id)}><Icon name="edit" />Edit</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PointForm({ point, onDone, onCancel }) {
  const [f, setF] = useState(() => ({
    days: point.days, start: (point.start ?? '').slice(0, 5), end: (point.end ?? '').slice(0, 5), standby: point.standby ?? '',
    landmark: point.landmark, lat: point.lat ?? '', lng: point.lng ?? '', confirmed: point.confirmed, maps_url: point.raw_maps_url ?? '',
  }));
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const errs = [];
    const lat = String(f.lat).trim(), lng = String(f.lng).trim();
    if ((lat === '') !== (lng === '') || (lat !== '' && (Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))))) {
      errs.push('The location must be latitude and longitude in Iligan City (latitude first, e.g. 8.2275, 124.2383).');
    }
    let url = null;
    if (String(f.maps_url).trim() !== '') {
      url = cleanMapsUrl(f.maps_url);
      if (!url) errs.push('The Google Maps link must be a link copied from Google Maps (google.com/maps or maps.app.goo.gl).');
    }
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    const { error } = await supabase.rpc('update_collection_point', {
      p_id: point.id, p_days: f.days, p_start: f.start, p_end: f.end, p_standby: f.standby === '' ? null : Number(f.standby),
      p_landmark: f.landmark, p_lat: lat === '' ? null : Number(lat), p_lng: lng === '' ? null : Number(lng),
      p_confirmed: f.confirmed, p_set_maps: true, p_maps_url: url,
    });
    setBusy(false);
    if (error) { setErrors(error.message.split('\n')); return; }
    onDone('Truck stop saved. The zones it serves, the map and the mobile app schedule were updated.');
  };
  return (
    <section className="panel mb" id="pointForm" aria-labelledby="pointTitle">
      <div className="panel-head"><h2 id="pointTitle">Edit truck stop: {point.name}</h2><button type="button" className="panel-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={onCancel}>Cancel</button>
        <p>Serves {point.served.join(', ')}. The stop name and the zones it serves are fixed.</p></div>
      <form className="panel-body" onSubmit={save}>
        <Messages errors={errors} />
        <div className="form-grid">
          <fieldset className="field wide" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Days</legend>
            <div className="checks">{DAYS.slice(0, 6).map((d) => (
              <label key={d}><input type="checkbox" checked={f.days.includes(d)} onChange={(e) => setF((s) => ({ ...s, days: e.target.checked ? DAYS.filter((x) => x === d || s.days.includes(x)) : s.days.filter((x) => x !== d) }))} /> {d}</label>
            ))}</div>
          </fieldset>
          <div className="field"><label htmlFor="start_time">Truck arrives</label><input className="input" type="time" id="start_time" value={f.start} onChange={set('start')} required /></div>
          <div className="field"><label htmlFor="end_time">Truck leaves</label><input className="input" type="time" id="end_time" value={f.end} onChange={set('end')} required /></div>
          <div className="field"><label htmlFor="standby">Standby (minutes)</label><input className="input" type="number" min="5" max="240" id="standby" value={f.standby} onChange={set('standby')} /></div>
          <div className="field wide"><label htmlFor="landmark">Landmark</label><input className="input" id="landmark" maxLength={160} value={f.landmark} onChange={set('landmark')} /></div>
          <div className="field"><label htmlFor="latitude">Latitude</label><input className="input" id="latitude" inputMode="decimal" value={f.lat} onChange={set('lat')} /></div>
          <div className="field"><label htmlFor="longitude">Longitude</label><input className="input" id="longitude" inputMode="decimal" value={f.lng} onChange={set('lng')} /></div>
          <div className="field wide"><label htmlFor="maps_url">Google Maps link (optional)</label>
            <input className="input" type="text" inputMode="url" autoComplete="off" id="maps_url" maxLength={1000} placeholder="https://www.google.com/maps/..." value={f.maps_url} onChange={set('maps_url')} />
            <span className="hint">"Open in Google Maps" on the map opens this exact link, for example a Street View of where the truck parks. In Google Maps, open the spot and copy the address bar. If left blank, the link uses the latitude and longitude.</span></div>
          <div className="field wide"><label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={f.confirmed} onChange={set('confirmed')} /> The barangay has confirmed the truck parks at this exact spot</label>
            <span className="hint">Current location source: {point.source || 'none'}. In Google Maps, right-click the exact spot to copy its latitude and longitude.</span></div>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : 'Save truck stop'}</button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

function CrewPanel({ ops, onDone }) {
  const crew = ops.crew();
  const collectors = [...ops.fleet()].sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
  const [sel, setSel] = useState(crew.collector_id ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const id = sel === '' ? null : Number(sel);
    const { error } = await supabase.rpc('set_fixed_crew', { p_collector: id });
    setBusy(false);
    if (error) { toast(error.message, 'error'); return; }
    onDone(id ? 'Collector assigned to every fixed-schedule stop. It now shows in their mobile app.' : 'Fixed-schedule stops are now unassigned.');
  };
  return (
    <section className="panel mb" aria-labelledby="crewTitle">
      <div className="panel-head"><h2 id="crewTitle">Truck crew</h2><p>The barangay operates one truck. The collector chosen here gets every fixed-schedule stop in their mobile app.</p></div>
      <form className="panel-body inline-form" onSubmit={save}>
        <div className="field"><label htmlFor="crewSel">Collector</label>
          <select className="select" id="crewSel" value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Not assigned</option>
            {collectors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.truck ? ` (${c.truck})` : ' (no truck)'}</option>)}
          </select>
          {crew.mixed && <span className="hint">Stops are currently split between collectors. Saving assigns them all to one person.</span>}
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" />Assign to all stops</button>
      </form>
    </section>
  );
}

function ScheduleRecords({ ops }) {
  const [params, setParams] = useSearchParams();
  const f = {
    day: DAYS.includes(params.get('day')) ? params.get('day') : '',
    zone: Number(params.get('zone') || 0), status: ['Active', 'Inactive'].includes(params.get('status')) ? params.get('status') : '',
    collector: Number(params.get('collector') || 0),
  };
  const setFilter = (k) => (e) => { const n = new URLSearchParams(params); if (e.target.value && e.target.value !== '0') n.set(k, e.target.value); else n.delete(k); setParams(n, { replace: true }); };
  const todayState = Object.fromEntries(ops.dayItems(ops.clock.date).map((it) => [it.id, it.state]));
  const rows = ops.schedules(false).filter((r) => (!f.day || r.day === f.day) && (!f.zone || r.zone_id === f.zone)
    && (!f.status || r.status === f.status) && (!f.collector || r.collector_id === f.collector));
  const collectors = [...ops.fleet()].sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
  const stateCss = { completed: 'done', ongoing: 'ongoing', pending: 'pending', delayed: 'delayed' };
  const anyFilter = f.day || f.zone || f.status || f.collector;
  return (
    <>
      <div className="filters panel-body" style={{ paddingBottom: 0 }}>
        <div className="field"><label htmlFor="fDay">Day</label><select className="select" id="fDay" value={f.day} onChange={setFilter('day')}><option value="">All days</option>{DAYS.slice(0, 6).map((d) => <option key={d}>{d}</option>)}</select></div>
        <div className="field"><label htmlFor="fZone">Zone</label><select className="select" id="fZone" value={f.zone} onChange={setFilter('zone')}><option value="0">All zones</option>{ops.zones().map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></div>
        <div className="field"><label htmlFor="fCollector">Collector</label><select className="select" id="fCollector" value={f.collector} onChange={setFilter('collector')}><option value="0">All collectors</option>{collectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="fStatus">Status</label><select className="select" id="fStatus" value={f.status} onChange={setFilter('status')}><option value="">Any status</option><option>Active</option><option>Inactive</option></select></div>
        {anyFilter ? <button type="button" className="btn btn-ghost" onClick={() => setParams({}, { replace: true })}>Clear filters</button> : null}
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="tbl">
          <thead><tr><th>Day</th><th>Zone</th><th>Window</th><th>Waste</th><th>Collector · truck</th><th>Status</th><th>Today</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={7}><Empty title="No schedules match" text="Try clearing the filters." /></td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.day}</strong></td>
                <td><span style={{ color: r.color }}>●</span> {r.zone}</td>
                <td>{r.window}</td><td>{r.category}</td>
                <td>{r.collector}<div className="muted">{r.truck ?? 'No truck'}</div></td>
                <td><span className={`chip ${r.status === 'Active' ? 'brand' : ''}`}>{r.status || 'Unknown'}</span></td>
                <td>{todayState[r.id] ? <span className={`chip ${stateCss[todayState[r.id]] ?? ''}`}>{STATUS_LABELS[todayState[r.id]]}</span> : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Schedules() {
  const { role } = usePanel();
  const editable = role === 'barangay';
  const [params, setParams] = useSearchParams();
  const editId = Number(params.get('point') || 0);
  const [success, setSuccess] = useState('');
  const { data: ops, error, loading, reload } = useLoad(() => loadOps({ logsToday: true, emergency: true }), []);
  const points = useMemo(() => (ops ? ops.points(false) : []), [ops]);
  const editPoint = points.find((p) => p.id === editId) ?? null;
  const [q, setQ] = useSearchText();
  const shownPoints = points.filter((p) => matchesSearch(q, [p.name, p.landmark, p.zone, ...p.served, ...p.days, p.window, p.confirmed ? 'confirmed' : 'not yet confirmed']));
  const done = (msg) => { setSuccess(msg); const n = new URLSearchParams(params); n.delete('point'); setParams(n, { replace: true }); reload(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const edit = (id) => { setSuccess(''); const n = new URLSearchParams(params); n.set('point', id); setParams(n, { replace: true }); setTimeout(() => document.getElementById('pointForm')?.scrollIntoView({ behavior: 'smooth' }), 50); };

  return (
    <>
      <PageHead title="Collection schedule" desc={editable
        ? "Barangay Poblacion's fixed garbage collection schedule. The truck stands by at each stop while residents bring their garbage."
        : "Barangay Poblacion's fixed collection schedule. The truck stands by at each stop while residents bring their garbage."}>
        {editable && <Link className="btn btn-primary" to="/barangay/emergency?new=1"><Icon name="alert" />Schedule emergency collection</Link>}
      </PageHead>
      {!editable && <ReadonlyBanner>View only. The Barangay Admin manages the truck stops and crew.</ReadonlyBanner>}
      <Messages success={success} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !ops && <Loading />}
      {ops && (
        <>
          <ConflictCallout ops={ops} points={points} />
          <WeekView ops={ops} points={points} />
          <section className="panel mb" aria-labelledby="stopsTitle">
            <div className="panel-head"><h2 id="stopsTitle">Truck stops</h2>
              {editable && <span className="lock-note"><Icon name="lock" />Stops come from the barangay schedule</span>}
              <p>{editable ? "Changing a stop's days or time updates the zones it serves and what collectors and residents see in the app." : 'Where the truck parks and stands by while residents bring their garbage.'}</p></div>
            <SearchBar id="stopSearch" label="Search truck stops" value={q} onChange={setQ}
              placeholder="Search stop, landmark, zone or day" shown={shownPoints.length} total={points.length} />
            <PointsTable points={shownPoints} total={points.length} q={q} editable={editable} onEdit={edit} />
          </section>
          {editable && editPoint && <PointForm key={editPoint.id} point={editPoint} onDone={done} onCancel={() => { const n = new URLSearchParams(params); n.delete('point'); setParams(n, { replace: true }); }} />}
          {editable && <CrewPanel key={JSON.stringify(ops.crew())} ops={ops} onDone={done} />}
          <details className="panel mb">
            <summary className="panel-head" style={{ cursor: 'pointer', paddingBottom: 14 }}><h2 style={{ display: 'inline' }}>Schedule records</h2> <span className="note">({ops.schedules(false).length}) one per zone per day, read by the mobile apps</span></summary>
            <ScheduleRecords ops={ops} />
          </details>
        </>
      )}
    </>
  );
}

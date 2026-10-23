// Emergency collections (port of emergency.php + emergency_view.php).
// Barangay Admin arranges and tracks one-time pickups; the LGU Admin views.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, Messages, Modal, PageHead, ReadonlyBanner, SearchBar, useLoad } from '../components/common';
import { usePanel } from '../components/Layout';
import { EMERGENCY_STATUSES, loadOps } from '../lib/ops';
import { supabase } from '../lib/supabase';
import { addDays, fmtDate, fmtStamp } from '../lib/time';
import { esc, toast } from '../lib/ui';
import { createMap, loadBoundary } from '../lib/mapEngine';

const isClosed = (status) => status === 'Completed' || status === 'Cancelled';
const statusCss = (status, overdue) => (overdue ? 'delayed' : ({ Scheduled: 'pending', 'In progress': 'ongoing', Completed: 'done', Cancelled: '' }[status] ?? ''));

/** Click-to-place map, limited to Barangay Poblacion (Google Maps or the street map). */
function PickMap({ lat, lng, onPick, zones }) {
  const box = useRef(null);
  const eng = useRef(null);
  const pin = useRef(null);
  const pinLayer = useRef(null);
  const [ready, setReady] = useState(false);
  const pick = useRef(onPick);
  useEffect(() => { pick.current = onPick; });
  useEffect(() => {
    let alive = true, e = null, ro = null;
    createMap(box.current, { scrollZoom: false, alive: () => alive }).then(async (m) => {
      if (!m) return;
      if (!alive) { m.destroy(); return; }
      e = m; eng.current = m;
      const zl = m.group();
      for (const z of zones) {
        if (z.boundary.length > 2) m.polygon(zl, z.boundary, { color: z.color, weight: 1.5, fillOpacity: 0.12, dashed: true, label: esc(z.name) });
      }
      pinLayer.current = m.group();
      m.onClick((a, b) => pick.current(a.toFixed(6), b.toFixed(6)));
      ro = new ResizeObserver(() => m.resize()); ro.observe(box.current);
      try {
        const bd = await loadBoundary();
        if (alive) m.focusPoblacion(bd.extent, bd.pob, { fit: true });
      } catch { /* the map still works without the outline */ }
      if (alive) setReady(true);
    });
    return () => { alive = false; ro?.disconnect(); e?.destroy(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const m = eng.current;
    if (!m || !ready) return;
    const a = Number(lat), b = Number(lng);
    if (lat !== '' && lng !== '' && Number.isFinite(a) && Number.isFinite(b)) {
      if (pin.current) pin.current.setPosition(a, b);
      else { pin.current = m.marker(pinLayer.current, [a, b], { html: '<div class="em-pin">!</div>', size: [26, 26], anchor: [13, 13], zIndex: 900 }); m.setView(a, b, 17); }
    } else if (pin.current) { pin.current.setMap(null); pin.current = null; }
  }, [lat, lng, ready]);
  return <div ref={box} className="map-canvas pick-map" style={{ minHeight: 300, height: 300, border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginTop: 14, overflow: 'hidden' }} aria-label="Click to set the pickup location" />;
}

function EmergencyForm({ ops, editing, me, onDone, onCancel }) {
  const crew = ops.crew().collector_id;
  const [f, setF] = useState(() => ({
    collection_date: editing?.date ?? ops.clock.date, start_time: (editing?.start ?? '').slice(0, 5), end_time: (editing?.end ?? '').slice(0, 5),
    route_id: editing?.zone_id ?? '', location_text: editing?.location ?? '', reason: editing?.reason ?? '',
    garbage_collector_id: editing ? (editing.collector_id ?? '') : (crew ?? ''), latitude: editing?.lat ?? '', longitude: editing?.lng ?? '', notes: editing?.notes ?? '',
    status: editing?.status ?? 'Scheduled',
  }));
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const collectors = [...ops.fleet()].sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));

  const save = async (e) => {
    e.preventDefault();
    const lat = String(f.latitude).trim(), lng = String(f.longitude).trim();
    if (editing && !EMERGENCY_STATUSES.includes(f.status)) { setErrors(['Choose a status.']); return; }
    if (editing && isClosed(f.status) && !window.confirm(`Mark emergency collection #${editing.id} ${f.status}?\n\nAfter this it is locked and can no longer be edited.`)) return;
    const row = {
      collection_date: f.collection_date || null, start_time: f.start_time || null, end_time: f.end_time || null,
      route_id: f.route_id === '' ? null : Number(f.route_id), location_text: f.location_text, reason: f.reason,
      garbage_collector_id: f.garbage_collector_id === '' ? null : Number(f.garbage_collector_id),
      latitude: lat === '' ? null : Number(lat), longitude: lng === '' ? null : Number(lng), notes: f.notes,
      ...(editing ? { status: f.status } : {}),
    };
    setBusy(true);
    const res = editing
      ? await supabase.from('emergency_collection').update(row).eq('emergency_collection_id', editing.id)
      : await supabase.from('emergency_collection').insert({ ...row, created_by: me.id });
    setBusy(false);
    if (res.error) { setErrors(res.error.message.split('\n')); return; }
    onDone(editing ? (isClosed(f.status) ? `Emergency collection #${editing.id} marked ${f.status}. It is now locked.` : 'Emergency collection updated.') : `Emergency collection scheduled for ${fmtDate(f.collection_date, 'l, M j')}. It now shows on the dashboard, map and schedule.`);
  };

  return (
    <form className="modal-body" onSubmit={save}>
      <p className="muted modal-note">The barangay has one truck. Check the fixed schedule for that day so the pickup does not clash with a regular stop.</p>
      <Messages errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor="collection_date">Date</label><input className="input" type="date" id="collection_date" min={editing ? undefined : ops.clock.date} value={f.collection_date} onChange={set('collection_date')} required /></div>
        <div className="field"><label htmlFor="start_time">Truck arrives</label><input className="input" type="time" id="start_time" value={f.start_time} onChange={set('start_time')} required /></div>
        <div className="field"><label htmlFor="end_time">Until (optional)</label><input className="input" type="time" id="end_time" value={f.end_time} onChange={set('end_time')} /></div>
        <div className="field"><label htmlFor="route_id">Zone</label>
          <select className="select" id="route_id" value={f.route_id} onChange={set('route_id')}><option value="">Choose a zone…</option>{ops.zones().filter((z) => z.mode !== 'drop_off' || z.id === Number(f.route_id)).map((z) => <option key={z.id} value={z.id}>{z.name}{z.mode === 'drop_off' ? ' (drop-off, no route)' : ''}</option>)}</select>
          <span className="hint">Drop-off zones have no truck route and are not listed.</span></div>
        <div className="field wide"><label htmlFor="location_text">Where exactly</label><input className="input" id="location_text" maxLength={255} placeholder="e.g. corner of Zamora St. and Benito Labao St." value={f.location_text} onChange={set('location_text')} required /></div>
        <div className="field wide"><label htmlFor="reason">Reason</label><input className="input" id="reason" maxLength={255} placeholder="e.g. flood debris after heavy rain" value={f.reason} onChange={set('reason')} required /></div>
        <div className="field"><label htmlFor="garbage_collector_id">Collector</label>
          <select className="select" id="garbage_collector_id" value={f.garbage_collector_id} onChange={set('garbage_collector_id')}><option value="">Not assigned yet</option>
            {collectors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.truck ? ` (${c.truck})` : ''}</option>)}</select>
          <span className="hint">Their truck is recorded with the pickup.</span></div>
        {editing && (
          <div className="field"><label htmlFor="em_status">Status</label>
            <select className="select" id="em_status" value={f.status} onChange={set('status')}>
              {EMERGENCY_STATUSES.map((st) => <option key={st}>{st}</option>)}</select>
            <span className="hint">Completed or Cancelled locks it: it can no longer be edited.</span></div>
        )}
        <div className="field wide"><label htmlFor="notes">Notes (optional)</label><textarea className="textarea" id="notes" rows={2} value={f.notes} onChange={set('notes')} /></div>
      </div>
      <div className="pin-head">
        <span><strong>Pin on the map (optional)</strong> <span className="muted">Click the map where the truck should stop. It shows on the Live map and gives the collector directions.</span></span>
        {f.latitude !== '' && f.longitude !== '' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF((st) => ({ ...st, latitude: '', longitude: '' }))}><Icon name="x" />Clear pin</button>}
      </div>
      <PickMap lat={f.latitude} lng={f.longitude} zones={ops.zones()} onPick={(a, b) => setF((st) => ({ ...st, latitude: a, longitude: b }))} />
      <div className="modal-actions">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : editing ? 'Save changes' : 'Schedule collection'}</button>
      </div>
    </form>
  );
}

export default function Emergency() {
  const { role, me, refreshBadges } = usePanel();
  const editable = role === 'barangay';
  const [params, setParams] = useSearchParams();
  const view = ['open', 'upcoming', 'past', 'all'].includes(params.get('view')) ? params.get('view') : 'open';
  const editId = Number(params.get('edit') || 0);
  const showNew = editable && params.get('new') === '1';
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const { data: ops, error, loading, reload } = useLoad(() => loadOps({ emergency: true }), []);

  const go = (patch) => { const n = new URLSearchParams(params); for (const [k, v] of Object.entries(patch)) { if (v === null) n.delete(k); else n.set(k, v); } setParams(n, { replace: true }); };
  const done = (msg) => { setSuccess(msg); go({ new: null, edit: null }); reload(); refreshBadges(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  let rows = [], sum = null, editing = null, total = 0;
  if (ops) {
    const f = { order: 'asc' };
    if (view === 'open') f.status = 'open';
    if (view === 'upcoming') f.from = ops.clock.date;
    if (view === 'past') { f.to = addDays(ops.clock.date, -1); f.order = 'desc'; }
    if (view === 'all') { f.order = 'desc'; f.limit = 300; }
    rows = ops.emList(f);
    total = rows.length;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => [r.location, r.reason, r.notes, r.zone, r.collector, r.truck, r.status, r.overdue ? 'overdue' : '', r.created_by, fmtDate(r.date, 'D, M j'), r.date]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    sum = ops.emSummary(addDays(ops.clock.date, -29), addDays(ops.clock.date, 60));
    if (editable && editId) { editing = ops.emList({ id: editId })[0] ?? null; if (editing && isClosed(editing.status)) editing = null; }
  }
  const showForm = editable && ops && (editing || showNew);
  const onSearch = (v) => { setSearch(v); go({ q: v.trim() ? v : null }); };
  const remove = async (r) => {
    if (!window.confirm(`Delete emergency collection #${r.id} (${r.location}, ${fmtDate(r.date, 'D, M j')})?\n\nIt is removed from the week view, reports and residents' history. This cannot be undone.`)) return;
    const { data, error: err } = await supabase.from('emergency_collection').delete().eq('emergency_collection_id', r.id).select('emergency_collection_id');
    if (err || !data?.length) { toast(err?.message ?? 'Only completed or cancelled emergency collections can be deleted.', 'error'); return; }
    done(`Emergency collection #${r.id} was deleted.`);
  };

  return (
    <>
      <PageHead title="Emergency collections" desc={editable
        ? 'One-time pickups when garbage cannot wait for the fixed schedule, for example after a flood, a fiesta or an overflowing site.'
        : 'One-time pickups the barangay arranged outside the fixed schedule.'}>
        {editable && <button type="button" className="btn btn-primary" onClick={() => { setSuccess(''); go({ new: '1', edit: null }); }}><Icon name="plus" />Schedule emergency collection</button>}
      </PageHead>
      {!editable && <ReadonlyBanner>View only. Barangay Poblacion is responsible for emergency collections.</ReadonlyBanner>}
      <Messages success={success} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !ops && <Loading />}
      {editable && ops && (
        <Modal open={!!showForm} wide title={editing ? `Edit emergency collection #${editing.id}` : 'Schedule an emergency collection'} onClose={() => go({ new: null, edit: null })}>
          <EmergencyForm key={editing?.id ?? 'new'} ops={ops} editing={editing} me={me} onDone={done} onCancel={() => go({ new: null, edit: null })} />
        </Modal>
      )}
      {ops && (
        <>
          <div className="status-strip mb">
            <div className="status-cell cell-pending"><span className="lbl">Scheduled</span><span className="num">{sum.Scheduled}</span><span className="sub">Last 30 days and upcoming</span></div>
            <div className="status-cell cell-ongoing"><span className="lbl">In progress</span><span className="num">{sum['In progress']}</span><span className="sub">Truck on the way or collecting</span></div>
            <div className="status-cell cell-done"><span className="lbl">Completed</span><span className="num">{sum.Completed}</span><span className="sub">Last 30 days</span></div>
            <div className="status-cell cell-delayed"><span className="lbl">Overdue</span><span className="num">{sum.overdue}</span><span className="sub">Time passed, not marked done</span></div>
          </div>
          <section className="panel mb">
            <div className="panel-head"><h2>Emergency collections</h2>
              <div className="seg" role="group" aria-label="Show">
                {[['open', 'Not done yet'], ['upcoming', 'Today onward'], ['past', 'Past'], ['all', 'All']].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={view === k} onClick={() => go({ view: k })}>{l}</button>
                ))}
              </div>
              <p>One-time pickups outside the fixed schedule. They are reported separately and do not change the fixed-schedule completion rate.</p>
            </div>
            <SearchBar id="emSearch" label="Search emergency collections" value={search} onChange={onSearch}
              placeholder="Search place, reason, zone, collector, truck or status" shown={rows.length} total={total} />
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Date</th><th>Where</th><th>Reason</th><th>Collector · truck</th><th>Status</th>{editable ? <th aria-label="Actions" /> : <th>Arranged by</th>}</tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={6}>{search.trim()
                  ? <Empty icon="search" title="No matches" text={`Nothing in this view matches “${search.trim()}”. Try "All" or clear the search.`} />
                  : <Empty icon="alert" title="No emergency collections" text={editable ? 'Use “Schedule emergency collection” when garbage needs picking up outside the fixed schedule.' : 'The Barangay Admin has not arranged any for this view.'} />}</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{fmtDate(r.date, 'D, M j')}</strong><div className="muted">{r.window}</div></td>
                    <td>{r.location}<div className="muted"><span style={{ color: r.color }}>●</span> {r.zone}{r.lat !== null ? ' · on map' : ''}</div></td>
                    <td style={{ maxWidth: '32ch' }}>{r.reason}{r.notes && <div className="muted">{r.notes.length > 120 ? `${r.notes.slice(0, 119)}…` : r.notes}</div>}</td>
                    <td>{r.collector}<div className="muted">{r.truck ?? 'No truck'}</div></td>
                    <td><span className={`chip ${statusCss(r.status, r.overdue)}`}>{r.status}{r.overdue ? ' · overdue' : ''}</span>
                      {r.completed_at && <div className="muted">Done {fmtStamp(r.completed_at)}</div>}</td>
                    {editable
                      ? <td className="actions"><div className="btn-row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                          {isClosed(r.status)
                            ? <>
                                <span className="chip plain locked-chip" title={`${r.status} collections can no longer be edited`}><Icon name="lock" />Locked</span>
                                <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(r)} aria-label={`Delete emergency collection #${r.id}`}><Icon name="trash" />Delete</button>
                              </>
                            : <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSuccess(''); go({ edit: r.id, new: null }); }}><Icon name="edit" />Edit</button>}
                        </div></td>
                      : <td>{r.created_by}<div className="muted">{fmtStamp(r.created_at)}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </>
      )}
    </>
  );
}

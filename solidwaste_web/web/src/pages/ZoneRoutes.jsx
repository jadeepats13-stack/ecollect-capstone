// Zones & routes (port of routes.php + includes/zones.php). The 10 zones are permanent;
// the Barangay Admin saves each zone's route path (and days/times for zones not served by a truck stop).
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, Messages, PageHead, ReadonlyBanner, useLoad } from '../components/common';
import ZoneMapPanel from '../components/ZoneMapPanel';
import { usePanel } from '../components/Layout';
import { loadOps, pathToText } from '../lib/ops';
import { supabase, must } from '../lib/supabase';
import { DAYS } from '../lib/time';
import { FIXED_ZONE_COUNT } from '../config';
import { createMap, loadBoundary, mapLook } from '../lib/mapEngine';
import { esc } from '../lib/ui';

const badge = (color) => ({ display: 'inline-grid', width: 22, height: 22, fontSize: 11, verticalAlign: -5, marginRight: 6, background: color });

/** Point-in-polygon against the PSA/NAMRIA Poblacion boundary (null if the file is unavailable). */
let ringCache = null;
async function boundaryRing() {
  if (ringCache) return ringCache;
  try {
    const g = await (await fetch('/data/poblacion_boundary.geojson')).json();
    const f = g.features.find((x) => x.properties.kind === 'barangay_boundary');
    ringCache = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
  } catch { ringCache = []; }
  return ringCache;
}
function inside(ring, lat, lng) {
  let ok = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi) ok = !ok;
  }
  return ok;
}

/**
 * One route point from text. Accepts decimal ("8.229444, 124.235722") and the degrees-minutes-seconds
 * form Google Maps shows in Street View ("8°13'46.0"N 124°14'08.6"E"). Returns [lat, lng] or null.
 */
function parsePoint(text) {
  const t = String(text).trim();
  const dec = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/) ?? t.match(/^(-?\d+\.\d+)\s+(-?\d+\.\d+)$/);
  if (dec) return [Number(dec[1]), Number(dec[2])];
  const part = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″”]|'')?\s*([NSEW])`;
  const dms = t.match(new RegExp(`^${part}[\\s,]+${part}$`, 'i'));
  if (!dms) return null;
  const val = (d, m, sec, h) => (Number(d) + Number(m) / 60 + Number(sec) / 3600) * (/[SW]/i.test(h) ? -1 : 1);
  const a = { v: val(dms[1], dms[2], dms[3], dms[4]), h: dms[4].toUpperCase() };
  const b = { v: val(dms[5], dms[6], dms[7], dms[8]), h: dms[8].toUpperCase() };
  const lat = /[NS]/.test(a.h) ? a.v : b.v, lng = /[NS]/.test(a.h) ? b.v : a.v;
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}
/** The route text box -> { points, bad } (points in driving order; bad = pieces that could not be read). */
function parseRoute(text) {
  const pieces = String(text ?? '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
  const points = [], bad = [];
  pieces.forEach((piece, n) => { const p = parsePoint(piece); if (p) points.push(p); else bad.push({ n: n + 1, piece }); });
  return { points, bad };
}
const fmtPoint = ([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`;

/** Click-to-draw route map: each click adds the next point in driving order. */
function RouteDrawMap({ zone, zones, points, onAdd }) {
  const look = mapLook(usePanel()?.role);
  const box = useRef(null);
  const eng = useRef(null);
  const line = useRef(null);
  const [ready, setReady] = useState(false);
  const add = useRef(onAdd);
  useEffect(() => { add.current = onAdd; });
  useEffect(() => {
    let alive = true, e = null, ro = null;
    createMap(box.current, { ...look, scrollZoom: true, alive: () => alive }).then(async (m) => {
      if (!m) return;
      if (!alive) { m.destroy(); return; }
      e = m; eng.current = m;
      const zl = m.group();
      for (const z of zones) {
        if (z.boundary.length > 2) {
          const mine = z.id === zone.id;
          m.polygon(zl, z.boundary, { color: z.color, weight: mine ? 3 : 1, fillOpacity: mine ? 0.18 : 0.04, dashed: !mine, label: esc(z.name) });
        }
      }
      line.current = m.group();
      m.onClick((a, b) => add.current([Number(Number(a).toFixed(6)), Number(Number(b).toFixed(6))]));
      ro = new ResizeObserver(() => m.resize()); ro.observe(box.current);
      try {
        const bd = await loadBoundary(look.boundaryUrl);
        if (alive) m.focusPoblacion(bd.extent, bd.pob, { fit: true });
      } catch { /* the map still works without the outline */ }
      if (alive && zone.boundary.length > 2) m.fit(zone.boundary, 30);
      if (alive) setReady(true);
    });
    return () => { alive = false; ro?.disconnect(); e?.destroy(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const m = eng.current;
    if (!m || !ready) return;
    line.current.clear();
    if (points.length > 1) m.polyline(line.current, points, { color: zone.color, weight: 5, opacity: 0.9, zIndex: 6 });
    points.forEach((p, i) => {
      const last = i === points.length - 1;
      m.marker(line.current, p, { html: `<div class="route-dot${i === 0 ? ' first' : ''}${last ? ' last' : ''}" style="--c:${zone.color}">${i + 1}</div>`, size: [22, 22], anchor: [11, 11], zIndex: 800 + i });
    });
  }, [points, ready, zone.color]);
  return <div ref={box} className="map-canvas route-map" aria-label={`Click along the streets to draw the route for ${zone.name}`} />;
}

function RouteForm({ zone, zones, locked, onDone, onCancel }) {
  const [f, setF] = useState({ path: pathToText(zone.path), days: zone.days, start: (zone.start ?? '').slice(0, 5), end: (zone.end ?? '').slice(0, 5) });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const parsed = parseRoute(f.path);
  const setPoints = (pts) => setF((s) => ({ ...s, path: pts.map(fmtPoint).join('; ') }));
  const save = async (e) => {
    e.preventDefault();
    const errs = parsed.bad.map(({ n, piece }) => `Route point ${n} ("${piece.length > 40 ? `${piece.slice(0, 39)}…` : piece}") could not be read. Use 8.229444,124.235722 or 8°13'46.0"N 124°14'08.6"E.`);
    if (parsed.points.length === 1) errs.push('A route needs at least 2 points. Click the map again where the truck goes next.');
    if (errs.length) { setErrors(errs); return; }
    const path = parsed.points.length ? parsed.points.map(([latitude, longitude]) => ({ latitude, longitude })) : null;
    setBusy(true);
    const { data: warns, error } = await supabase.rpc('update_zone_route', {
      p_route_id: zone.id, p_path: path, p_days: f.days, p_start: f.start, p_end: f.end,
    });
    if (error) { setBusy(false); setErrors(error.message.split('\n')); return; }
    const warnings = [...(warns ?? [])];
    if (path?.length) {
      const ring = await boundaryRing();
      const outside = ring.length ? path.filter((p) => !inside(ring, p.latitude, p.longitude)).length : 0;
      if (outside) warnings.push(`${outside} route point(s) fall outside the PSA/NAMRIA Poblacion boundary. That is fine for roads along the edge; otherwise check them.`);
    }
    setBusy(false);
    onDone(`Saved the route for ${zone.name}.`, warnings);
  };
  return (
    <section className="panel mb" aria-labelledby="editTitle">
      <div className="panel-head">
        <h2 id="editTitle"><span className="zone-badge" style={{ display: 'inline-grid', verticalAlign: -6, marginRight: 8, background: zone.color }}>{zone.number ?? '?'}</span>Edit route for {zone.name}</h2>
        <button type="button" className="panel-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={onCancel}>Cancel</button>
      </div>
      <form className="panel-body" onSubmit={save}>
        <Messages errors={errors} />
        <div className="form-grid">
          <div className="field"><span className="label">Zone</span><input className="input" value={zone.name} readOnly aria-describedby="zoneLock" />
            <span className="lock-note" id="zoneLock"><Icon name="lock" />Zone names and numbers are fixed.</span></div>
          {locked ? (
            <div className="field wide"><span className="label">Days and time</span>
              <input className="input" readOnly value={zone.mode === 'drop_off' ? 'Drop-off zone: residents bring garbage to the designated place' : `${zone.days.length ? zone.days.join(', ') : 'No days'}, ${zone.window}`} />
              <span className="lock-note"><Icon name="lock" />{zone.mode === 'drop_off' ? 'No truck stop for this zone.' : 'Set by the truck stops on the Collection schedule page.'}</span></div>
          ) : (
            <>
              <div className="field"><label htmlFor="start_time">Window starts</label><input className="input" type="time" id="start_time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
              <div className="field"><label htmlFor="end_time">Window ends</label><input className="input" type="time" id="end_time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
              <fieldset className="field wide" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="label" style={{ marginBottom: 6 }}>Collection days</legend>
                <div className="checks">{DAYS.slice(0, 6).map((d) => (
                  <label key={d}><input type="checkbox" checked={f.days.includes(d)} onChange={(e) => setF((s) => ({ ...s, days: e.target.checked ? DAYS.filter((x) => x === d || s.days.includes(x)) : s.days.filter((x) => x !== d) }))} /> {d}</label>
                ))}</div>
                <span className="hint">Schedules can only be created on these days. Sunday has no collection.</span>
              </fieldset>
            </>
          )}
          <div className="field wide">
            <div className="route-head">
              <span className="label">Draw the route</span>
              <span className="route-tools">
                <span className="note">{parsed.points.length} point{parsed.points.length === 1 ? '' : 's'}</span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!parsed.points.length} onClick={() => setPoints(parsed.points.slice(0, -1))}><Icon name="refresh" />Undo last point</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!f.path.trim()} onClick={() => setPoints([])}><Icon name="trash" />Clear</button>
              </span>
            </div>
            <span className="hint">Click along the streets in the order the truck drives, from where it enters {zone.name} to where it leaves. Point 1 is the start.</span>
            <RouteDrawMap zone={zone} zones={zones} points={parsed.points} onAdd={(p) => setPoints([...parsed.points, p])} />
          </div>
          <div className="field wide"><label htmlFor="path_coordinates">Route points (filled in by the map)</label>
            <textarea className="textarea" id="path_coordinates" rows={3} placeholder="Click the map above, or paste points here" spellCheck={false} value={f.path} onChange={(e) => setF({ ...f, path: e.target.value })} />
            <span className="hint">{'You can also paste points from Google Maps, separated by semicolons, in either form: 8.229444,124.235722 or 8°13\'46.0"N 124°14\'08.6"E. Leave empty if the route has not been surveyed.'}</span></div>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" />Save route</button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

export default function ZoneRoutes() {
  const { role } = usePanel();
  const editable = role === 'barangay';
  const [params, setParams] = useSearchParams();
  const editId = Number(params.get('edit') || 0);
  const highlight = Number(params.get('zone') || 0);
  const [msgs, setMsgs] = useState({ success: '', info: [] });
  const [mapKey, setMapKey] = useState(0);
  const { data, error, loading, reload } = useLoad(async () => {
    const [ops, cpz, residents] = await Promise.all([
      loadOps({}),
      supabase.from('collection_point_zone').select('route_id'),
      supabase.from('resident').select('route_id'),
    ]);
    return { ops, lockedZones: new Set(must(cpz).map((r) => r.route_id)), residents: must(residents) };
  }, []);

  const ops = data?.ops;
  const zones = ops ? ops.zones() : [];
  const check = ops?.zoneIntegrity();
  const count = (list, key) => list.reduce((m, r) => { if (r[key] !== null) m[r[key]] = (m[r[key]] ?? 0) + 1; return m; }, {});
  const schedCount = ops ? count(ops.schedules(true), 'zone_id') : {};
  const colCount = ops ? count(ops.fleet(), 'zone_id') : {};
  const resCount = data ? count(data.residents, 'route_id') : {};
  const editing = editable && editId ? zones.find((z) => z.id === editId) : null;
  const locked = editing ? editing.mode === 'drop_off' || data.lockedZones.has(editing.id) : false;
  const setEdit = (id) => { const n = new URLSearchParams(params); if (id) n.set('edit', id); else n.delete('edit'); setParams(n, { replace: true }); };

  return (
    <>
      <PageHead title="Zones & routes" desc={editable
        ? `Poblacion's ${FIXED_ZONE_COUNT} collection zones are permanent. Their days and times come from the truck stops on the Collection schedule page; here you can save the route the truck follows in each zone.`
        : `The ${FIXED_ZONE_COUNT} permanent collection zones of Barangay Poblacion and their routes.`} />
      {!editable && <ReadonlyBanner>View only. Zones are fixed; their days, times and routes are set by the Barangay Admin.</ReadonlyBanner>}
      {check && !check.ok && (editable
        ? <div className="callout danger mb" role="alert"><div><strong>The zone records need review.</strong> {check.problems.join(' ')} Zones cannot be added or removed here. Report this to your system administrator; no data was changed.</div></div>
        : <div className="callout danger mb" role="alert"><div><strong>Zone records are inconsistent.</strong> {check.problems.join(' ')} No data was changed.</div></div>)}
      <Messages success={msgs.success} />
      {msgs.info.map((m, i) => <div className="flash-stack" key={i}><div className="alert alert-info" role="status"><p>{m}</p></div></div>)}
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {editing && <RouteForm key={editing.id} zone={editing} zones={zones} locked={locked} onCancel={() => setEdit(0)}
        onDone={(msg, warnings) => { setMsgs({ success: msg, info: warnings }); const n = new URLSearchParams(); n.set('zone', editing.id); setParams(n, { replace: true }); reload(); setMapKey((k) => k + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
      {ops && (
        <section className="panel mb" aria-labelledby="zonesTitle">
          {editable && <div className="panel-head"><h2 id="zonesTitle">The {FIXED_ZONE_COUNT} zones</h2><span className="lock-note"><Icon name="lock" />Zones cannot be added, renamed or deleted</span></div>}
          <div className="table-wrap" style={editable ? { marginTop: 10 } : undefined}>
            <table className="tbl">
              <thead><tr><th>Zone</th><th>Collection days</th><th>Window</th><th>Route on map</th><th className="num">Active schedules</th>
                {editable ? <><th className="num">Collectors</th><th className="num">Residents</th><th /></> : <th>Set by</th>}</tr></thead>
              <tbody>
                {!zones.length && <tr><td colSpan={8}><Empty icon="zones" title="No zones found" text="The route table is empty. The 10 zone records must be restored by your system administrator." /></td></tr>}
                {zones.map((z) => (
                  <tr key={z.id} style={highlight === z.id ? { background: 'var(--brand-soft)' } : undefined}>
                    <td><span className="zone-badge" style={badge(z.color)}>{z.number ?? '?'}</span><strong>{z.name}</strong></td>
                    <td>{z.days.length ? (editable ? z.days.map((d) => d.slice(0, 3)).join(', ') : z.days.join(', ')) : <span className="muted">Not set</span>}</td>
                    <td>{z.window}</td>
                    <td>{z.path.length > 1 ? <span className="chip done">{z.path.length} points</span> : <span className="chip plain">Not saved</span>}</td>
                    <td className="num">{schedCount[z.id] ?? 0}</td>
                    {editable
                      ? <><td className="num">{colCount[z.id] ?? 0}</td><td className="num">{resCount[z.id] ?? 0}</td>
                        <td className="actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMsgs({ success: '', info: [] }); setEdit(z.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="edit" />Edit route</button></td></>
                      : <td>{z.admin || '–'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <ZoneMapPanel key={mapKey} title="Routes on the map" desc={editable ? 'Saved route paths for each zone, drawn over the zone areas.' : 'Saved route paths for each zone, drawn over the zone areas. View only.'} live={false} />
    </>
  );
}

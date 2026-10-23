// Trucks. The Barangay Admin manages the fleet and assigns each truck its collectors and their zones;
// the LGU Admin views it. (A collector has one truck and one home zone: garbage_collector.truck_id / route_id.)
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, Modal, NoMatchRow, PageHead, ReadonlyBanner, SearchBar, useLoad, useSearchText } from '../components/common';
import { usePanel } from '../components/Layout';
import { loadOps } from '../lib/ops';
import { supabase, explain } from '../lib/supabase';
import { confirmDialog } from '../lib/ui';

const STATE_CHIP = { live: ['ongoing', 'Live GPS'], scheduled: ['done', 'Scheduled today'], idle: ['', 'Idle today'], unassigned: ['plain', 'No crew'] };
const EMPTY_FORM = { key: null, plate: '', cap: '', crew: {} };

export default function Trucks() {
  const { role } = usePanel();
  const editable = role === 'barangay';
  const [params, setParams] = useSearchParams();
  const editId = Number(params.get('edit') || 0);
  const adding = editable && params.get('add') === '1';
  const { data: ops, error, loading, reload } = useLoad(() => loadOps({ logsToday: true }), []);
  const trucks = ops?.trucks() ?? [];
  const [q, setQ] = useSearchText();
  const shownTrucks = trucks.filter((t) => matchesSearch(q, [t.plate, ...t.crew, ...t.zones, STATE_CHIP[t.state]?.[1]]));
  const fleet = ops?.fleet() ?? [];
  const zones = ops?.zones() ?? [];
  const editing = editable && editId ? ops?.d.trucks.find((t) => t.truck_id === editId) ?? null : null;
  const key = editing ? editing.truck_id : adding ? 'new' : null;
  const [form, setForm] = useState(EMPTY_FORM);
  const [msg, setMsg] = useState({ success: '', errors: [] });
  const [formErrors, setFormErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  // crew: { [collectorId]: zoneId } for the collectors on this truck
  if (ops && form.key !== key) {
    setFormErrors([]);
    const crew = {};
    if (editing) for (const c of fleet) if (c.truck_id === editing.truck_id) crew[c.id] = c.zone_id ?? '';
    setForm({ key, plate: editing?.plate_number ?? '', cap: editing?.max_capacity_kg ?? '', crew });
  }
  const open = (which) => {
    const n = new URLSearchParams(params);
    n.delete('edit'); n.delete('add');
    if (which === 'add') n.set('add', '1'); else if (which) n.set('edit', which);
    setParams(n, { replace: true });
  };
  const close = () => open(null);
  const toggleCrew = (c) => setForm((f) => {
    const crew = { ...f.crew };
    if (c.id in crew) delete crew[c.id]; else crew[c.id] = c.zone_id ?? '';
    return { ...f, crew };
  });
  const setZone = (id, z) => setForm((f) => ({ ...f, crew: { ...f.crew, [id]: z } }));
  const crewList = fleet.filter((c) => c.id in form.crew);
  const others = fleet.filter((c) => !(c.id in form.crew));

  const save = async (e) => {
    e.preventDefault();
    const plate = form.plate.trim().toUpperCase();
    const cap = Number(form.cap);
    const errs = [];
    if (!plate || plate.length > 20) errs.push('Enter the plate number (up to 20 characters).');
    if (!(cap > 0 && cap <= 100000)) errs.push('Enter the maximum load in kilograms (a positive number).');
    if (ops.d.trucks.some((t) => String(t.plate_number).toUpperCase() === plate && t.truck_id !== editing?.truck_id)) errs.push('A truck with that plate number already exists.');
    for (const [id, z] of Object.entries(form.crew)) {
      if (!ops.zoneById(Number(z))) errs.push(`Choose a zone for ${fleet.find((c) => c.id === Number(id))?.name ?? 'each collector'}.`);
    }
    if (errs.length) { setFormErrors(errs); return; }
    setBusy(true);
    const row = { plate_number: plate, max_capacity_kg: cap };
    const res = editing
      ? await supabase.from('truck').update(row).eq('truck_id', editing.truck_id).select('truck_id').single()
      : await supabase.from('truck').insert(row).select('truck_id').single();
    if (res.error) { setBusy(false); setFormErrors([explain(res.error)]); return; }
    const truckId = res.data.truck_id;

    // Crew: collectors ticked get this truck and their zone; collectors unticked leave it.
    const failed = [];
    for (const c of fleet) {
      const on = c.id in form.crew;
      const zone = on ? Number(form.crew[c.id]) : null;
      let change = null;
      if (on && (c.truck_id !== truckId || c.zone_id !== zone)) change = { truck_id: truckId, route_id: zone };
      else if (!on && c.truck_id === truckId) change = { truck_id: null };
      if (!change) continue;
      const { error: err } = await supabase.from('garbage_collector').update(change).eq('garbage_collector_id', c.id);
      if (err) failed.push(`${c.name}: ${explain(err)}`);
    }
    setBusy(false);
    const n = Object.keys(form.crew).length;
    setMsg(failed.length
      ? { success: '', errors: ['The truck was saved, but some crew changes were not:', ...failed] }
      : { success: `${editing ? 'Truck updated' : 'Truck added'}${n ? ` with ${n} collector${n > 1 ? 's' : ''}` : ''}. Collectors see it in the app the next time it refreshes.`, errors: [] });
    setForm(EMPTY_FORM);
    close();
    reload();
  };

  const remove = async (t) => {
    const ok = await confirmDialog({
      title: `Remove truck ${t.plate}?`,
      message: t.crew.length ? `${t.crew.join(', ')} will be left without a truck until you assign them another one.` : 'This truck has no crew.',
      action: 'Remove truck',
    });
    if (!ok) return;
    const { error: err } = await supabase.from('truck').delete().eq('truck_id', t.id);
    setMsg(err ? { success: '', errors: [explain(err)] } : { success: 'Truck removed. Its collectors now have no truck assigned.', errors: [] });
    if (editId === t.id) close();
    reload();
  };

  return (
    <>
      <PageHead title="Trucks" desc={editable
        ? 'The collection fleet. Add trucks and choose which collectors drive each one and the zone each collector covers.'
        : 'The collection fleet, its crew and zones, and what each truck is doing today.'}>
        {editable && <button type="button" className="btn btn-primary" onClick={() => { setMsg({ success: '', errors: [] }); open('add'); }}><Icon name="plus" />Add truck</button>}
      </PageHead>
      {!editable && <ReadonlyBanner>View only. The Barangay Admin manages the trucks and assigns collectors and zones.</ReadonlyBanner>}
      <Messages success={msg.success} errors={msg.errors} />
      {error && <LoadError message={error} onRetry={reload} />}
      {ops && editable && (
        <Modal open={key !== null} title={editing ? `Edit ${editing.plate_number}` : 'Add a truck'} onClose={close}>
            <form className="modal-body" onSubmit={save}>
              <Messages errors={formErrors} />
              <div className="form-grid">
                <div className="field"><label htmlFor="plate_number">Plate number</label>
                  <input className="input" id="plate_number" maxLength={20} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} required /></div>
                <div className="field"><label htmlFor="max_capacity_kg">Maximum load (kg)</label>
                  <input className="input" type="number" min="1" step="0.01" id="max_capacity_kg" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} required /></div>
              </div>

              <h3 className="crew-title">Crew on this truck</h3>
              {!fleet.length ? <p className="muted">No collectors yet. Add them on the Garbage collectors page, then assign them here.</p> : (
                <>
                  {crewList.length ? (
                    <ul className="crew-list">
                      {crewList.map((c) => (
                        <li key={c.id}>
                          <span className="crew-name"><strong>{c.name}</strong>
                            {c.truck_id && c.truck_id !== editing?.truck_id ? <span className="muted">Moves here from {c.truck}</span> : null}</span>
                          <label className="sr-only" htmlFor={`zone-${c.id}`}>Zone {c.name} covers</label>
                          <select className="select" id={`zone-${c.id}`} value={form.crew[c.id]} onChange={(e) => setZone(c.id, e.target.value)}>
                            <option value="">Choose the zone…</option>
                            {zones.filter((z) => z.mode !== 'drop_off' || z.id === Number(form.crew[c.id])).map((z) => (
                              <option key={z.id} value={z.id}>{z.name}{z.mode === 'drop_off' ? ' (drop-off, no route)' : ''}</option>))}
                          </select>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleCrew(c)} aria-label={`Take ${c.name} off this truck`}><Icon name="x" />Remove</button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted crew-empty">No collectors on this truck yet.</p>}
                  {others.length ? (
                    <div className="field crew-add">
                      <label htmlFor="crew-add">Add a collector</label>
                      <select className="select" id="crew-add" value="" onChange={(e) => { const c = fleet.find((x) => x.id === Number(e.target.value)); if (c) toggleCrew(c); }}>
                        <option value="">Choose a collector…</option>
                        {others.map((c) => <option key={c.id} value={c.id}>{c.name} {c.truck ? `(now on ${c.truck})` : '(no truck yet)'}</option>)}
                      </select>
                      <span className="hint">A collector drives one truck. Adding someone who is on another truck moves them here.</span>
                    </div>
                  ) : null}
                </>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : editing ? 'Save changes' : 'Add truck'}</button>
              </div>
            </form>
        </Modal>
      )}
      {loading && !ops && <Loading />}
      {ops && (
        <section className="panel mb">
          <SearchBar id="truckSearch" label="Search trucks" value={q} onChange={setQ}
            placeholder="Search plate, collector, zone or status" shown={shownTrucks.length} total={trucks.length} />
          <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Plate</th><th className="num">Max load</th><th>Crew</th><th>Zones</th><th>Today</th><th>Status</th>{editable && <th />}</tr></thead>
          <tbody>
            {!trucks.length && <tr><td colSpan={editable ? 7 : 6}><Empty icon="truck" title="No trucks yet" text={editable ? 'Use “Add truck” to add the fleet’s trucks.' : 'The Barangay Admin has not added trucks yet.'} /></td></tr>}
            {!shownTrucks.length && trucks.length > 0 && <NoMatchRow colSpan={editable ? 7 : 6} q={q} />}
            {shownTrucks.map((t) => {
              const [css, label] = STATE_CHIP[t.state];
              return (
                <tr key={t.id}>
                  <td><strong>{t.plate}</strong></td>
                  <td className="num">{t.capacity !== null ? `${t.capacity.toLocaleString('en-PH')} kg` : '–'}</td>
                  <td>{t.crew.length ? t.crew.join(', ') : <span className="muted">None</span>}</td>
                  <td>{t.zones.length ? t.zones.join(', ') : '–'}</td>
                  <td>{t.today_total ? `${t.today_done} of ${t.today_total} pickups` : <span className="muted">None</span>}</td>
                  <td><span className={`chip ${css}`}>{label}</span><div className="muted">GPS {t.last_seen}</div></td>
                  {editable && (
                    <td className="actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMsg({ success: '', errors: [] }); open(t.id); }}><Icon name="edit" />Edit</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(t)}><Icon name="trash" />Remove</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table></div></section>
      )}
    </>
  );
}

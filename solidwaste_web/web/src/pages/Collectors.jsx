// Garbage collectors (port of collectors.php). Barangay Admin manages accounts (through the
// manage-staff Edge Function, which creates the mobile-app login); the LGU Admin views.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, NoMatchRow, PageHead, ReadonlyBanner, SearchBar, useLoad, useSearchText } from '../components/common';
import { usePanel } from '../components/Layout';
import { loadOps } from '../lib/ops';
import { manageStaff } from '../lib/supabase';
import { confirmDialog, toast } from '../lib/ui';

const GPS_CSS = { live: 'ongoing', recent: 'pending', stale: '', none: 'plain' };
const gpsText = (g) => (g === 'none' ? 'Never sent' : g === 'stale' ? 'Old' : g.charAt(0).toUpperCase() + g.slice(1));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CollectorForm({ ops, editing, onDone, onCancel }) {
  const [f, setF] = useState({
    first_name: editing?.first_name ?? '', last_name: editing?.last_name ?? '', email: editing?.email ?? '', password: '',
    route_id: editing?.zone_id ?? '', truck_id: editing?.truck_id ?? '',
  });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const trucks = ops.d.trucks ?? [];
  const needsLogin = !editing || !editing.has_login;

  const save = async (e) => {
    e.preventDefault();
    const errs = [];
    const first = f.first_name.trim(), last = f.last_name.trim(), email = f.email.trim();
    if (!first || !last || first.length > 50 || last.length > 50) errs.push('Enter a first and last name (up to 50 characters each).');
    if (!EMAIL_RE.test(email) || email.length > 100) errs.push('Enter a valid email address. The collector signs in to the mobile app with it.');
    if (!ops.zoneById(Number(f.route_id))) errs.push("Choose the collector's zone.");
    if (!trucks.some((t) => t.truck_id === Number(f.truck_id))) errs.push('Choose a truck. Add trucks on the Trucks page.');
    if (needsLogin && f.password.length < 8) errs.push(editing ? 'This collector has no mobile-app login yet. Set a password of at least 8 characters to create it.' : 'Set a password of at least 8 characters.');
    else if (f.password !== '' && f.password.length < 8) errs.push('A new password must be at least 8 characters.');
    if (ops.fleet().some((c) => c.email?.toLowerCase() === email.toLowerCase() && c.id !== editing?.id)) errs.push('Another collector already uses that email address.');
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    try {
      const body = { role: 'garbage_collector', first_name: first, last_name: last, email, route_id: Number(f.route_id), truck_id: Number(f.truck_id) };
      if (editing && editing.has_login) {
        await manageStaff({ ...body, action: 'update', id: editing.id, password: f.password });
      } else {
        // New account, or an imported collector without a login yet (the function links the existing row by email).
        if (editing && email.toLowerCase() !== String(editing.email).toLowerCase()) await manageStaff({ ...body, action: 'update', id: editing.id, email });
        const r = await manageStaff({ ...body, action: 'create', password: f.password });
        if (r.linked) toast('That email already had an ECollect login, so it was linked. It keeps its current password.');
      }
      onDone(editing ? 'Collector updated.' : 'Collector account created. They can now sign in to the ECollect mobile app.');
    } catch (err) {
      setErrors([err.message]);
      setBusy(false);
    }
  };

  return (
    <section className="panel mb" aria-labelledby="formTitle">
      <div className="panel-head"><h2 id="formTitle">{editing ? `Edit ${editing.name}` : 'Add a collector'}</h2>
        <button type="button" className="panel-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={onCancel}>Cancel</button></div>
      <form className="panel-body" onSubmit={save}>
        <Messages errors={errors} />
        <div className="form-grid">
          <div className="field"><label htmlFor="first_name">First name</label><input className="input" id="first_name" maxLength={50} value={f.first_name} onChange={set('first_name')} required /></div>
          <div className="field"><label htmlFor="last_name">Last name</label><input className="input" id="last_name" maxLength={50} value={f.last_name} onChange={set('last_name')} required /></div>
          <div className="field"><label htmlFor="email">Email (mobile app sign-in)</label><input className="input" type="email" id="email" maxLength={100} autoComplete="off" value={f.email} onChange={set('email')} required /></div>
          <div className="field"><label htmlFor="password">{needsLogin ? 'Password' : 'New password'}</label>
            <input className="input" type="password" id="password" minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} required={needsLogin} />
            <span className="hint">{needsLogin ? (editing ? 'No mobile-app login yet. Setting a password creates it.' : 'At least 8 characters.') : 'Leave blank to keep the current password.'}</span></div>
          <div className="field"><label htmlFor="route_id">Home zone</label>
            <select className="select" id="route_id" value={f.route_id} onChange={set('route_id')} required><option value="">Choose a zone…</option>
              {ops.zones().map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></div>
          <div className="field"><label htmlFor="truck_id">Truck</label>
            <select className="select" id="truck_id" value={f.truck_id} onChange={set('truck_id')} required><option value="">Choose a truck…</option>
              {trucks.map((t) => <option key={t.truck_id} value={t.truck_id}>{t.plate_number}</option>)}</select>
            {!trucks.length && <span className="hint">No trucks yet. Add them on the Trucks page.</span>}</div>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </section>
  );
}

export default function Collectors() {
  const { role } = usePanel();
  const editable = role === 'barangay';
  const [params, setParams] = useSearchParams();
  const edit = params.get('edit');
  const [msg, setMsg] = useState({ success: '', errors: [] });
  const { data: ops, error, loading, reload } = useLoad(() => loadOps({ logsToday: true }), []);
  const fleet = ops ? ops.fleet() : [];
  const [q, setQ] = useSearchText();
  const shown = fleet.filter((c) => matchesSearch(q, [c.name, c.email, c.zone, c.truck, c.truck ? '' : 'no truck', c.has_login ? '' : 'no login yet']));
  const editing = editable && edit && edit !== 'new' ? fleet.find((c) => c.id === Number(edit)) ?? null : null;
  const showForm = editable && ops && (edit === 'new' || editing);
  const setEdit = (v) => { const n = new URLSearchParams(params); if (v) n.set('edit', v); else n.delete('edit'); setParams(n, { replace: true }); };

  const remove = async (c) => {
    const ok = await confirmDialog({ title: 'Delete this collector account?', action: 'Delete account',
      message: `${c.name} will no longer be able to sign in to the mobile app, and their GPS history is removed. Logged pickups stay in the records.` });
    if (!ok) return;
    try {
      await manageStaff({ action: 'delete', role: 'garbage_collector', id: c.id });
      setMsg({ success: 'Collector account deleted.', errors: [] });
      reload();
    } catch (err) { setMsg({ success: '', errors: [err.message] }); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <PageHead title="Garbage collectors" desc={editable ? 'Collector accounts for the ECollect mobile app. Each collector has a home zone and a truck.'
        : "Every collector, their zone and truck, today's progress and when their phone last sent a GPS position."}>
        {editable && !showForm && <button type="button" className="btn btn-primary" onClick={() => { setMsg({ success: '', errors: [] }); setEdit('new'); }}><Icon name="plus" />Add collector</button>}
      </PageHead>
      {!editable && <ReadonlyBanner>View only. The Barangay Admin creates collector accounts and assigns zones.</ReadonlyBanner>}
      <Messages success={msg.success} errors={msg.errors} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !ops && <Loading />}
      {showForm && <CollectorForm key={edit} ops={ops} editing={editing} onCancel={() => setEdit(null)}
        onDone={(m) => { setMsg({ success: m, errors: [] }); setEdit(null); reload(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
      {ops && (
        <section className="panel mb">
          {editable && <div className="panel-head"><h2>All collectors</h2><span className="note">{fleet.length} accounts</span></div>}
          <SearchBar id="colSearch" label="Search garbage collectors" value={q} onChange={setQ}
            placeholder={editable ? 'Search name, email, zone or truck' : 'Search name, zone or truck'} shown={shown.length} total={fleet.length} />
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>{editable ? <><th>Name</th><th>Email</th></> : <th>Collector</th>}<th>Home zone</th><th>Truck</th><th>Today</th><th>Last GPS position</th>{editable && <th />}</tr></thead>
              <tbody>
                {!fleet.length && <tr><td colSpan={editable ? 7 : 5}><Empty icon="people" title="No collectors yet" text={editable ? 'Add a collector account so they can use the mobile app.' : 'The Barangay Admin has not created collector accounts.'} /></td></tr>}
                {!shown.length && fleet.length > 0 && <NoMatchRow colSpan={editable ? 7 : 5} q={q} />}
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong>{!c.has_login && <div><span className="chip pending">No login yet</span></div>}</td>
                    {editable && <td>{c.email}</td>}
                    <td><span style={{ color: c.color }}>●</span> {c.zone}</td>
                    <td>{c.truck ?? 'None'}</td>
                    <td>{c.today_total ? c.duty_text : <span className="muted">Off today</span>}</td>
                    <td><span className={`chip ${GPS_CSS[c.gps]}`}>{gpsText(c.gps)}</span>{c.gps !== 'none' && (editable ? <div className="muted">{c.ago}</div> : <span className="muted"> {c.ago}</span>)}</td>
                    {editable && <td className="actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMsg({ success: '', errors: [] }); setEdit(String(c.id)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="edit" />Edit</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(c)}><Icon name="trash" />Delete</button>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// Barangay Admin accounts (port of lgu_admin/barangay-admins.php). LGU Admin only.
// Logins are created through the manage-staff Edge Function (it holds the service key).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, NoMatchRow, PageHead, SearchBar, useLoad, useSearchText } from '../components/common';
import { supabase, must, manageStaff } from '../lib/supabase';
import { confirmDialog, toast } from '../lib/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadAdmins() {
  const [admins, routes, scheds] = await Promise.all([
    supabase.from('barangay_admin').select('barangay_admin_id, firstname, lastname, email, auth_user_id').order('lastname').order('firstname'),
    supabase.from('route').select('barangay_admin_id'),
    supabase.from('collection_schedule').select('barangay_admin_id'),
  ]);
  const r = must(routes), s = must(scheds);
  return must(admins).map((b) => ({
    ...b,
    zones: r.filter((x) => x.barangay_admin_id === b.barangay_admin_id).length,
    scheds: s.filter((x) => x.barangay_admin_id === b.barangay_admin_id).length,
  }));
}

function AdminForm({ list, editing, onDone, onCancel }) {
  const [f, setF] = useState({ first: editing?.firstname ?? '', last: editing?.lastname ?? '', email: editing?.email ?? '', password: '' });
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const needsLogin = !editing || !editing.auth_user_id;

  const save = async (e) => {
    e.preventDefault();
    const first = f.first.trim(), last = f.last.trim(), email = f.email.trim();
    const errs = [];
    if (!first || !last || first.length > 50 || last.length > 50) errs.push('Enter a first and last name (up to 50 characters each).');
    if (!EMAIL_RE.test(email) || email.length > 100) errs.push('Enter a valid email address.');
    if (needsLogin && f.password.length < 8) errs.push(editing ? 'This account has no login yet. Set a password of at least 8 characters to create it.' : 'The password must be at least 8 characters.');
    else if (f.password !== '' && f.password.length < 8) errs.push('A new password must be at least 8 characters.');
    if (list.some((b) => String(b.email).toLowerCase() === email.toLowerCase() && b.barangay_admin_id !== editing?.barangay_admin_id)) errs.push('Another Barangay Admin already uses that email.');
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    try {
      const body = { role: 'barangay_admin', first_name: first, last_name: last, email };
      if (editing && editing.auth_user_id) {
        await manageStaff({ ...body, action: 'update', id: editing.barangay_admin_id, password: f.password });
      } else {
        if (editing && email.toLowerCase() !== String(editing.email).toLowerCase()) await manageStaff({ ...body, action: 'update', id: editing.barangay_admin_id });
        const r = await manageStaff({ ...body, action: 'create', password: f.password });
        if (r?.linked) toast('That email already had an ECollect login, so it was linked. It keeps its current password.');
      }
      onDone(editing ? 'Account updated.' : 'Account created. They can sign in on the home page as a Barangay Admin.');
    } catch (err) {
      setErrors([err.message]);
      setBusy(false);
    }
  };

  return (
    <section className="panel mb">
      <div className="panel-head"><h2>{editing ? 'Edit account' : 'Create an account'}</h2>
        {editing && <button type="button" className="panel-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={onCancel}>Cancel</button>}</div>
      <form className="panel-body" onSubmit={save}>
        <Messages errors={errors} />
        <div className="form-grid">
          <div className="field"><label htmlFor="firstname">First name</label><input className="input" id="firstname" maxLength={50} value={f.first} onChange={set('first')} required /></div>
          <div className="field"><label htmlFor="lastname">Last name</label><input className="input" id="lastname" maxLength={50} value={f.last} onChange={set('last')} required /></div>
          <div className="field"><label htmlFor="email">Email</label><input className="input" type="email" id="email" maxLength={100} autoComplete="off" value={f.email} onChange={set('email')} required /></div>
          <div className="field"><label htmlFor="password">{needsLogin ? 'Password' : 'New password'}</label>
            <input className="input" type="password" id="password" minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} required={needsLogin} />
            <span className="hint">{needsLogin ? (editing ? 'No login yet. Setting a password creates it.' : 'At least 8 characters.') : 'Leave blank to keep the current password.'}</span></div>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button>
        </div>
      </form>
    </section>
  );
}

export default function BarangayAdmins() {
  const [params, setParams] = useSearchParams();
  const editId = Number(params.get('edit') || 0);
  const { data: list, error, loading, reload } = useLoad(loadAdmins, []);
  const editing = editId ? list?.find((b) => b.barangay_admin_id === editId) ?? null : null;
  const [q, setQ] = useSearchText();
  const shown = (list ?? []).filter((b) => matchesSearch(q, [b.firstname, b.lastname, b.email]));
  const [success, setSuccess] = useState('');
  const [errors, setErrors] = useState([]);
  const setEdit = (id) => { const n = new URLSearchParams(params); if (id) n.set('edit', id); else n.delete('edit'); setParams(n, { replace: true }); };

  const remove = async (b) => {
    if (!(await confirmDialog({ title: 'Delete this account?', message: 'They will no longer be able to sign in.', action: 'Delete account' }))) return;
    try {
      await manageStaff({ action: 'delete', role: 'barangay_admin', id: b.barangay_admin_id });
      setErrors([]); setSuccess('Account deleted.');
    } catch (err) {
      setSuccess(''); setErrors([err.message]);
    }
    reload();
  };

  return (
    <>
      <PageHead title="Barangay Admin accounts" topTitle="Barangay admins" desc="People who run day-to-day collection for Barangay Poblacion. There is no self-registration." />
      <Messages success={success} errors={errors} />
      {error && <LoadError message={error} onRetry={reload} />}
      {list && (
        <AdminForm key={editing ? editing.barangay_admin_id : 'new'} list={list} editing={editing}
          onCancel={() => setEdit(0)}
          onDone={(m) => { setErrors([]); setSuccess(m); setEdit(0); reload(); }} />
      )}
      {loading && !list && <Loading />}
      {list && (
        <section className="panel mb">
          <SearchBar id="admSearch" label="Search barangay admins" value={q} onChange={setQ}
            placeholder="Search name or email" shown={shown.length} total={list.length} />
          <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Login</th><th className="num">Zones owned</th><th className="num">Schedules created</th><th /></tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={6}><Empty icon="shield" title="No accounts yet" text="Create the first Barangay Admin account above." /></td></tr>}
            {!shown.length && list.length > 0 && <NoMatchRow colSpan={6} q={q} />}
            {shown.map((b) => (
              <tr key={b.barangay_admin_id}>
                <td><strong>{b.firstname} {b.lastname}</strong></td>
                <td>{b.email}</td>
                <td>{b.auth_user_id ? <span className="chip done">Can sign in</span> : <span className="chip pending">No login yet</span>}</td>
                <td className="num">{b.zones}</td>
                <td className="num">{b.scheds}</td>
                <td className="actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSuccess(''); setErrors([]); setEdit(b.barangay_admin_id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="edit" />Edit</button>
                  {b.zones + b.scheds === 0
                    ? <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(b)}><Icon name="trash" />Delete</button>
                    : <span className="lock-note" title="Deleting would also affect the zones and schedules linked to this account"><Icon name="lock" />Linked to zones</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div></section>
      )}
    </>
  );
}

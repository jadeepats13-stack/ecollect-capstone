// Announcements (port of announcements.php). The Barangay Admin posts, and edits or deletes their own;
// the LGU Admin views. Residents and collectors see active ones in the mobile app.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, NoMatchRow, PageHead, ReadonlyBanner, SearchBar, useLoad, useSearchText } from '../components/common';
import { usePanel } from '../components/Layout';
import { loadClock } from '../lib/ops';
import { supabase, must, explain } from '../lib/supabase';
import { fmtDate, toManila, validDate } from '../lib/time';
import { confirmDialog } from '../lib/ui';

async function loadAnnouncements() {
  const [clock, list] = await Promise.all([
    loadClock(),
    supabase.from('announcement').select('*, barangay_admin(firstname, lastname)')
      .order('published_timestamp', { ascending: false }).order('announcement_id', { ascending: false }),
  ]);
  return { today: clock.date, list: must(list) };
}

const byName = (a) => (a.barangay_admin ? `${a.barangay_admin.firstname ?? ''} ${a.barangay_admin.lastname ?? ''}`.trim() : '');
const short = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export default function Announcements() {
  const { role, me } = usePanel();
  const editable = role === 'barangay';
  const myId = editable ? me?.id ?? null : null;
  const [params, setParams] = useSearchParams();
  const editId = Number(params.get('edit') || 0);
  const { data, error, loading, reload } = useLoad(loadAnnouncements, []);
  const editing = editable && editId ? data?.list.find((a) => a.announcement_id === editId && a.barangay_admin_id === myId) ?? null : null;
  const key = editing ? editing.announcement_id : 'new';
  const [q, setQ] = useSearchText();
  const list = data?.list ?? [];
  const shown = list.filter((a) => matchesSearch(q, [a.title, a.content, byName(a), fmtDate(toManila(a.published_timestamp), 'M j, Y'),
    Boolean(a.expiry_date) && a.expiry_date < data.today ? 'expired' : 'showing']));
  const [form, setForm] = useState({ key: null, title: '', content: '', expiry: '' });
  const [msg, setMsg] = useState({ success: '', errors: [] });
  if (data && form.key !== key) setForm({ key, title: editing?.title ?? '', content: editing?.content ?? '', expiry: editing?.expiry_date ?? '' });
  const setEdit = (id) => { const n = new URLSearchParams(params); if (id) n.set('edit', id); else n.delete('edit'); setParams(n, { replace: true }); };

  const save = async (e) => {
    e.preventDefault();
    const title = form.title.trim(), content = form.content.trim(), expiry = form.expiry || null;
    const errs = [];
    if (!title || title.length > 150) errs.push('Enter a title (up to 150 characters).');
    if (!content) errs.push('Write the announcement text.');
    if (expiry && !validDate(expiry)) errs.push('Enter a valid expiry date or leave it blank.');
    if (errs.length) { setMsg({ success: '', errors: errs }); return; }
    const row = { title, content, expiry_date: expiry };
    const res = editing
      ? await supabase.from('announcement').update(row).eq('announcement_id', editing.announcement_id)
      : await supabase.from('announcement').insert({ ...row, barangay_admin_id: myId });
    if (res.error) { setMsg({ success: '', errors: [explain(res.error)] }); return; }
    setMsg({ success: editing ? 'Announcement updated.' : 'Announcement posted. It now shows in the mobile app.', errors: [] });
    setForm({ key: null, title: '', content: '', expiry: '' });
    setEdit(0);
    reload();
  };

  const remove = async (a) => {
    if (!(await confirmDialog({ title: 'Delete this announcement?', message: 'It disappears from the mobile app immediately.', action: 'Delete' }))) return;
    const { error: err, count } = await supabase.from('announcement').delete({ count: 'exact' }).eq('announcement_id', a.announcement_id);
    setMsg(err || !count ? { success: '', errors: [err ? explain(err) : 'You can only delete announcements you posted.'] } : { success: 'Announcement deleted.', errors: [] });
    if (editId === a.announcement_id) setEdit(0);
    reload();
  };

  const cols = editable ? 6 : 5;
  return (
    <>
      <PageHead title="Announcements" desc={editable ? 'Notices for residents and collectors. They appear in the mobile app until they expire.' : 'Notices published to residents and collectors through the mobile app.'} />
      {!editable && <ReadonlyBanner>View only. The Barangay Admin posts announcements.</ReadonlyBanner>}
      <Messages success={msg.success} errors={msg.errors} />
      {error && <LoadError message={error} onRetry={reload} />}
      {editable && data && (
        <section className="panel mb">
          <div className="panel-head"><h2>{editing ? 'Edit announcement' : 'Post an announcement'}</h2>
            {editing && <button type="button" className="panel-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setEdit(0)}>Cancel</button>}</div>
          <form className="panel-body" onSubmit={save}>
            <div className="form-grid">
              <div className="field span-2"><label htmlFor="title">Title</label><input className="input" id="title" maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
              <div className="field"><label htmlFor="expiry_date">Show until</label>
                <input className="input" type="date" id="expiry_date" min={editing ? undefined : data.today} value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
                <span className="hint">Leave blank to keep it showing.</span></div>
              <div className="field wide"><label htmlFor="content">Message</label><textarea className="textarea" id="content" rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required /></div>
            </div>
            <div className="btn-row" style={{ marginTop: 16 }}><button className="btn btn-primary" type="submit"><Icon name="megaphone" />{editing ? 'Save changes' : 'Post announcement'}</button></div>
          </form>
        </section>
      )}
      {loading && !data && <Loading />}
      {data && (
        <section className="panel mb">
          <SearchBar id="annSearch" label="Search announcements" value={q} onChange={setQ}
            placeholder="Search title, message, who posted it, or showing / expired" shown={shown.length} total={list.length} />
          <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Announcement</th><th>Posted by</th><th>Posted</th><th>Shows until</th><th>Status</th>{editable && <th />}</tr></thead>
          <tbody>
            {!data.list.length && <tr><td colSpan={cols}><Empty icon="megaphone" title={editable ? 'No announcements yet' : 'No announcements'} text={editable ? 'Post one above to notify residents through the app.' : 'Nothing has been posted yet.'} /></td></tr>}
            {!shown.length && list.length > 0 && <NoMatchRow colSpan={cols} q={q} />}
            {shown.map((a) => {
              const expired = Boolean(a.expiry_date) && a.expiry_date < data.today;
              const by = byName(a);
              const mine = editable && a.barangay_admin_id === myId;
              return (
                <tr key={a.announcement_id}>
                  <td><strong>{a.title}</strong><div className="muted">{short(a.content, editable ? 140 : 160)}</div></td>
                  <td>{by || (editable ? 'LGU / earlier record' : 'Earlier record')}</td>
                  <td>{fmtDate(toManila(a.published_timestamp), 'M j, Y')}</td>
                  <td>{a.expiry_date ? fmtDate(a.expiry_date, 'M j, Y') : 'No end date'}</td>
                  <td><span className={`chip ${expired ? '' : 'done'}`}>{expired ? 'Expired' : 'Showing'}</span></td>
                  {editable && <td className="actions">{mine && <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMsg({ success: '', errors: [] }); setEdit(a.announcement_id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="edit" />Edit</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(a)}><Icon name="trash" />Delete</button>
                  </>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table></div></section>
      )}
    </>
  );
}

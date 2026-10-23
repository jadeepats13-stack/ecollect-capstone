// Waste categories (port of waste-categories.php). Barangay Admin manages; LGU views.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, NoMatchRow, PageHead, ReadonlyBanner, SearchBar, useLoad, useSearchText } from '../components/common';
import { usePanel } from '../components/Layout';
import { supabase, must, explain } from '../lib/supabase';
import { confirmDialog } from '../lib/ui';

async function loadCategories() {
  const [cats, scheds] = await Promise.all([
    supabase.from('waste_category').select('*').order('category_name'),
    supabase.from('collection_schedule').select('waste_category_id, schedule_status'),
  ]);
  const s = must(scheds);
  return must(cats).map((c) => ({
    ...c,
    used: s.filter((x) => x.waste_category_id === c.waste_category_id).length,
    active: s.filter((x) => x.waste_category_id === c.waste_category_id && x.schedule_status === 'Active').length,
  }));
}

const Guide = ({ text }) => (text ? <span style={{ whiteSpace: 'pre-line' }}>{text}</span> : <span className="muted">None written</span>);

export default function WasteCategories() {
  const { role } = usePanel();
  const editable = role === 'barangay';
  const [params, setParams] = useSearchParams();
  const editId = Number(params.get('edit') || 0);
  const { data: list, error, loading, reload } = useLoad(loadCategories, []);
  const editing = editable && editId ? list?.find((c) => c.waste_category_id === editId) ?? null : null;
  const [q, setQ] = useSearchText();
  const shown = (list ?? []).filter((c) => matchesSearch(q, [c.category_name, c.disposal_guidelines]));
  const [form, setForm] = useState({ key: null, name: '', guide: '' });
  const [msg, setMsg] = useState({ success: '', errors: [] });
  const key = editing ? editing.waste_category_id : 'new';
  if (form.key !== key) setForm({ key, name: editing?.category_name ?? '', guide: editing?.disposal_guidelines ?? '' });
  const setEdit = (id) => { const n = new URLSearchParams(params); if (id) n.set('edit', id); else n.delete('edit'); setParams(n, { replace: true }); };

  const save = async (e) => {
    e.preventDefault();
    const name = form.name.trim(), guide = form.guide.trim();
    const errs = [];
    if (!name || name.length > 100) errs.push('Enter a category name (up to 100 characters).');
    if (list.some((c) => c.category_name === name && c.waste_category_id !== editing?.waste_category_id)) errs.push('A category with that name already exists.');
    if (errs.length) { setMsg({ success: '', errors: errs }); return; }
    const res = editing
      ? await supabase.from('waste_category').update({ category_name: name, disposal_guidelines: guide }).eq('waste_category_id', editing.waste_category_id)
      : await supabase.from('waste_category').insert({ category_name: name, disposal_guidelines: guide });
    if (res.error) { setMsg({ success: '', errors: [explain(res.error)] }); return; }
    setMsg({ success: editing ? 'Category updated.' : 'Category added.', errors: [] });
    setForm({ key: null, name: '', guide: '' });
    setEdit(0);
    reload();
  };
  const remove = async (c) => {
    if (!(await confirmDialog({ title: `Delete ${c.category_name}?`, message: "Residents will no longer see this category's guide in the app.", action: 'Delete category' }))) return;
    const { error: err } = await supabase.from('waste_category').delete().eq('waste_category_id', c.waste_category_id);
    setMsg(err ? { success: '', errors: [`This category is used by schedules. ${explain(err)}`] } : { success: 'Waste category deleted.', errors: [] });
    reload();
  };

  return (
    <>
      <PageHead title="Waste categories" desc={editable ? 'Categories used in schedules, with the disposal guide residents read in the mobile app.' : 'Categories and the disposal guide residents see in the mobile app.'} />
      {!editable && <ReadonlyBanner>View only. The Barangay Admin manages waste categories.</ReadonlyBanner>}
      <Messages success={msg.success} errors={msg.errors} />
      {error && <LoadError message={error} onRetry={reload} />}
      {editable && list && (
        <section className="panel mb">
          <div className="panel-head"><h2>{editing ? 'Edit category' : 'Add a category'}</h2>{editing && <button type="button" className="panel-link" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setEdit(0)}>Cancel</button>}</div>
          <form className="panel-body" onSubmit={save}>
            <div className="form-grid">
              <div className="field span-2"><label htmlFor="category_name">Category name</label><input className="input" id="category_name" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="field wide"><label htmlFor="disposal_guidelines">Disposal guidelines</label><textarea className="textarea" id="disposal_guidelines" rows={3} value={form.guide} onChange={(e) => setForm({ ...form, guide: e.target.value })} /></div>
            </div>
            <div className="btn-row" style={{ marginTop: 16 }}><button className="btn btn-primary" type="submit"><Icon name="check" />{editing ? 'Save changes' : 'Add category'}</button></div>
          </form>
        </section>
      )}
      {loading && !list && <Loading />}
      {list && (
        <section className="panel mb">
          <SearchBar id="catSearch" label="Search waste categories" value={q} onChange={setQ}
            placeholder="Search category or disposal guide" shown={shown.length} total={list.length} />
          <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Category</th><th>Disposal guidelines</th><th className="num">{editable ? 'Schedules' : 'Active schedules'}</th>{editable && <th />}</tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={editable ? 4 : 3}><Empty icon="bin" title={editable ? 'No categories yet' : 'No categories'} text={editable ? 'Add one above, for example Biodegradable or Residual.' : 'None have been added yet.'} /></td></tr>}
            {!shown.length && list.length > 0 && <NoMatchRow colSpan={editable ? 4 : 3} q={q} />}
            {shown.map((c) => (
              <tr key={c.waste_category_id}>
                <td><strong>{c.category_name}</strong></td>
                <td><Guide text={c.disposal_guidelines} /></td>
                <td className="num">{editable ? c.used : c.active}</td>
                {editable && <td className="actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMsg({ success: '', errors: [] }); setEdit(c.waste_category_id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="edit" />Edit</button>
                  {c.used === 0
                    ? <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(c)}><Icon name="trash" />Delete</button>
                    : <span className="lock-note" title="Used by schedules"><Icon name="lock" />In use</span>}
                </td>}
              </tr>
            ))}
          </tbody>
        </table></div></section>
      )}
    </>
  );
}

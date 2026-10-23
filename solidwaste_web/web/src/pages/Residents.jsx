// Residents (port of lgu_admin/residents.php). LGU Admin views accounts made in the mobile app,
// and can delete one (with its login) when the resident asks for it.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, NoMatchRow, PageHead, SearchBar, useLoad, useSearchText } from '../components/common';
import { loadOps } from '../lib/ops';
import { supabase, must, manageStaff } from '../lib/supabase';
import { confirmDialog } from '../lib/ui';

async function loadResidents() {
  const [ops, res, fb] = await Promise.all([
    loadOps({ fleet: false }),
    supabase.from('resident').select('resident_id, first_name, last_name, email, contact_number, home_address, route_id').order('last_name').order('first_name'),
    supabase.from('feedback_report').select('resident_id'),
  ]);
  const reports = {};
  for (const f of must(fb)) reports[f.resident_id] = (reports[f.resident_id] ?? 0) + 1;
  return { ops, list: must(res).map((r) => ({ ...r, reports: reports[r.resident_id] ?? 0 })) };
}

const short = (s, n = 60) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export default function Residents() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useSearchText();
  const zone = Number(params.get('zone') || 0);
  const { data, error, loading, reload } = useLoad(loadResidents, []);
  const [msg, setMsg] = useState({ success: '', errors: [] });
  const update = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const inZone = (data?.list ?? []).filter((r) => !zone || r.route_id === zone);
  const rows = inZone.filter((r) => matchesSearch(q, [r.first_name, r.last_name, r.email, r.contact_number, r.home_address, data.ops.zoneById(r.route_id)?.name]));

  const remove = async (r) => {
    const name = `${r.first_name} ${r.last_name}`.trim();
    const ok = await confirmDialog({
      title: `Delete ${name}?`,
      message: `This permanently deletes the account${r.reports ? ` and its ${r.reports} feedback report(s), which will drop out of the reports and trends` : ''}. Only do this when the resident asks for their account to be removed.`,
      action: 'Delete account',
    });
    if (!ok) return;
    try {
      await manageStaff({ action: 'delete', role: 'resident', id: r.resident_id });
      setMsg({ success: 'Resident account and its reports deleted.', errors: [] });
    } catch (err) {
      setMsg({ success: '', errors: [err.message] });
    }
    reload();
  };

  return (
    <>
      <PageHead title="Residents" desc="Accounts residents created in the ECollect mobile app. Residents cannot sign in to this website." />
      <Messages success={msg.success} errors={msg.errors} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <section className="panel mb">
          <div className="filters panel-body">
            <div className="field"><label htmlFor="zone">Zone</label>
              <select className="select" id="zone" value={zone} onChange={(e) => update('zone', e.target.value === '0' ? '' : e.target.value)}>
                <option value="0">All zones</option>
                {data.ops.zones().map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select></div>
          </div>
          <SearchBar id="resSearch" label="Search residents" value={q} onChange={setQ}
            placeholder="Search name, email, contact number, address or zone" shown={rows.length} total={inZone.length} />
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Contact</th><th>Zone</th><th>Address</th><th className="num">Reports</th><th /></tr></thead>
            <tbody>
              {!rows.length && inZone.length > 0 && <NoMatchRow colSpan={7} q={q} />}
              {!inZone.length && <tr><td colSpan={7}><Empty icon="resident" title="No residents found" text={zone ? 'No residents in this zone.' : 'Residents appear here after they register in the mobile app.'} /></td></tr>}
              {rows.map((r) => {
                const z = data.ops.zoneById(r.route_id);
                return (
                  <tr key={r.resident_id}>
                    <td><strong>{r.first_name} {r.last_name}</strong></td>
                    <td>{r.email}</td>
                    <td>{r.contact_number || '–'}</td>
                    <td>{z ? <><span style={{ color: z.color }}>●</span> {z.name}</> : <span className="muted">Not chosen</span>}</td>
                    <td>{short(r.home_address) || '–'}</td>
                    <td className="num">{r.reports}</td>
                    <td className="actions"><button type="button" className="btn btn-danger btn-sm" onClick={() => remove(r)}><Icon name="trash" />Delete</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
      )}
    </>
  );
}

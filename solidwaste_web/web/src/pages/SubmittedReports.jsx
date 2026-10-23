// Reports the Barangay Admin submitted to the LGU (figures saved exactly as sent).
// LGU Admin: open, review, or return with comments. Barangay Admin: follows the status and reads the LGU's comments.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { Empty, LoadError, Loading, matchesSearch, Messages, NoMatchRow, PageHead, SearchBar, useLoad, useSearchText } from '../components/common';
import { usePanel } from '../components/Layout';
import { supabase, must, explain } from '../lib/supabase';
import { fmtDate, fmtStamp, toManila } from '../lib/time';
import { downloadCsv } from '../lib/ui';

const STATUS = {
  Sent: { css: 'pending', lgu: 'New', brgy: 'Sent, waiting for review' },
  Reviewed: { css: 'done', lgu: 'Reviewed', brgy: 'Reviewed by the LGU' },
  Returned: { css: 'delayed', lgu: 'Returned', brgy: 'Returned with comments' },
};
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${v}%`);
const period = (r) => (r.period_from === r.period_to ? fmtDate(r.period_from, 'M j, Y') : `${fmtDate(r.period_from, 'M j')} – ${fmtDate(r.period_to, 'M j, Y')}`);
const who = (a) => `${a?.firstname ?? a?.first_name ?? ''} ${a?.lastname ?? a?.last_name ?? ''}`.trim();

async function loadSubmitted() {
  return must(await supabase.from('reports')
    .select('*, barangay_admin(firstname, lastname), reviewer:reviewed_by(first_name, last_name), route:zone_id(zone_name)')
    .eq('submitted', true).order('report_id', { ascending: false }).limit(200));
}

function Figures({ s }) {
  return (
    <>
      <div className="status-strip mb">
        <div className="status-cell cell-brand"><span className="lbl">Completion rate</span><span className="num">{pct(s.completion?.rate)}</span><span className="sub">{s.completion?.completed} of {s.completion?.due} due pickups</span></div>
        <div className="status-cell cell-delayed"><span className="lbl">Missed</span><span className="num">{s.completion?.missed ?? 0}</span><span className="sub">{s.completion?.late ?? 0} completed late</span></div>
        <div className="status-cell cell-pending"><span className="lbl">Emergency</span><span className="num">{s.emergencies?.total ?? 0}</span><span className="sub">{s.emergencies?.completed ?? 0} completed · {s.emergencies?.cancelled ?? 0} cancelled</span></div>
        <div className="status-cell cell-idle"><span className="lbl">Resident reports</span><span className="num">{s.resident_reports?.submitted ?? 0}</span><span className="sub">{s.resident_reports?.unresolved ?? 0} unresolved</span></div>
      </div>
      <dl className="dl-grid">
        <dt>Pickup ratings</dt><dd>{s.pickup_ratings?.good + s.pickup_ratings?.had_a_problem ? `${pct(s.pickup_ratings.good_pct)} good (${s.pickup_ratings.good} good, ${s.pickup_ratings.had_a_problem} had a problem)` : 'None'}</dd>
        <dt>Report handling</dt><dd>{s.handling_ratings?.count ? `${s.handling_ratings.average} ★ average from ${s.handling_ratings.count} rating(s); ${pct(s.handling_ratings.satisfied_pct)} gave 4–5 ★` : 'No ratings'}</dd>
        <dt>Truck hours</dt><dd>{s.truck_hours?.shifts ? `${s.truck_hours.hours} h in ${s.truck_hours.shifts} shift(s)` : 'No shifts recorded'}</dd>
        {s.resident_reports?.by_type && Object.keys(s.resident_reports.by_type).length ? <><dt>Report types</dt><dd>{Object.entries(s.resident_reports.by_type).map(([k, v]) => `${k} ${v}`).join(', ')}</dd></> : null}
      </dl>
      {s.by_zone?.length ? (
        <div className="table-wrap" style={{ marginTop: 12 }}><table className="tbl">
          <thead><tr><th>Zone</th><th className="num">Due</th><th className="num">Completed</th><th className="num">Late</th><th className="num">Missed</th><th className="num">Rate</th></tr></thead>
          <tbody>{s.by_zone.map((z) => <tr key={z.zone}><td>{z.zone}</td><td className="num">{z.due}</td><td className="num">{z.completed}</td><td className="num">{z.late}</td><td className="num">{z.missed}</td><td className="num">{pct(z.rate)}</td></tr>)}</tbody>
        </table></div>
      ) : null}
    </>
  );
}

function Detail({ row, isLgu, onClose, onSaved }) {
  const dlg = useRef(null);
  const [comment, setComment] = useState(row.lgu_comment ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { dlg.current?.showModal(); }, []);
  const s = row.summary ?? {};
  const st = STATUS[row.review_status] ?? STATUS.Sent;
  const review = async (status) => {
    if (status === 'Returned' && !comment.trim()) { setErr('Write a comment so the barangay knows what to fix.'); return; }
    setBusy(status); setErr('');
    const { error } = await supabase.from('reports').update({ review_status: status, lgu_comment: comment.trim() || null }).eq('report_id', row.report_id);
    setBusy('');
    if (error) { setErr(explain(error)); return; }
    onSaved(status === 'Reviewed' ? `Report #${row.report_id} marked reviewed.` : `Report #${row.report_id} returned to the barangay with your comment.`);
  };
  const csv = () => {
    const rows = [['Report', row.report_type], ['Period', `${row.period_from} to ${row.period_to}`], ['Zone', s.zone ?? 'All zones'],
      ['Sent by', who(row.barangay_admin)], ['Sent at', toManila(row.generated_timestamp)], ['Status', row.review_status], ['Remarks', row.remarks ?? ''], ['LGU comment', row.lgu_comment ?? ''], [],
      ['Completion rate (%)', s.completion?.rate ?? ''], ['Due pickups', s.completion?.due ?? ''], ['Completed', s.completion?.completed ?? ''], ['Completed late', s.completion?.late ?? ''], ['Missed', s.completion?.missed ?? ''],
      ['Emergency collections', s.emergencies?.total ?? ''], ['Resident reports', s.resident_reports?.submitted ?? ''], ['Unresolved reports', s.resident_reports?.unresolved ?? ''],
      ['Good pickup ratings (%)', s.pickup_ratings?.good_pct ?? ''], ['Handling rating (avg stars)', s.handling_ratings?.average ?? ''], ['Truck hours', s.truck_hours?.hours ?? ''], [],
      ['Zone', 'Due', 'Completed', 'Late', 'Missed', 'Rate (%)'], ...(s.by_zone ?? []).map((z) => [z.zone, z.due, z.completed, z.late, z.missed, z.rate ?? ''])];
    downloadCsv(`ecollect-submitted-report-${row.report_id}.csv`, rows);
  };
  const base = isLgu ? '/lgu' : '/barangay';
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose} onCancel={onClose} aria-labelledby="subTitleH">
      <div className="drawer-head">
        <div><span className="note">Report #{row.report_id} · {period(row)}{s.zone && s.zone !== 'All zones' ? ` · ${s.zone}` : ''}</span><h2 id="subTitleH">{row.report_type}</h2></div>
        <span className={`chip ${st.css}`}>{isLgu ? st.lgu : st.brgy}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dlg.current?.close()}>Close</button>
      </div>
      <div className="drawer-body">
        <p className="muted" style={{ marginBottom: 12 }}>Sent by {who(row.barangay_admin) || 'Barangay Admin'} on {fmtStamp(toManila(row.generated_timestamp), true)}. The figures are as they were when sent.</p>
        {row.remarks ? <><h3 className="drawer-sub">Barangay’s remarks</h3><blockquote>{row.remarks}</blockquote></> : null}
        <h3 className="drawer-sub">Figures</h3>
        <Figures s={s} />
        <div className="btn-row" style={{ marginTop: 12 }}>
          <Link className="btn btn-ghost btn-sm" to={`${base}/reports?from=${row.period_from}&to=${row.period_to}${row.zone_id ? `&zone=${row.zone_id}` : ''}`}><Icon name="eye" />See this period live</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={csv}><Icon name="download" />Download CSV</button>
        </div>
        {row.review_status !== 'Sent' ? (
          <>
            <h3 className="drawer-sub">LGU review</h3>
            <p><strong>{row.review_status === 'Returned' ? 'Returned with comments' : 'Reviewed'}</strong>
              <span className="muted"> · {who(row.reviewer) || 'LGU Admin'}{row.reviewed_at ? `, ${fmtStamp(toManila(row.reviewed_at), true)}` : ''}</span></p>
            {row.lgu_comment ? <blockquote>{row.lgu_comment}</blockquote> : null}
          </>
        ) : null}
        {isLgu ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="lguComment">Comment for the barangay <span className="muted">(needed when returning)</span></label>
              <textarea className="textarea" id="lguComment" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)}
                placeholder="For example: please explain the missed pickups in Zone 4." />
            </div>
            {err ? <div className="alert alert-error" role="alert">{err}</div> : null}
            <div className="btn-row">
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => review('Reviewed')}><Icon name="check" />{busy === 'Reviewed' ? 'Saving…' : 'Mark reviewed'}</button>
              <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => review('Returned')}>{busy === 'Returned' ? 'Saving…' : 'Return with comments'}</button>
            </div>
          </div>
        ) : row.review_status === 'Returned' ? (
          <p className="note" style={{ marginTop: 12 }}>To answer, open <Link to="/barangay/reports">Reports</Link>, choose the same period and submit an updated report.</p>
        ) : null}
      </div>
    </dialog>
  );
}

export default function SubmittedReports() {
  const { role, refreshBadges } = usePanel();
  const isLgu = role === 'lgu';
  const [params, setParams] = useSearchParams();
  const filter = ['all', 'Sent', 'Reviewed', 'Returned'].includes(params.get('status')) ? params.get('status') : 'all';
  const [openId, setOpenId] = useState(null);
  const [success, setSuccess] = useState(params.get('sent') ? `Report #${params.get('sent')} was submitted to the LGU.` : '');
  const { data, error, loading, reload } = useLoad(loadSubmitted, []);
  const list = data ?? [];
  const [q, setQ] = useSearchText();
  const inTab = filter === 'all' ? list : list.filter((r) => r.review_status === filter);
  const shown = inTab.filter((r) => matchesSearch(q, [`#${r.report_id}`, String(r.report_id), r.report_type, r.remarks, r.lgu_comment, period(r), r.route?.zone_name ?? 'All zones',
    who(r.barangay_admin), r.review_status, (STATUS[r.review_status] ?? STATUS.Sent)[isLgu ? 'lgu' : 'brgy']]));
  const count = (k) => list.filter((r) => r.review_status === k).length;
  const openRow = openId ? list.find((r) => r.report_id === openId) : null;
  const setFilter = (k) => { const n = new URLSearchParams(params); n.set('status', k); n.delete('sent'); setParams(n, { replace: true }); };

  return (
    <>
      <PageHead title={isLgu ? 'Submitted reports' : 'Sent to the LGU'}
        desc={isLgu
          ? 'Reports the Barangay Admin submitted, with the figures as they were when sent. Mark each one reviewed, or return it with a comment.'
          : 'Reports you submitted to the LGU from Reports → “Submit to LGU”, and what the LGU said about them.'}>
        {!isLgu ? <Link className="btn btn-primary" to="/barangay/reports"><Icon name="send" />Submit a report</Link> : null}
      </PageHead>
      <Messages success={success} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <section className="panel">
          <div className="panel-head"><h2>{isLgu ? 'From Barangay Poblacion' : 'Your submissions'}</h2>
            <div className="seg" role="group" aria-label="Show">
              {[['all', `All (${list.length})`], ['Sent', `${isLgu ? 'New' : 'Waiting'} (${count('Sent')})`], ['Reviewed', `Reviewed (${count('Reviewed')})`], ['Returned', `Returned (${count('Returned')})`]].map(([k, l]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          </div>
          <SearchBar id="subSearch" label="Search submitted reports" value={q} onChange={setQ}
            placeholder="Search report, period, zone, status or LGU comment" shown={shown.length} total={inTab.length} />
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>#</th><th>Report</th><th>Period</th><th>Sent</th><th>Completion</th><th>Status</th><th /></tr></thead>
            <tbody>
              {!shown.length && inTab.length > 0 && <NoMatchRow colSpan={7} q={q} />}
              {!inTab.length && <tr><td colSpan={7}><Empty icon="report" title={list.length ? 'Nothing here' : 'No submitted reports yet'}
                text={isLgu ? 'Reports the Barangay Admin submits appear here.' : 'Open Reports, choose a period and click “Submit to LGU”.'} /></td></tr>}
              {shown.map((r) => {
                const st = STATUS[r.review_status] ?? STATUS.Sent;
                return (
                  <tr key={r.report_id}>
                    <td className="muted">{r.report_id}</td>
                    <td><strong>{r.report_type}</strong>{r.remarks ? <div className="muted" style={{ maxWidth: '46ch' }}>{r.remarks.length > 120 ? `${r.remarks.slice(0, 119)}…` : r.remarks}</div> : null}
                      {r.review_status === 'Returned' && r.lgu_comment ? <div style={{ color: 'var(--st-delayed)', maxWidth: '46ch' }}>LGU: {r.lgu_comment}</div> : null}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{period(r)}<div className="muted">{r.route?.zone_name ?? 'All zones'}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtStamp(toManila(r.generated_timestamp), true)}<div className="muted">{who(r.barangay_admin)}</div></td>
                    <td>{pct(r.summary?.completion?.rate)}</td>
                    <td><span className={`chip ${st.css}`}>{isLgu ? st.lgu : st.brgy}</span></td>
                    <td className="actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSuccess(''); setOpenId(r.report_id); }}>{isLgu && r.review_status === 'Sent' ? 'Open · review' : 'Open'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
      )}
      {openRow && <Detail key={openRow.report_id} row={openRow} isLgu={isLgu} onClose={() => setOpenId(null)}
        onSaved={(m) => { setSuccess(m); setOpenId(null); reload(); refreshBadges(); }} />}
    </>
  );
}

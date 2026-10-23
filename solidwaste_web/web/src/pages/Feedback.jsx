// Resident feedback management. Barangay Admin: open a report, reply to the resident, change its status
// (the resident sees both in the app and is notified). LGU Admin: views everything, including the history.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createMap, loadBoundary } from '../lib/mapEngine';
import { matchesSearch, NoMatchRow, SearchBar, useSearchText, Empty, LoadError, Loading, Messages, PageHead, ReadonlyBanner, useLoad } from '../components/common';
import { usePanel } from '../components/Layout';
import { loadOps, rangeFrom } from '../lib/ops';
import { supabase, must } from '../lib/supabase';
import { fmtStamp, toManila } from '../lib/time';
import { toast } from '../lib/ui';

const QUICK_REPLIES = [
  'Thank you. We received your report and will act on it.',
  'The truck crew will collect it on the next pickup.',
  'This has been resolved. Thank you for reporting.',
];
const chipCss = (r) => (r.open ? (r.status === 'In Progress' ? 'ongoing' : 'pending') : 'done');

/** Small map with the report's pin (only when the resident shared a location). */
function PinMap({ lat, lng }) {
  const el = useRef(null);
  useEffect(() => {
    let alive = true, eng = null;
    createMap(el.current, { scrollZoom: false, alive: () => alive }).then(async (m) => {
      if (!m) return;
      if (!alive) { m.destroy(); return; }
      eng = m;
      try { const bd = await loadBoundary(); if (alive) m.focusPoblacion(bd.extent, bd.pob, { fit: false }); } catch { /* outline is optional */ }
      if (!alive) return;
      m.marker(m.group(), [lat, lng], { html: '<div class="fb-pin" style="width:18px;height:18px;background:#c2412d"></div>', size: [18, 18], anchor: [9, 9], zIndex: 900 });
      m.setView(lat, lng, 17);
    });
    return () => { alive = false; eng?.destroy(); };
  }, [lat, lng]);
  return <div ref={el} className="map-canvas" style={{ minHeight: 200, height: 200, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }} aria-label="Location of the report" />;
}

/** The photo the resident attached (private bucket: a link valid for one hour). */
function Photo({ path, alt = 'Photo sent by the resident' }) {
  const { data: url, error } = useLoad(async () => {
    const { data, error: e } = await supabase.storage.from('report-photos').createSignedUrl(path, 3600);
    if (e) throw new Error(e.message);
    return data.signedUrl;
  }, [path]);
  if (error) return <p className="muted" style={{ margin: '12px 0' }}>The photo could not be loaded ({error}).</p>;
  if (!url) return <p className="muted" style={{ margin: '12px 0' }}>Loading the photo…</p>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="fb-photo" title="Open the full photo">
      <img src={url} alt={alt} />
    </a>
  );
}

/** "★★★★☆ 4/5" */
export function StarText({ n }) {
  return <span className="stars" aria-label={`${n} of 5 stars`}>{'★'.repeat(n)}<span className="stars-off">{'★'.repeat(5 - n)}</span> {n}/5</span>;
}

/** The resident's rating of how the barangay handled the report. */
function RatingBlock({ row }) {
  return (
    <div className="fb-rating">
      <h3 className="drawer-sub">Resident’s rating of how it was handled</h3>
      <p><StarText n={row.stars} /> <span className="muted">· {fmtStamp(row.rated_at, true)}</span></p>
      {row.stars_comment ? <blockquote>{row.stars_comment}</blockquote> : null}
      {row.stars_photo ? <Photo path={row.stars_photo} alt="Photo sent with the rating" /> : null}
    </div>
  );
}

function Detail({ row, statuses, editable, onClose, onSaved }) {
  const dlg = useRef(null);
  const [status, setStatus] = useState(row.status);
  const [reply, setReply] = useState(row.response);
  const [busy, setBusy] = useState(false);
  const { data: history, reload } = useLoad(async () => must(await supabase.from('feedback_update')
    .select('feedback_update_id, status, note, created_at, barangay_admin(firstname, lastname)')
    .eq('feedback_report_id', row.id).order('feedback_update_id', { ascending: true })), [row.id]);

  useEffect(() => { dlg.current?.showModal(); }, []);
  const changed = status !== row.status || reply.trim() !== (row.response ?? '');

  const save = async (e) => {
    e.preventDefault();
    if (!statuses.includes(status)) { toast('Choose a valid status.', 'error'); return; }
    setBusy(true);
    const { error } = await supabase.from('feedback_report').update({ status, response: reply.trim() || null }).eq('feedback_report_id', row.id);
    setBusy(false);
    if (error) { toast(error.message, 'error'); return; }
    reload();
    onSaved(`Report #${row.id} saved${reply.trim() !== (row.response ?? '') ? ' with your reply' : ''}. The resident is notified in the app.`);
  };

  return (
    <dialog ref={dlg} className="drawer" onClose={onClose} onCancel={onClose} aria-labelledby="fbTitle">
      <div className="drawer-head">
        <div>
          <span className="note">Report #{row.id}</span>
          <h2 id="fbTitle">{row.type}</h2>
        </div>
        <span className={`chip ${chipCss(row)}`}>{row.status}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => dlg.current?.close()} aria-label="Close">Close</button>
      </div>
      <div className="drawer-body">
        {row.description ? <p style={{ fontSize: 'var(--fs-md)', marginBottom: 14 }}>{row.description}</p> : <p className="muted" style={{ marginBottom: 14 }}>No description.</p>}
        {row.photo_path ? <Photo path={row.photo_path} /> : null}
        <dl className="dl-grid">
          <dt>Resident</dt><dd>{row.resident}<div className="muted">{[row.contact, row.email].filter(Boolean).join(' · ')}</div></dd>
          <dt>Zone</dt><dd>{row.zone}</dd>
          <dt>Submitted</dt><dd>{row.created_at ? fmtStamp(row.created_at, true) : '–'}{row.open && row.age_days !== null ? <div className="muted">{row.age_days} day(s) open</div> : null}</dd>
          {row.resolved_at ? <><dt>Closed</dt><dd>{fmtStamp(row.resolved_at, true)}</dd></> : null}
        </dl>
        {row.lat !== null ? (
          <div style={{ margin: '14px 0' }}>
            <PinMap lat={row.lat} lng={row.lng} />
            <a className="panel-link" href={`https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
          </div>
        ) : <p className="muted" style={{ margin: '12px 0' }}>The resident did not share a location.</p>}

        {row.stars ? <RatingBlock row={row} /> : null}

        <h3 className="drawer-sub">History</h3>
        <ol className="fb-history">
          <li><strong>Sent by the resident</strong><span className="muted">{row.created_at ? fmtStamp(row.created_at, true) : ''}</span></li>
          {(history ?? []).map((h) => {
            const by = `${h.barangay_admin?.firstname ?? ''} ${h.barangay_admin?.lastname ?? ''}`.trim() || 'Barangay Admin';
            return (
              <li key={h.feedback_update_id}>
                <strong>{h.status ? `Marked ${h.status}` : 'Reply updated'}</strong>
                <span className="muted">{fmtStamp(toManila(h.created_at), true)} · {by}</span>
                {h.note ? <blockquote>{h.note}</blockquote> : null}
              </li>
            );
          })}
        </ol>

        {editable ? (
          <form onSubmit={save} className="stack" style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="fbStatus">Status</label>
              <select className="select" id="fbStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fbReply">Reply to the resident <span className="muted">(shown in their app)</span></label>
              <textarea className="input" id="fbReply" rows={4} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)}
                placeholder="What the barangay is doing about it" />
              <div className="btn-row" style={{ marginTop: 6 }}>
                {QUICK_REPLIES.map((q) => <button key={q} type="button" className="btn btn-ghost btn-sm" onClick={() => setReply(q)}>{q.split('.')[0]}</button>)}
              </div>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" type="submit" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save and notify the resident'}</button>
            </div>
          </form>
        ) : row.response ? (
          <><h3 className="drawer-sub">Barangay’s reply</h3><blockquote>{row.response}</blockquote></>
        ) : null}
      </div>
    </dialog>
  );
}

export default function Feedback() {
  const { role, refreshBadges } = usePanel();
  const editable = role === 'barangay';
  const [params, setParams] = useSearchParams();
  const [success, setSuccess] = useState('');
  const [openId, setOpenId] = useState(null);
  const [q, setQ] = useSearchText();
  const { data: ops, error, loading, reload } = useLoad(() => loadOps({ feedback: true, fleet: false }), []);

  const status = params.get('status') ?? 'open';
  const type = params.get('type') ?? '';
  const zone = Number(params.get('zone') || 0);
  const rangeKey = ['7', '30', '90', 'month'].includes(params.get('range')) ? params.get('range') : '90';
  const setFilter = (k) => (e) => { const n = new URLSearchParams(params); n.set(k, e.target.value); setParams(n, { replace: true }); };

  let rows = [], total = 0, sum = null, statuses = [], types = [], label = '', ratings = { good: 0, poor: 0, pct: null }, sat = null;
  if (ops) {
    const [from, to, l] = rangeFrom(rangeKey, ops.clock.date);
    label = l;
    rows = ops.feedback({ from, to, status: status === 'all' ? '' : status, type, zone_id: zone });
    total = rows.length;
    rows = rows.filter((r) => matchesSearch(q, [`#${r.id}`, String(r.id), r.type, r.description, r.resident, r.email, r.contact, r.zone, r.status, r.response, r.stars_comment]));
    sum = ops.feedbackSummary(from, to);
    statuses = ops.feedbackStatuses();
    types = [...new Set((ops.d.feedback ?? []).map((r) => r.report_type).filter(Boolean))].sort();
    ratings = ops.ratingSummary(from, to);
    sat = ops.satisfactionSummary(from, to);
  }
  const openRow = openId !== null ? (ops?.feedback({}) ?? []).find((r) => r.id === openId) : null;

  return (
    <>
      <PageHead title="Resident feedback" desc={editable
        ? 'Concerns residents send from the mobile app. Open one to reply and update its status; the resident sees both in the app and is notified.'
        : 'Every concern residents have sent from the mobile app, with the barangay’s replies and how long unresolved ones have been open.'} />
      {!editable && <ReadonlyBanner>View only. The Barangay Admin replies to residents and updates report status.</ReadonlyBanner>}
      <Messages success={success} />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !ops && <Loading />}
      {ops && (
        <>
          <div className="status-strip mb">
            <div className="status-cell cell-delayed"><span className="lbl">Unresolved now</span><span className="num">{sum.open_all_time}</span><span className="sub">{sum.oldest_open_days !== null ? `Oldest ${sum.oldest_open_days} days` : 'All periods'}</span></div>
            <div className="status-cell cell-brand"><span className="lbl">Submitted</span><span className="num">{sum.total}</span><span className="sub">{label}</span></div>
            <div className="status-cell cell-done"><span className="lbl">Closed</span><span className="num">{sum.total - sum.open}</span><span className="sub">Resolved or dismissed, same period</span></div>
            <div className="status-cell cell-pending"><span className="lbl">Pickup ratings</span><span className="num">{ratings.pct !== null ? `${ratings.pct}% good` : '–'}</span><span className="sub">{ratings.good} good · {ratings.poor} had a problem, {label.toLowerCase()}</span></div>
            <div className="status-cell cell-brand"><span className="lbl">Handling rating</span><span className="num">{sat.avg !== null ? `${sat.avg} ★` : '–'}</span><span className="sub">{sat.n ? `${sat.n} rating${sat.n === 1 ? '' : 's'} · ${sat.satisfied_pct}% gave 4–5 ★` : 'No ratings yet'}</span></div>
          </div>
          <section className="panel mb">
            <div className="filters panel-body">
              <div className="field"><label htmlFor="fStatus">Status</label><select className="select" id="fStatus" value={status} onChange={setFilter('status')}>
                <option value="open">Unresolved</option><option value="closed">Closed</option><option value="all">All</option>
                {statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
              <div className="field"><label htmlFor="fType">Type</label><select className="select" id="fType" value={type} onChange={setFilter('type')}><option value="">All types</option>
                {types.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div className="field"><label htmlFor="fZone">Zone</label><select className="select" id="fZone" value={zone} onChange={setFilter('zone')}><option value="0">All zones</option>
                {ops.zones().map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></div>
              <div className="field"><label htmlFor="fRange">Submitted</label><select className="select" id="fRange" value={rangeKey} onChange={setFilter('range')}>
                {[['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            </div>
            <SearchBar id="fbSearch" label="Search resident feedback" value={q} onChange={setQ}
              placeholder="Search report number, resident, message, zone, status or reply" shown={rows.length} total={total} />
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>#</th><th>Report</th><th>Resident</th><th>Zone</th><th>Submitted</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {!rows.length && q.trim() && total > 0 && <NoMatchRow colSpan={7} q={q} />}
                  {!total && <tr><td colSpan={7}><Empty icon="message" title="No reports match" text={status === 'open' ? 'There are no unresolved reports for these filters.' : 'Try a longer period or clear the filters.'} /></td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="muted">{r.id}</td>
                      <td><strong>{r.type}</strong>{r.description && <div style={{ maxWidth: '46ch' }}>{r.description.length > 140 ? `${r.description.slice(0, 140)}…` : r.description}</div>}
                        <div className="muted">{r.lat !== null ? 'Location shared' : 'No location'}{r.photo_path ? ' · Photo' : ''}{r.response ? ' · Replied' : ''}{r.stars ? <> · Rated <StarText n={r.stars} /></> : ''}</div></td>
                      <td>{r.resident}<div className="muted">{r.contact || r.email}</div></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.zone}</td>
                      <td>{r.created_at ? fmtStamp(r.created_at, true) : '–'}{r.open && r.age_days !== null && <div className="muted">{r.age_days} day(s) open</div>}</td>
                      <td><span className={`chip ${chipCss(r)}`}>{r.status}</span></td>
                      <td className="actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(r.id)}>{editable ? 'Open · reply' : 'Open'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {openRow && (
        <Detail key={openRow.id} row={openRow} statuses={statuses} editable={editable} onClose={() => setOpenId(null)}
          onSaved={(m) => { setSuccess(m); reload(); refreshBadges(); }} />
      )}
    </>
  );
}

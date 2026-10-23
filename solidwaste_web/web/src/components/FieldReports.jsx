// "Field reports from the truck": problems the collector reported in the mobile app.
// Barangay Admin marks them Seen / Resolved; the LGU Admin views them.
import { useState } from 'react';
import { supabase, explain } from '../lib/supabase';
import { fmtStamp } from '../lib/time';
import { toast } from '../lib/ui';

const MARK = { Open: 'delayed', Acknowledged: 'pending', Resolved: 'done' };
const LABEL = { Open: 'New', Acknowledged: 'Seen', Resolved: 'Resolved' };

export default function FieldReports({ field, editable, onChanged }) {
  const [busy, setBusy] = useState(null);
  const setStatus = async (r, status) => {
    setBusy(r.id);
    const { error } = await supabase.from('field_report').update({ status }).eq('field_report_id', r.id);
    setBusy(null);
    if (error) { toast(explain(error), 'error'); return; }
    toast(status === 'Resolved' ? 'Field report resolved.' : 'Field report marked as seen.');
    onChanged?.();
  };
  return (
    <section className="panel" aria-labelledby="frTitle">
      <div className="panel-head"><h2 id="frTitle">Field reports from the truck</h2>
        {field ? <span className="note">{field.open} unresolved</span> : null}</div>
      <div className="panel-body flush"><ul className="list list-scroll">
        {field && (field.items.length ? field.items.map((r) => (
          <li key={r.id}>
            <span className={`mark ${MARK[r.status] || ''}`}>{r.type.charAt(0)}</span>
            <span className="grow"><span className="title">{r.type}{r.place ? ` · ${r.place}` : ''}</span>
              <span className="meta">{r.collector} · {fmtStamp(r.at)}{r.description ? ` — ${r.description.slice(0, 90)}` : ''}</span></span>
            {editable && r.status !== 'Resolved' ? (
              <span className="btn-row" style={{ flexWrap: 'nowrap' }}>
                {r.status === 'Open' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => setStatus(r, 'Acknowledged')}>Seen</button>}
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => setStatus(r, 'Resolved')}>Resolved</button>
              </span>
            ) : <span className={`chip ${MARK[r.status] === 'done' ? 'done' : MARK[r.status] === 'pending' ? 'pending' : 'delayed'}`}>{LABEL[r.status]}</span>}
          </li>
        )) : (
          <li className="empty" style={{ display: 'grid' }}><strong>No field reports</strong>
            <span>Problems the truck crew reports in the mobile app (blocked road, breakdown…) appear here.</span></li>
        ))}
      </ul></div>
    </section>
  );
}

// Shared page parts (page_head, readonly_banner, render_messages, empty_state from the PHP version).
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from './Icon';
import { usePanel } from './Layout';

/** Sets the top-bar title and prints the page heading block. */
export function PageHead({ title, topTitle, desc, children }) {
  const panel = usePanel();
  useEffect(() => { panel?.setTitle(topTitle ?? title); }, [panel, title, topTitle]);
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {desc ? <p>{desc}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </div>
  );
}

export function ReadonlyBanner({ children }) {
  return <div className="readonly-banner"><Icon name="eye" /><span>{children}</span></div>;
}

/** Errors (one per line) and success messages above a form. */
export function Messages({ errors = [], success = '' }) {
  return (
    <>
      {errors.length > 0 && (
        <div className="flash-stack"><div className="alert alert-error" role="alert">{errors.map((e, i) => <p key={i}>{e}</p>)}</div></div>
      )}
      {success && <div className="flash-stack"><div className="alert alert-success" role="status"><p>{success}</p></div></div>}
    </>
  );
}

export function Empty({ title, text, icon = 'calendar' }) {
  return <div className="empty"><Icon name={icon} /><strong>{title}</strong><span>{text}</span></div>;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="empty" aria-busy="true"><div className="skeleton" style={{ height: 14, width: 180 }} /><span>{label}</span></div>;
}

export function LoadError({ message, onRetry }) {
  return (
    <div className="alert alert-error mb" role="alert">
      <p>{message || 'The data could not be loaded.'}</p>
      {onRetry && <p style={{ marginTop: 8 }}><button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}><Icon name="refresh" />Try again</button></p>}
    </div>
  );
}

/** Flash message that survives a navigation (like the PHP flash()). */
const FLASH_KEY = 'ecollect-flash';
export function flash(type, message) {
  try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ type, message })); } catch { /* ignore */ }
}
export function FlashMessage() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (raw) { setMsg(JSON.parse(raw)); sessionStorage.removeItem(FLASH_KEY); }
    } catch { /* ignore */ }
  }, []);
  if (!msg) return null;
  const cls = msg.type === 'error' ? 'alert-error' : msg.type === 'info' ? 'alert-info' : 'alert-success';
  return <div className="flash-stack"><div className={`alert ${cls}`} role={msg.type === 'error' ? 'alert' : 'status'}><p>{msg.message}</p></div></div>;
}

/**
 * Loads data with an async function; reload() re-runs it.
 * Returns { data, error, loading, reload }.
 */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const seq = useRef(0);
  const run = async () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await fn();
      if (n === seq.current) setState({ data, error: '', loading: false });
    } catch (e) {
      if (n === seq.current) setState((s) => ({ ...s, error: e.message || 'The data could not be loaded.', loading: false }));
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);
  return { ...state, reload: run };
}

export const zoneBadgeStyle = (color, small) => (small
  ? { display: 'inline-grid', width: 18, height: 18, fontSize: 10, marginRight: 6, verticalAlign: -3, background: color }
  : { background: color });

/** A pop-up window (native <dialog>): closes with Cancel, the close button, Escape or a click outside. */
export function Modal({ open, title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} aria-labelledby="modal-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      {open && children}
    </dialog>
  );
}

/** Search text kept in the address bar (?q=), so a refresh or a shared link keeps it. */
export function useSearchText() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const set = (v) => {
    setQ(v);
    setParams((prev) => { const n = new URLSearchParams(prev); if (v.trim()) n.set('q', v); else n.delete('q'); return n; }, { replace: true });
  };
  return [q, set];
}

/** True when every word of the search appears somewhere in the given fields (case-insensitive). */
export function matchesSearch(q, fields) {
  const words = String(q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter((x) => x !== null && x !== undefined && x !== '').join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The one search bar used on every list page: icon and "x of y shown". Clear it with Backspace (or Esc). */
export function SearchBar({ id, label, value, onChange, placeholder, shown, total }) {
  return (
    <div className="search-row list-search">
      <div className="search-box">
        <Icon name="search" />
        <label className="sr-only" htmlFor={id}>{label}</label>
        <input id={id} className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />
      </div>
      {value.trim() ? <span className="note" role="status">{shown} of {total} shown</span> : null}
    </div>
  );
}

/** Table row shown when the search hides every row. */
export function NoMatchRow({ colSpan, q }) {
  return (
    <tr><td colSpan={colSpan}>
      <Empty icon="search" title="No matches" text={`Nothing here matches “${q.trim()}”.`} />
    </td></tr>
  );
}

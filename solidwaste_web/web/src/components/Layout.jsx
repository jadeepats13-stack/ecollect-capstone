// Page shell for both admin panels (port of includes/layout.php).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { useAuth, ROLE_LABEL } from '../auth';
import { supabase } from '../lib/supabase';
import { FEEDBACK_CLOSED_STATUSES, SITE_NAME } from '../config';

export const NAV = {
  barangay: {
    Operations: [
      ['dashboard', 'Dashboard', 'dashboard'],
      ['map', 'Live map', 'map'],
      ['schedules', 'Collection schedule', 'calendar'],
      ['emergency', 'Emergency collections', 'alert'],
      ['routes', 'Zones & routes', 'zones'],
      ['feedback', 'Resident feedback', 'message'],
    ],
    Resources: [
      ['collectors', 'Garbage collectors', 'people'],
      ['trucks', 'Trucks', 'truck'],
      ['waste-categories', 'Waste categories', 'bin'],
      ['announcements', 'Announcements', 'megaphone'],
      ['reports', 'Reports', 'report'],
      ['submitted', 'Sent to the LGU', 'send'],
    ],
  },
  lgu: {
    Monitoring: [
      ['dashboard', 'Overview', 'dashboard'],
      ['map', 'Live map', 'map'],
      ['reports', 'Performance reports', 'report'],
      ['submitted', 'Submitted reports', 'send'],
      ['schedules', 'Collection schedule', 'calendar'],
      ['emergency', 'Emergency collections', 'alert'],
      ['routes', 'Zones & routes', 'zones'],
      ['feedback', 'Resident feedback', 'message'],
      ['announcements', 'Announcements', 'megaphone'],
    ],
    Administration: [
      ['barangay-admins', 'Barangay admins', 'shield'],
      ['trucks', 'Trucks', 'truck'],
      ['collectors', 'Garbage collectors', 'people'],
      ['residents', 'Residents', 'resident'],
      ['waste-categories', 'Waste categories', 'bin'],
    ],
  },
};

// ---------- per-page context: title, live indicator, badge refresh ----------
const PageCtx = createContext(null);
export const usePanel = () => useContext(PageCtx);

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ecollect-theme', next); } catch { /* private mode */ }
    setTheme(next);
    document.dispatchEvent(new CustomEvent('ecollect:theme', { detail: next }));
  };
  return [theme, toggle];
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const time = now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila' });
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  return <div className="topbar-clock"><strong>{time}</strong><span>{date}</span></div>;
}

export default function Layout({ role }) {
  const auth = useAuth();
  const me = auth.profile(role);
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const [sideOpen, setSideOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [live, setLive] = useState(null);
  const [badges, setBadges] = useState({});

  // The admin stylesheet keys off <body class="app-body" data-panel="...">.
  useEffect(() => {
    document.body.classList.add('app-body');
    document.body.dataset.panel = role;
    return () => { document.body.classList.remove('app-body'); delete document.body.dataset.panel; };
  }, [role]);

  useEffect(() => { setSideOpen(false); setLive(null); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSideOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const refreshBadges = useCallback(async () => {
    const closed = `(${FEEDBACK_CLOSED_STATUSES.map((s) => `"${s}"`).join(',')})`;
    const [fb, em, sub] = await Promise.all([
      supabase.from('feedback_report').select('*', { count: 'exact', head: true }).not('status', 'in', closed),
      supabase.from('emergency_collection').select('*', { count: 'exact', head: true }).in('status', ['Scheduled', 'In progress']),
      // Submitted reports: new ones for the LGU to review; returned ones for the barangay to look at.
      supabase.from('reports').select('*', { count: 'exact', head: true }).eq('submitted', true).eq('review_status', role === 'lgu' ? 'Sent' : 'Returned'),
    ]);
    setBadges({ feedback: fb.count || 0, emergency: em.count || 0, submitted: sub.count || 0 });
  }, [role]);
  useEffect(() => {
    refreshBadges().catch(() => {});
    const t = setInterval(() => refreshBadges().catch(() => {}), 60000);
    return () => clearInterval(t);
  }, [refreshBadges, location.pathname]);

  useEffect(() => {
    const panel = ROLE_LABEL[role];
    document.title = title ? `${title} · ${panel} · ${SITE_NAME}` : `${panel} · ${SITE_NAME}`;
  }, [title, role]);

  const ctx = useMemo(() => ({ role, setTitle, setLive, refreshBadges, me }), [role, refreshBadges, me]);
  if (!me) return null;
  const name = me.name || auth.email;
  const logo = role === 'lgu' ? '/images/icenro.jpg' : '/images/poblogo.png';
  const sub = role === 'lgu' ? 'Iligan City LGU monitoring' : 'Barangay Poblacion operations';

  return (
    <PageCtx.Provider value={ctx}>
      <a className="sr-only" href="#main">Skip to content</a>
      <div className="app">
        <aside className={`sidebar${sideOpen ? ' open' : ''}`} id="sidebar" aria-label="Main navigation">
          <Link className="side-brand" to={`/${role}/dashboard`}>
            <img src={logo} alt="" />
            <span><strong>{SITE_NAME}</strong><span>{sub}</span></span>
          </Link>
          {Object.entries(NAV[role]).map(([group, items]) => (
            <div className="side-group" key={group}>
              <div className="side-group-title">{group}</div>
              {items.map(([key, label, ico]) => (
                <NavLink key={key} className="side-link" to={`/${role}/${key}`}>
                  <Icon name={ico} /><span>{label}</span>
                  {badges[key] > 0 && <span className="side-count" title={key === 'submitted' ? (role === 'lgu' ? 'New, not reviewed yet' : 'Returned with comments') : 'Unresolved'}>{badges[key]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="side-foot">
            <button type="button" className="side-link" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
              onClick={async () => { await auth.signOut(); navigate('/', { replace: true }); }}>
              <Icon name="logout" /><span>Sign out</span>
            </button>
          </div>
        </aside>
        <div className={`side-scrim${sideOpen ? ' open' : ''}`} onClick={() => setSideOpen(false)} />

        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={sideOpen} aria-controls="sidebar" onClick={() => setSideOpen((v) => !v)}>
              <Icon name="menu" />
            </button>
            <div className="topbar-title">{title}</div>
            <div className="topbar-spacer" />
            {live && <span className={`live-dot${live.state === 'stale' ? ' is-stale' : ''}${live.state === 'error' ? ' is-error' : ''}`} aria-live="polite">{live.text}</span>}
            <Clock />
            <button className="icon-btn" aria-label="Switch light or dark theme" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
              <span className="who">{name}<small>{ROLE_LABEL[role]}</small></span>
            </div>
          </header>
          <main className="page" id="main">
            <Outlet />
          </main>
        </div>
      </div>
    </PageCtx.Provider>
  );
}

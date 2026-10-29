// Public home page: what ECollect is, this week's pickup days (live from the database), the resident app
// download (link + QR code), contact, and the admin sign-in window.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuth } from '../auth';
import { SITE_NAME } from '../config';
import { supabase } from '../lib/supabase';

/* ------------------------------------------------------------------------------------------------
 * APP DOWNLOAD LINK: paste the install link of the Android build from expo.dev here
 * (expo.dev → your project → Builds → the preview build → "Install" / share link).
 * Leave it empty and the page shows "Download link coming soon" instead of a broken button.
 * ---------------------------------------------------------------------------------------------- */
const APP_DOWNLOAD_URL = 'https://expo.dev/accounts/jadee55/projects/ecollect/builds/81760df7-9e50-432a-9d26-9d0c206200ca';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** The barangay collects Monday to Saturday; there is no service on Sunday. */
const SERVICE_DAYS = DAYS.slice(0, 6);
const REFRESH_MS = 60000;
const CONTACT = { phone: '09358158491', email: 'juswarey@gmail.com', hours: 'Monday to Friday, 8:00 AM to 5:00 PM' };

/** Philippine date and time, refreshed every second. */
function useManilaNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const part = (o) => now.toLocaleString('en-US', { timeZone: 'Asia/Manila', ...o });
  return {
    time: part({ hour: 'numeric', minute: '2-digit', second: '2-digit' }),
    date: part({ weekday: 'short', month: 'short', day: 'numeric' }),
    weekday: part({ weekday: 'long' }),
    hhmm: part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  };
}

const clock12 = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
/** "5:00–5:30 PM", or "11:30 AM–12:30 PM" when the halves differ. */
const range = (a, b) => {
  if (!b) return clock12(a);
  const [x, y] = [clock12(a), clock12(b)];
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`;
};
const zoneNo = (n) => Number(String(n).replace(/\D/g, '')) || 0;
const zoneList = (zones) => {
  const nums = zones.map(zoneNo).sort((a, b) => a - b);
  return nums.length === 1 ? `Zone ${nums[0]}` : `Zones ${nums.slice(0, -1).join(', ')} and ${nums.at(-1)}`;
};

/** The zones' pickup days and times, as set by the barangay (the one table visitors may read).
 *  Reloads every minute and when the tab comes back into view, so schedule changes show without a page reload. */
function useWeekSchedule() {
  const [state, setState] = useState({ loading: true, error: '', week: null, dropOff: [], zones: [] });
  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('route').select('zone_name, collection_days, start_time, end_time, collection_mode').then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) {
        // Keep showing the last good schedule if a later refresh fails.
        setState((prev) => (prev.week ? prev : { loading: false, error: 'The schedule could not load. Check your internet connection and reload the page.', week: null, dropOff: [], zones: [] }));
        return;
      }
      const week = Object.fromEntries(DAYS.map((d) => [d, []]));
      for (const z of data) {
        if (z.collection_mode === 'drop_off' || !z.start_time) continue;
        for (const d of String(z.collection_days ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
          if (!week[d]) continue;
          const key = `${z.start_time}|${z.end_time ?? ''}`;
          let slot = week[d].find((x) => x.key === key);
          if (!slot) { slot = { key, start: z.start_time, end: z.end_time, zones: [] }; week[d].push(slot); }
          slot.zones.push(z.zone_name);
        }
      }
      for (const d of DAYS) week[d].sort((a, b) => a.start.localeCompare(b.start));
      setState({ loading: false, error: '', week, zones: data, dropOff: data.filter((z) => z.collection_mode === 'drop_off').map((z) => z.zone_name) });
    });
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    const onShow = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, []);
  return state;
}

/** One line for the header: today's collection, or when the next one is. */
function todayLine(week, now) {
  if (!week) return '';
  const today = week[now.weekday] ?? [];
  const open = today.filter((s) => (s.end ?? s.start).slice(0, 5) > now.hhmm);
  if (open.length) return `Today: ${open.map((s) => `${zoneList(s.zones)} at ${clock12(s.start)}`).join('; ')}`;
  if (today.length) return 'Today’s collection is done';
  const i = DAYS.indexOf(now.weekday);
  for (let k = 1; k <= 7; k++) {
    const d = DAYS[(i + k) % 7];
    if (week[d]?.length) return `No collection today. Next: ${k === 1 ? 'tomorrow' : d}, ${clock12(week[d][0].start)}`;
  }
  return 'No collection today';
}

function LoginModal({ open, onClose, initialError = '' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState('barangay');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (initialError) setError(initialError); }, [initialError]);
  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await auth.signIn(email, password, role);
      navigate(`/${r}/dashboard`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className={`modal-overlay${open ? ' active' : ''}`} aria-hidden={!open} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-container" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <button className="modal-close" aria-label="Close" onClick={onClose}>&times;</button>
        <Mark className="modal-mark" />
        <h2 className="modal-title" id="loginTitle">Admin sign in</h2>
        <p className="modal-note">For the Barangay Poblacion office and the LGU.</p>
        <form onSubmit={submit}>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <div className="form-group">
            <label htmlFor="login-role">Account type</label>
            <select id="login-role" className="form-control" value={role} onChange={(e) => setRole(e.target.value)} required>
              <option value="barangay">Barangay Admin</option>
              <option value="lgu">LGU Admin</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="login-email">Email address</label>
            <input type="email" id="login-email" className="form-control" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input type="password" id="login-password" className="form-control" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="modal-foot">Residents and garbage collectors sign in on the ECollect app, not here.</p>
        </form>
      </div>
    </div>
  );
}

function QrCode({ url }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14231d', light: '#ffffff' } })
      .then((s) => { if (alive) setSvg(s); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  // The SVG is generated locally from our own link (no outside QR service).
  return <div className="qr" role="img" aria-label="QR code for the ECollect app download" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const Icon = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  truck: <><path d="M2.5 6.5h11v9h-11zM13.5 9.5H18l3.5 3.5v2.5h-8" /><circle cx="6.5" cy="17.5" r="2" /><circle cx="17.5" cy="17.5" r="2" /></>,
  hall: <path d="M3 21h18M4 21V10M20 21V10M8 21v-6h8v6M2.5 10 12 4l9.5 6" />,
  phone: <path d="M5 3.5h3l1.5 4.5-2 1.2a11 11 0 0 0 5.3 5.3l1.2-2 4.5 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  pin: <><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  bell: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0" />,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  news: <path d="M4 10v4h3l7 4V6l-7 4zM17.5 9.5a3.5 3.5 0 0 1 0 5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  cal: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
};
/** The ECollect "E" with a leaf, traced from the official logo (same drawing as /images/ecollect-mark.svg).
 *  Colours follow the theme. */
function Mark({ className = '' }) {
  return (
    <svg className={`mark ${className}`} viewBox="332 339 590 590" aria-hidden="true">
      <path className="mark-e" d="M341,394 A48,48 0 0 1 389,346 L740,346 A64.5,64.5 0 0 1 740,475 L483,475 L483,558 C560,522 680,503 790,504 L913,506 C880,600 790,690 650,703 C580,708 520,700 483,694 L483,791 L746,791 A65.5,65.5 0 0 1 746,922 L389,922 A48,48 0 0 1 341,874 Z" />
      <path className="mark-vein" d="M502,656 Q664,588 843,545" fill="none" strokeWidth="18" strokeLinecap="round" />
    </svg>
  );
}

/** The days of one zone, in calendar order: "Monday, Wednesday and Friday". */
const dayList = (days) => (days.length < 2 ? days.join('') : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`);

/** The next six service days in Manila (Sunday skipped), starting today: [{ weekday, short, day, offset }]. */
function nextServiceDays() {
  return Array.from({ length: 7 }, (_, k) => {
    const d = new Date(Date.now() + k * 86400000);
    const f = (o) => d.toLocaleString('en-US', { timeZone: 'Asia/Manila', ...o });
    return { weekday: f({ weekday: 'long' }), short: f({ weekday: 'short' }), day: f({ day: 'numeric' }), offset: k };
  }).filter((d) => SERVICE_DAYS.includes(d.weekday));
}

/** The resident app's Home screen, drawn here from Zone 5's real schedule so it is right on any day. */
const SHOWN_ZONE = 5;
function PhoneHome({ zones, loading, now }) {
  const zone = zones.find((z) => zoneNo(z.zone_name) === SHOWN_ZONE && z.collection_mode !== 'drop_off' && z.start_time)
    ?? zones.find((z) => z.collection_mode !== 'drop_off' && z.start_time);
  const days = zone ? SERVICE_DAYS.filter((d) => String(zone.collection_days ?? '').split(',').map((x) => x.trim()).includes(d)) : [];
  const week = nextServiceDays();
  const doneToday = zone && (zone.end_time ?? zone.start_time).slice(0, 5) <= now.hhmm;
  const pickupToday = days.includes(now.weekday) && !doneToday;
  const next = week.find((d) => days.includes(d.weekday) && (d.offset > 0 || pickupToday)) ?? null;
  const time = zone ? range(zone.start_time, zone.end_time) : '';
  const when = !next ? '' : next.offset === 0 ? 'Today' : next.offset === 1 ? 'Tomorrow' : next.weekday;
  const note = pickupToday ? 'Bring your garbage out before the truck arrives.'
    : days.includes(now.weekday) ? 'Today’s pickup is done.' : 'No pickup today.';

  return (
    <figure className="phone">
      <div className="phone-screen" role="img" aria-label={zone ? `The ECollect resident app Home screen for ${zone.zone_name}: next pickup ${when}, ${time}` : 'The ECollect resident app Home screen'}>
        <div className="ph-status"><span className="ph-live"><i aria-hidden="true" />{now.hhmm}<em>Live</em></span><span className="ph-signal" aria-hidden="true"><i /><i /><i /><b /></span></div>
        <div className="ph-head">
          <div><p className="ph-eyebrow">{zone ? `Zone ${zoneNo(zone.zone_name)}` : 'Your zone'} · Barangay Poblacion</p><p className="ph-hi">Hi, neighbor!</p></div>
          <span className="ph-bell"><Svg name="bell" /></span>
        </div>
        {loading ? <div className="ph-card ph-loading">Loading the schedule…</div> : !zone ? <div className="ph-card ph-loading">The schedule could not load.</div> : (
          <>
            <div className="ph-card ph-next">
              <p className="ph-label">{pickupToday ? 'Pickup today' : 'Next pickup'}</p>
              <p className="ph-when">{when}</p>
              <p className="ph-time"><Svg name="clock" />{time}</p>
              <p className="ph-note">{note}</p>
            </div>
            <div className="ph-row"><p className="ph-label">This week</p></div>
            <ol className="ph-week">
              {week.map((d) => {
                const on = days.includes(d.weekday);
                return (
                  <li key={d.weekday} className={`${on ? 'on' : ''}${d.offset === 0 ? ' now' : ''}`}>
                    <span>{d.short}</span><strong>{d.day}</strong><i aria-hidden="true" />
                  </li>
                );
              })}
            </ol>
            <div className="ph-card ph-days">
              <span className="ph-ico"><Svg name="cal" /></span>
              <div><p className="ph-title">Pickup days</p><p>{dayList(days)}</p><p className="ph-muted">{time} at your zone’s truck stops</p></div>
            </div>
            <div className="ph-card ph-days">
              <span className="ph-ico"><Svg name="truck" /></span>
              <div><p className="ph-title">Track the truck</p><p className="ph-muted">See it move on the map while your zone’s collector is on shift.</p></div>
            </div>
          </>
        )}
        <nav className="ph-tabs" aria-hidden="true">
          {[['home', 'Home'], ['pin', 'Truck'], ['chat', 'Report'], ['news', 'News'], ['menu', 'More']].map(([i, l], k) => (
            <span key={l} className={k === 0 ? 'on' : ''}><Svg name={i} />{l}</span>
          ))}
        </nav>
      </div>
      <figcaption>The app’s Home screen, using {zone ? `${zone.zone_name}’s` : 'a zone’s'} real schedule</figcaption>
    </figure>
  );
}

const Svg = ({ name }) => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{Icon[name]}</svg>;

export default function Landing() {
  const auth = useAuth();
  const navigate = useNavigate();
  const now = useManilaNow();
  const sched = useWeekSchedule();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [expired, setExpired] = useState('');
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');
  const [scrolled, setScrolled] = useState(false);
  const line = useMemo(() => todayLine(sched.week, now), [sched.week, now]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('ecollect-expired')) {
        sessionStorage.removeItem('ecollect-expired');
        setExpired('You were signed out after 30 minutes without activity. Please sign in again.');
        setOpen(true);
      }
    } catch { /* ignore */ }
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('ecollect-theme', next); } catch { /* ignore */ }
    setTheme(next);
  };
  const signedIn = auth.signedIn && auth.activeRole;
  const openLogin = (e) => {
    e?.preventDefault();
    if (signedIn) { navigate(`/${auth.activeRole}/dashboard`); return; }
    setOpen(true);
  };
  const year = new Date().getFullYear();

  return (
    <div className="landing">
      <header className={`site-header${scrolled ? ' scrolled' : ''}`}>
        <div className="container header-row">
          <a href="#home" className="brand" aria-label={`${SITE_NAME}, Barangay Poblacion`}>
            <Mark />
            <span className="brand-text"><strong>{SITE_NAME}</strong><span>Barangay Poblacion, Iligan City</span></span>
          </a>
          <nav className={`nav${menu ? ' open' : ''}`} aria-label="Main navigation">
            {[['schedule', 'Pickup days'], ['app', 'Get the app'], ['about', 'What it does'], ['contact', 'Contact']].map(([id, l]) => (
              <a key={id} href={`#${id}`} onClick={() => setMenu(false)}>{l}</a>
            ))}
          </nav>
          <div className="clock" aria-live="off">
            <span className="clock-time"><span className="clock-dot" aria-hidden="true" />{now.time}<span className="clock-date">{now.date}</span></span>
            <a href="#schedule" className="clock-today">{sched.loading ? 'Loading today’s collection…' : sched.error ? 'Schedule unavailable' : line}</a>
          </div>
          <div className="header-actions">
            <button className="icon-btn" aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'} onClick={toggleTheme}>
              {theme === 'dark'
                ? <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>
                : <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z" /></svg>}
            </button>
            <a href="#" className="btn btn-primary btn-sm" onClick={openLogin}>{signedIn ? 'Open dashboard' : 'Admin login'}</a>
            <button className={`menu-btn${menu ? ' open' : ''}`} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><span /><span /><span /></button>
          </div>
        </div>
      </header>

      <main>
        <section id="home" className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <h1>Know when the garbage truck comes to your zone.</h1>
              <p className="lead">ECollect is Barangay Poblacion’s garbage collection system. Residents see their pickup days and the truck on a live map, collectors log every stop, and the barangay office follows it all from one place.</p>
              <div className="hero-actions">
                <a href="#app" className="btn btn-primary btn-lg">Get the resident app</a>
                <a href="#" className="btn btn-quiet btn-lg" onClick={openLogin}>{signedIn ? 'Open dashboard' : 'Admin login'}</a>
              </div>
              <div className="hero-meta">
                <span className="seals">
                  <img src="/images/iligan.jpg" alt="City of Iligan seal" />
                  <img src="/images/icenro.jpg" alt="LGU Iligan seal" />
                  <img src="/images/poblogo.png" alt="Barangay Poblacion seal" />
                </span>
                <p>For the 10 zones of Barangay Poblacion, Iligan City.</p>
              </div>
            </div>
            <PhoneHome zones={sched.zones} loading={sched.loading} now={now} />
          </div>
        </section>

        <section id="schedule" className="schedule">
          <div className="container">
            <div className="section-head">
              <h2>Pickup days this week</h2>
              <p>The truck stops at each zone’s collection point at these times. Bring your garbage out before the truck arrives.</p>
            </div>
            {sched.loading ? <p className="muted">Loading the schedule…</p> : sched.error ? <p className="notice">{sched.error}</p> : (
              <>
                <ol className="pickup-week">
                  {SERVICE_DAYS.map((d) => {
                    const slots = sched.week[d];
                    const today = d === now.weekday;
                    return (
                      <li key={d} className={`pickup-day${today ? ' today' : ''}${slots.length ? '' : ' no-pickup'}`} aria-current={today ? 'date' : undefined}>
                        <div className="day-name">{d}{today ? <span className="today-tag">Today</span> : null}</div>
                        {slots.length ? slots.map((s) => (
                          <div className="slot" key={s.key}>
                            <span className="slot-time">{range(s.start, s.end)}</span>
                            <span className="slot-zones">{zoneList(s.zones)}</span>
                          </div>
                        )) : <div className="slot none">No collection</div>}
                      </li>
                    );
                  })}
                </ol>
                <p className="muted small week-note">No collection on Sundays.</p>
                {sched.dropOff.length ? <p className="muted small">{zoneList(sched.dropOff)}: no truck stop. Residents bring their garbage to the place the barangay has set.</p> : null}
              </>
            )}
          </div>
        </section>

        <section id="app" className="get-app">
          <div className="container app-grid">
            <div>
              <h2>Get the resident app</h2>
              <p className="lead">See your zone’s pickup days, watch the truck come, get a reminder the night before, and report missed pickups or illegal dumping with a photo.</p>
              <ol className="steps">
                <li><strong>Download the app</strong> with the button or by scanning the code with your phone’s camera.</li>
                <li><strong>Allow the install.</strong> Android asks once because the app is not from the Play Store yet. Tap Settings, then allow this source.</li>
                <li><strong>Create your account</strong> and choose your zone. “Use my location” can find it for you.</li>
                <li><strong>Allow notifications</strong> so you hear when the truck is near and when the barangay replies.</li>
              </ol>
              <p className="muted small">Android only for now. Garbage collectors use the same app with the login the barangay gives them.</p>
            </div>
            <div className="download">
              {APP_DOWNLOAD_URL ? (
                <>
                  <QrCode url={APP_DOWNLOAD_URL} />
                  <p className="download-hint">Scan with your phone’s camera</p>
                  <a className="btn btn-primary btn-lg btn-block" href={APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Download for Android</a>
                </>
              ) : (
                <div className="download-soon">
                  <strong>Download link coming soon</strong>
                  <p>Ask the Barangay Poblacion office for the app in the meantime.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section id="about" className="about">
          <div className="container">
            <div className="section-head">
              <h2>What ECollect does</h2>
              <p>One system, used three ways.</p>
            </div>
            <div className="roles">
              <article>
                <Svg name="home" />
                <h3>Residents</h3>
                <ul>
                  <li>Your zone’s pickup days and truck stop</li>
                  <li>The truck on a live map while it collects</li>
                  <li>Reminders, and alerts when the truck is near</li>
                  <li>Reports with a photo, and the barangay’s reply</li>
                </ul>
              </article>
              <article>
                <Svg name="truck" />
                <h3>Garbage collectors</h3>
                <ul>
                  <li>Today’s stops in order, with directions</li>
                  <li>Mark each stop done or not collected, with the reason</li>
                  <li>Share the truck’s location during the shift</li>
                  <li>Works without signal and sends later</li>
                </ul>
              </article>
              <article>
                <Svg name="hall" />
                <h3>Barangay and LGU</h3>
                <ul>
                  <li>Schedules, zones and emergency pickups</li>
                  <li>The live map of every truck</li>
                  <li>Resident reports, replies and ratings</li>
                  <li>Performance reports sent to the LGU</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section id="contact" className="contact">
          <div className="container contact-grid">
            <div className="contact-info">
              <h2>Contact</h2>
              <p>Questions about collection days, a missed pickup or your account? Reach the barangay office.</p>
              <ul className="contact-list">
                <li><Svg name="pin" /><span>Barangay Poblacion Hall, Iligan City</span></li>
                <li><Svg name="phone" /><a href={`tel:${CONTACT.phone}`}>{CONTACT.phone}</a></li>
                <li><Svg name="mail" /><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
                <li><Svg name="clock" /><span>{CONTACT.hours}</span></li>
              </ul>
            </div>
            <div className="map-frame">
              <iframe title="Barangay Poblacion Hall on Google Maps" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d987.1840961705204!2d124.23391334638909!3d8.229242766848605!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x325575e7ac009721%3A0x5dd0875c959538f4!2sPoblacion%20Barangay%20Hall!5e0!3m2!1sen!2sph!4v1790219344394!5m2!1sen!2sph" />
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-row">
          <Mark className="small" />
          <p>&copy; {year} {SITE_NAME}, Barangay Poblacion, Iligan City</p>
          <a href="#" onClick={openLogin}>{signedIn ? 'Open dashboard' : 'Admin login'}</a>
        </div>
      </footer>
      <LoginModal open={open} onClose={() => setOpen(false)} initialError={expired} />
    </div>
  );
}

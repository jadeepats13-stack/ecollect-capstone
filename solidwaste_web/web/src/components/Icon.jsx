// Line icons from the PHP version (includes/layout.php icon()).
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  map: <><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" /><path d="M9 4v13M15 6.5v13" /></>,
  zones: <path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z" />,
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.4 3.4 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2" /></>,
  truck: <><path d="M2.5 6.5h11v9h-11zM13.5 9.5H18l3.5 3.5v2.5h-8" /><circle cx="6.5" cy="17.5" r="2" /><circle cx="17.5" cy="17.5" r="2" /></>,
  bin: <path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5M14 11v5" />,
  megaphone: <path d="M3.5 10v4h3l7 4.5v-13l-7 4.5h-3ZM17 8.5a5 5 0 0 1 0 7" />,
  message: <><path d="M4 4.5h16v11H9l-5 4v-15Z" /><path d="M8 9h8M8 12h5" /></>,
  report: <><path d="M6 3.5h9l4 4V20.5H6z" /><path d="M15 3.5v4h4M9 17v-3M12 17v-6M15 17v-4" /></>,
  shield: <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z" />,
  resident: <><path d="M4 11.5 12 5l8 6.5M6 10v10h12V10" /><path d="M10 20v-5h4v5" /></>,
  logout: <path d="M14 4.5h4.5v15H14M10 16l4-4-4-4M14 12H3.5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  alert: <><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></>,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  print: <path d="M7 8.5V4h10v4.5M7 16.5H4.5v-8h15v8H17M7 13.5h10V20H7z" />,
  refresh: <><path d="M19.5 11a7.5 7.5 0 0 0-13.6-3.5M4.5 13a7.5 7.5 0 0 0 13.6 3.5" /><path d="M5.5 3.5v4h4M18.5 20.5v-4h-4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  edit: <path d="M15 5l4 4L8.5 19.5H4.5v-4L15 5Z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  gps: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" /></>,
  swap: <path d="M7 7h11l-3-3M17 17H6l3 3" />,
};

export default function Icon({ name, className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  );
}

// Colours match the ECollect admin website (web/src/styles/app.css).
export const colors = {
  primary: '#1f6b4a',
  primaryDark: '#17533a',
  primaryLight: '#e3efe8',
  blue: '#2563a8',
  blueLight: '#e2ecf8',
  amber: '#a8670e',
  amberLight: '#fbefd9',
  bg: '#f3f5f2',
  surface: '#ffffff',
  surface2: '#f7f9f6',
  text: '#14231d',
  muted: '#4b5a53',
  faint: '#75837c',
  border: '#dfe5df',
  borderStrong: '#c7d0c8',
  danger: '#c2412d',
  dangerLight: '#fbe5e0',
  done: '#1f8a5b',
  doneLight: '#e1f2e9',
  onPrimary: '#ffffff',
  line: '#e8ece8',
  primaryMid: '#cfe3d7',
};

/** Collection status colours (same as the website: completed green, ongoing blue, pending amber, delayed red). */
export const status = {
  done: { fg: colors.done, bg: colors.doneLight, label: 'Done' },
  now: { fg: colors.blue, bg: colors.blueLight, label: 'Now' },
  upcoming: { fg: colors.amber, bg: colors.amberLight, label: 'Upcoming' },
  late: { fg: colors.danger, bg: colors.dangerLight, label: 'Late' },
  missed: { fg: colors.danger, bg: colors.dangerLight, label: 'Not collected' },
};

export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 };

/** Soft card shadow (Android elevation + iOS shadow). */
export const shadow = {
  card: { shadowColor: '#14231d', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  raised: { shadowColor: '#14231d', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
};

export const type = {
  title: { fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  overline: { fontSize: 12, fontWeight: '800', color: colors.faint, letterSpacing: 0.8, textTransform: 'uppercase' },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  small: { fontSize: 14, lineHeight: 19, color: colors.muted },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
};

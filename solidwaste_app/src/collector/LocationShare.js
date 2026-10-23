import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import * as gps from './gps';

const Ctx = createContext(null);
export const useLocationShare = () => useContext(Ctx);

const HOUR = 3600000;

/**
 * When sharing should stop by itself: one hour after the day's last stop or emergency ends,
 * or four hours from now when nothing is scheduled. Times are Philippine time from the server.
 */
export function autoStopFor(day) {
  const ends = [
    ...(day?.stops ?? []).map((s) => s.end),
    ...(day?.emergencies ?? []).filter((e) => e.date === day?.date).map((e) => e.end || e.start),
  ].filter(Boolean).sort();
  const last = ends[ends.length - 1];
  const fromSchedule = last && day?.date ? Date.parse(`${day.date}T${last}+08:00`) + HOUR : null;
  return Math.max(fromSchedule ?? 0, Date.now() + (fromSchedule ? 30 * 60000 : 4 * HOUR));
}

/** Truck GPS sharing state for every collector screen (the work itself is in gps.js). */
export function LocationShareProvider({ children }) {
  const [s, setS] = useState(gps.getState());
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => gps.subscribe(setS), []);
  useEffect(() => {
    gps.restoreSharing();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') gps.restoreSharing(); });
    return () => sub.remove();
  }, []);

  const start = useCallback(async (day) => {
    setBusy(true);
    setWarning('');
    try {
      const r = await gps.startSharing({ stopAt: autoStopFor(day) });
      setWarning(r.warning);
    } catch (e) {
      setWarning(e.message);
    } finally {
      setBusy(false);
    }
  }, []);
  const stop = useCallback(async () => { setWarning(''); await gps.stopSharing(); }, []);

  const value = useMemo(() => ({ ...s, warning, busy, start, stop, backgroundSupported: gps.backgroundSupported }), [s, warning, busy, start, stop]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

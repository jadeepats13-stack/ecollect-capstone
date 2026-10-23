// Things that run while a resident is signed in: notifications from the barangay (push),
// opening the right screen when a notification is tapped, and the unread announcements badge.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { registerPushToken } from '../data/resident';
import { countUnreadNotifications } from '../data/inbox';
import { onNotificationTap, registerForPush } from '../collector/notify';
import { navigationRef } from '../navigation/navRef';
import { SEEN_KEY } from '../shared/News';

const Ctx = createContext({ unread: 0, inbox: 0, pushNote: '', markRead: () => {}, retryPush: () => {}, refreshInbox: () => {} });
export const useResidentServices = () => useContext(Ctx);
export { SEEN_KEY };

/** Opens the screen for a notification (tapped on the phone or in the inbox). */
export function openResidentNotification(data) {
  if (!navigationRef.isReady()) return;
  const tab = (screen, params) => navigationRef.navigate('Tabs', { screen, params });
  if (data?.kind === 'announcement' && data.id) tab('News', { screen: 'NewsDetail', params: { id: Number(data.id) }, initial: false });
  else if (data?.kind === 'announcement') tab('News');
  else if (data?.kind === 'truck') tab('Truck');
  else if (data?.kind === 'report' && data.id) tab('Report', { screen: 'ReportDetail', params: { id: Number(data.id) }, initial: false });
  else tab('Home', { screen: 'HomeMain' });
}

async function unreadCount() {
  try {
    const seen = Number(await AsyncStorage.getItem(SEEN_KEY)) || 0;
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const { count, error } = await supabase.from('announcement').select('announcement_id', { count: 'exact', head: true })
      .gt('announcement_id', seen).or(`expiry_date.is.null,expiry_date.gte.${today}`);
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}

export function ResidentServicesProvider({ children }) {
  const [unread, setUnread] = useState(0);
  const [pushNote, setPushNote] = useState('');
  const [inbox, setInbox] = useState(0);
  const refreshInbox = useCallback(() => { countUnreadNotifications().then((n) => { if (n !== null) setInbox(n); }); }, []);

  const retryPush = useCallback(() => { registerForPush(registerPushToken).then(setPushNote); }, []);
  useEffect(() => {
    let alive = true;
    registerForPush(registerPushToken).then((note) => { if (alive) setPushNote(note); });
    return () => { alive = false; };
  }, []);
  useEffect(() => onNotificationTap(openResidentNotification), []);

  useEffect(() => {
    let alive = true;
    const count = () => {
      unreadCount().then((n) => { if (alive && n !== null) setUnread(n); });
      countUnreadNotifications().then((n) => { if (alive && n !== null) setInbox(n); });
    };
    count();
    const id = setInterval(count, 60000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') count(); });
    return () => { alive = false; clearInterval(id); sub.remove(); };
  }, []);
  const markRead = useCallback(async (newestId) => {
    try { if (newestId) await AsyncStorage.setItem(SEEN_KEY, String(newestId)); } catch { /* ignore */ }
    setUnread(0);
  }, []);

  const value = useMemo(() => ({ unread, inbox, pushNote, markRead, retryPush, refreshInbox }), [unread, inbox, pushNote, markRead, retryPush, refreshInbox]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Things that run for the whole time a collector is signed in (not tied to one screen):
// sending taps saved offline, notifications from the barangay, unread announcements, open emergency pickups.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { countOpenEmergencies, registerPushToken } from '../data/collector';
import { countUnreadNotifications } from '../data/inbox';
import { flushOutbox } from './offline';
import { onNotificationTap, registerForPush } from './notify';
import { navigationRef } from '../navigation/navRef';
import { SEEN_KEY } from '../shared/News';

const Ctx = createContext({ unread: 0, inbox: 0, openEmergencies: 0, pushNote: '', markRead: () => {}, retryPush: () => {}, refreshInbox: () => {} });
export const useCollectorServices = () => useContext(Ctx);

/** Opens the screen for a notification (tapped on the phone or in the inbox). */
export function openCollectorNotification(data) {
  if (!navigationRef.isReady()) return;
  if (data?.kind === 'announcement' && data.id) navigationRef.navigate('CollectorTabs', { screen: 'More', params: { screen: 'AnnouncementDetail', params: { id: Number(data.id) }, initial: false } });
  else if (data?.kind === 'announcement') navigationRef.navigate('CollectorTabs', { screen: 'More', params: { screen: 'Announcements', initial: false } });
  else if (data?.kind === 'emergency' && data.id) {
    navigationRef.navigate('CollectorTabs', { screen: 'Emergency', params: { screen: 'EmergencyDetail', params: { id: Number(data.id) }, initial: false } });
  } else navigationRef.navigate('CollectorTabs', { screen: 'Today', params: { screen: 'TodayMain' } });
}

/** Announcements newer than the last one opened on this phone (null when offline). */
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

export function CollectorServicesProvider({ children }) {
  const [unread, setUnread] = useState(0);
  const [openEmergencies, setOpenEmergencies] = useState(0);
  const [pushNote, setPushNote] = useState('');
  const [inbox, setInbox] = useState(0);
  const refreshInbox = useCallback(() => { countUnreadNotifications().then((n) => { if (n !== null) setInbox(n); }); }, []);

  // Taps saved without signal: send them every 30 seconds and when the app comes back.
  useEffect(() => {
    flushOutbox().catch(() => {});
    const id = setInterval(() => flushOutbox().catch(() => {}), 30000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') flushOutbox().catch(() => {}); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);

  // Notifications from the barangay (push) and tapping any notification.
  const retryPush = useCallback(() => { registerForPush(registerPushToken).then(setPushNote); }, []);
  useEffect(() => {
    let alive = true;
    registerForPush(registerPushToken).then((note) => { if (alive) setPushNote(note); });
    return () => { alive = false; };
  }, []);
  useEffect(() => onNotificationTap(openCollectorNotification), []);

  // Unread announcements: newer than the last one opened on this phone.
  useEffect(() => {
    let alive = true;
    const countUnread = () => {
      unreadCount().then((n) => { if (alive && n !== null) setUnread(n); });
      countOpenEmergencies().then((n) => { if (alive && n !== null) setOpenEmergencies(n); }).catch(() => {});
      countUnreadNotifications().then((n) => { if (alive && n !== null) setInbox(n); });
    };
    countUnread();
    const id = setInterval(countUnread, 60000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') countUnread(); });
    return () => { alive = false; clearInterval(id); sub.remove(); };
  }, []);
  const markRead = useCallback(async (newestId) => {
    try { if (newestId) await AsyncStorage.setItem(SEEN_KEY, String(newestId)); } catch { /* ignore */ }
    setUnread(0);
  }, []);

  const value = useMemo(() => ({ unread, inbox, openEmergencies, pushNote, markRead, retryPush, refreshInbox }), [unread, inbox, openEmergencies, pushNote, markRead, retryPush, refreshInbox]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

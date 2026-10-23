// Notification inbox (both apps): every alert sent to this login, grouped by day. Tapping one marks it read
// and opens the matching screen (onOpen). "Mark all as read" clears the bell.
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getNotifications, markNotificationsRead } from '../data/inbox';
import { useApi } from '../hooks';
import { FilterChips, Screen, StateView } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { fmtTime } from '../utils/schedule';

const KIND = {
  truck: ['bus', colors.primary, colors.primaryLight],
  missed: ['close-circle', colors.danger, colors.dangerLight],
  report: ['chatbubble-ellipses', colors.blue, colors.blueLight],
  announcement: ['megaphone', colors.amber, colors.amberLight],
  emergency: ['alert-circle', colors.danger, colors.dangerLight],
  stop: ['location', colors.blue, colors.blueLight],
};
const phDate = (ts) => new Date(new Date(ts).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const phClock = (ts) => { const d = new Date(new Date(ts).getTime() + 8 * 3600000); return fmtTime(`${d.getUTCHours()}:${d.getUTCMinutes()}:00`); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function groupOf(ts) {
  const today = phDate(Date.now()), d = phDate(ts);
  if (d === today) return 'Today';
  if (d === phDate(Date.now() - 86400000)) return 'Yesterday';
  return 'Earlier';
}
function when(ts) {
  const g = groupOf(ts);
  if (g !== 'Earlier') return phClock(ts);
  const [, m, day] = phDate(ts).split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}, ${phClock(ts)}`;
}

function Item({ n, onPress }) {
  const [icon, fg, bg] = KIND[n.data?.kind] ?? ['notifications', colors.muted, colors.surface2];
  const unread = !n.read_at;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${unread ? 'Unread. ' : ''}${n.title}. ${n.body}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 13, paddingHorizontal: 14,
        backgroundColor: pressed ? colors.surface2 : unread ? '#f4faf6' : colors.surface })}>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={19} color={fg} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, fontSize: 15.5, fontWeight: unread ? '800' : '700', color: colors.text }} numberOfLines={2}>{n.title}</Text>
          <Text style={{ fontSize: 12, color: colors.faint, marginLeft: 8 }}>{when(n.created_at)}</Text>
        </View>
        <Text style={[type.small, { marginTop: 2, color: unread ? colors.text : colors.muted }]} numberOfLines={3}>{n.body}</Text>
      </View>
      {unread ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginLeft: 8, marginTop: 6 }} /> : null}
    </Pressable>
  );
}

/** onOpen(data): opens the screen for the notification's kind. onRead(): the bell count changed. */
export default function NotificationsScreen({ onOpen, onRead }) {
  const { data, error, loading, refreshing, reload, pull, setData } = useApi(() => getNotifications());
  const [tab, setTab] = useState('all');
  const list = useMemo(() => data ?? [], [data]);
  const unread = list.filter((n) => !n.read_at).length;
  const shown = tab === 'unread' ? list.filter((n) => !n.read_at) : list;
  const groups = ['Today', 'Yesterday', 'Earlier'].map((g) => [g, shown.filter((n) => groupOf(n.created_at) === g)]).filter(([, l]) => l.length);

  const markLocal = (ids) => setData(list.map((n) => (!ids || ids.includes(n.notification_id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
  const open = async (n) => {
    if (!n.read_at) { markLocal([n.notification_id]); markNotificationsRead([n.notification_id]).then(onRead).catch(() => {}); }
    onOpen?.(n.data ?? {});
  };
  const markAll = async () => { markLocal(null); try { await markNotificationsRead(); } catch { /* shown again next time */ } onRead?.(); };

  return (
    <Screen refreshing={refreshing} onRefresh={pull} style={{ paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
        <View style={{ flex: 1 }}>
          <FilterChips options={[['all', 'All', list.length], ['unread', 'Unread', unread]]} value={tab} onChange={setTab} style={{ marginBottom: 0 }} />
        </View>
        {unread ? (
          <Pressable onPress={markAll} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14 }}>Mark all as read</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ height: 12 }} />
      <StateView loading={loading} error={error} onRetry={reload} empty={data && shown.length === 0}
        emptyTitle={tab === 'unread' ? 'All caught up' : 'No notifications yet'}
        emptyText={tab === 'unread' ? 'You have read every notification.' : 'Alerts from ECollect appear here, even if you swiped them away.'} />
      {groups.map(([g, items]) => (
        <View key={g} style={{ marginBottom: 14 }}>
          <Text style={[type.overline, { color: colors.muted, marginBottom: 8 }]}>{g}</Text>
          <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, shadow.card]}>
            {items.map((n, i) => (
              <View key={n.notification_id} style={i ? { borderTopWidth: 1, borderTopColor: colors.line } : null}>
                <Item n={n} onPress={() => open(n)} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

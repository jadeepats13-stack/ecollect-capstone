// Collector app: emergency pickups — filter (needs action / coming up / completed / cancelled), search, full history.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { countFinishedEmergencies, getFinishedEmergencies, getOpenEmergencies } from '../data/collector';
import { useApi } from '../hooks';
import { Button, Card, Screen, StateView } from '../components/ui';
import { colors, radius, type } from '../theme';
import { fmtRange, fmtTime } from '../utils/schedule';
import { Header, IconCircle } from './parts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const open = (e) => e.status === 'Scheduled' || e.status === 'In progress';

/** "Today", "Tomorrow", "Thu, Oct 22" */
export function dayLabel(iso, today) {
  if (iso === today) return 'Today';
  const d = new Date(`${iso}T00:00:00Z`), t = new Date(`${today}T00:00:00Z`);
  const diff = Math.round((d - t) / 86400000);
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export const emWindow = (e) => (e.end ? fmtRange(e.start, e.end) : `From ${fmtTime(e.start)}`);
/** Overdue: still open and the day (or today's end time) has passed. */
export function isOverdue(e, today) {
  if (!open(e)) return false;
  if (e.date < today) return true;
  if (e.date > today || !e.end) return false;
  const now = new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 19);
  return now > e.end;
}
export const EM_STYLE = {
  Scheduled: { fg: colors.amber, bg: colors.amberLight, icon: 'time-outline', label: 'Scheduled' },
  'In progress': { fg: colors.blue, bg: colors.blueLight, icon: 'car-outline', label: 'On the way' },
  Completed: { fg: colors.done, bg: colors.doneLight, icon: 'checkmark-circle-outline', label: 'Completed' },
  Cancelled: { fg: colors.faint, bg: colors.surface2, icon: 'close-circle-outline', label: 'Cancelled' },
};

function Row({ e, today, onPress }) {
  const st = EM_STYLE[e.status] ?? EM_STYLE.Scheduled;
  const overdue = isOverdue(e, today);
  const finished = !open(e);
  return (
    <Card onPress={onPress} style={[{ flexDirection: 'row', alignItems: 'center' }, overdue ? { borderColor: '#e7b3a9', borderWidth: 1.5 } : null, finished ? { backgroundColor: colors.surface2, shadowOpacity: 0, elevation: 0 } : null]}>
      <IconCircle name={overdue ? 'alert' : st.icon} size={42} color={overdue ? '#fff' : st.fg} bg={overdue ? colors.danger : st.bg} />
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text style={{ fontSize: 16.5, fontWeight: '800', color: finished ? colors.muted : colors.text }} numberOfLines={2}>{e.location}</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: overdue ? colors.danger : colors.muted, marginTop: 2 }}>
          {dayLabel(e.date, today)} · {emWindow(e)}{overdue ? ' · overdue' : ''}
        </Text>
        <Text style={[type.small, { marginTop: 1 }]} numberOfLines={1}>{e.zone || 'No zone'} · {e.reason}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <View style={{ backgroundColor: st.bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
            <Text style={{ color: st.fg, fontSize: 12, fontWeight: '800' }}>{st.label}</Text>
          </View>
          {e.pending ? <Text style={{ color: colors.amber, fontSize: 12, fontWeight: '700', marginLeft: 8 }}>Saved, sending…</Text> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.faint} />
    </Card>
  );
}

const FILTERS = [
  ['action', 'Needs action'], ['later', 'Coming up'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled'],
];
const matches = (e, q) => !q || `${e.location} ${e.reason} ${e.notes ?? ''} ${e.zone ?? ''}`.toLowerCase().includes(q.toLowerCase());

export default function EmergencyScreen({ navigation }) {
  const [filter, setFilter] = useState('action');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');           // search text after a short pause
  const finished = filter === 'Completed' || filter === 'Cancelled';
  const listKey = `${filter}|${query}`;
  // Pages loaded with "Show more" belong to one filter + search; another filter starts empty.
  const [pages, setPages] = useState({ key: '', list: [], more: false, busy: false });
  const extra = pages.key === listKey ? pages : { key: listKey, list: [], more: false, busy: false };
  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const openApi = useApi(getOpenEmergencies, { pollMs: 60000 });
  const countsApi = useApi(() => countFinishedEmergencies().catch(() => null));
  const doneApi = useApi(() => (finished ? getFinishedEmergencies(filter, { search: query }) : Promise.resolve(null)));
  const { reload: reloadDone } = doneApi;
  useEffect(() => { if (finished) reloadDone(); }, [filter, query, finished, reloadDone]);

  const today = openApi.data?.today;
  const open = openApi.data?.list ?? [];
  const action = open.filter((e) => e.date <= today);
  const later = open.filter((e) => e.date > today);
  const counts = { action: action.length, later: later.length, Completed: countsApi.data?.completed, Cancelled: countsApi.data?.cancelled };

  let list = [];
  if (filter === 'action') list = action.filter((e) => matches(e, query));
  else if (filter === 'later') list = later.filter((e) => matches(e, query));
  else list = [...(doneApi.data?.list ?? []), ...extra.list];
  const more = finished ? (extra.list.length ? extra.more : doneApi.data?.more) : false;
  const loading = finished ? doneApi.loading && !doneApi.data : openApi.loading;
  const error = finished ? doneApi.error : openApi.error;
  const offline = finished ? doneApi.data?.offline : openApi.data?.offline;

  const showMore = async () => {
    setPages({ ...extra, busy: true });
    try {
      const r = await getFinishedEmergencies(filter, { search: query, offset: list.length });
      setPages({ key: listKey, list: [...extra.list, ...r.list], more: r.more, busy: false });
    } catch {
      setPages({ ...extra, busy: false });
    }
  };
  const refresh = () => { openApi.pull(); countsApi.reload(); if (finished) reloadDone(); setPages({ key: '', list: [], more: false, busy: false }); };
  const go = (e) => navigation.navigate('EmergencyDetail', { id: e.id });
  const EMPTY = {
    action: ['Nothing to do right now', 'Emergency pickups for today appear here. Your phone is notified when one is assigned.'],
    later: ['Nothing coming up', 'Pickups scheduled for later days appear here.'],
    Completed: ['No completed pickups', 'Pickups you mark completed appear here.'],
    Cancelled: ['No cancelled pickups', 'Pickups the barangay cancels appear here.'],
  }[filter];

  return (
    <Screen refreshing={openApi.refreshing} onRefresh={refresh}>
      <Header title="Emergency" sub="Pickups outside the schedule" />

      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, marginBottom: 12 }}>
        <Ionicons name="search" size={18} color={colors.faint} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search place, reason or zone" placeholderTextColor="#9aa59a"
          style={{ flex: 1, paddingVertical: 11, paddingHorizontal: 8, fontSize: 16, color: colors.text }} returnKeyType="search" accessibilityLabel="Search emergency pickups" />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={colors.faint} /></Pressable> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginBottom: 12 }} contentContainerStyle={{ paddingHorizontal: 20 }}>
        {FILTERS.map(([k, label]) => {
          const on = filter === k;
          const n = counts[k];
          return (
            <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, marginRight: 8,
                backgroundColor: on ? colors.primary : colors.surface, borderWidth: 1.5, borderColor: on ? colors.primary : colors.line }}>
              <Text style={{ fontWeight: '800', fontSize: 14, color: on ? '#fff' : colors.text }}>{label}</Text>
              {n != null ? (
                <View style={{ marginLeft: 6, minWidth: 20, paddingHorizontal: 6, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? 'rgba(255,255,255,0.25)' : k === 'action' && n ? colors.danger : colors.surface2 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: on || (k === 'action' && n) ? '#fff' : colors.muted }}>{n}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {offline ? (
        <View style={{ flexDirection: 'row', backgroundColor: colors.amberLight, borderRadius: radius.md, padding: 12, marginBottom: 12 }}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.amber} style={{ marginRight: 8 }} />
          <Text style={{ flex: 1, fontSize: 14.5, color: colors.text }}>No signal. Showing the list saved on this phone.</Text>
        </View>
      ) : null}

      <StateView loading={loading} error={error} onRetry={refresh}
        empty={!loading && !error && list.length === 0}
        emptyTitle={query ? 'No matches' : EMPTY[0]} emptyText={query ? `Nothing in “${FILTERS.find((f) => f[0] === filter)[1]}” matches “${query}”.` : EMPTY[1]} />
      {list.map((e) => <Row key={e.id} e={e} today={today ?? doneApi.data?.today} onPress={() => go(e)} />)}
      {more ? <Button title="Show more" variant="ghost" loading={extra.busy} onPress={showMore} style={{ marginTop: 4 }} /> : null}
    </Screen>
  );
}

export { open as isOpenEmergency };

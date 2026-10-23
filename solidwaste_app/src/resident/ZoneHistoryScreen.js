// Resident app: my zone's pickup history — period (7/30/60 days), status filter, search, a summary that
// follows the filters, and a list or calendar view.
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getZoneHistory } from '../data/resident';
import { useApi } from '../hooks';
import { FilterChips, Screen, SearchBox, StateView } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { fmtTime } from '../utils/schedule';
import { dayName, phClock } from './status';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS = {
  collected: { fg: colors.done, bg: colors.doneLight, label: 'Collected' },
  missed: { fg: colors.danger, bg: colors.dangerLight, label: 'Not collected' },
  today: { fg: colors.amber, bg: colors.amberLight, label: 'Today' },
  norecord: { fg: colors.amber, bg: colors.amberLight, label: 'No record' },
};

/** What happened on a day: collected / missed / today / norecord / null (no pickup that day). */
export function dayStatus(d, today) {
  if (d.collected_at) return 'collected';
  if (d.missed_reason) return 'missed';
  if (d.expected) return d.date === today ? 'today' : 'norecord';
  return null;
}
const dateWords = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()} ${iso}`.toLowerCase();
};

function Row({ d, today, first }) {
  const st = STATUS[dayStatus(d, today)];
  const text = d.collected_at ? phClock(d.collected_at) : d.missed_reason ? d.missed_reason : d.expected ? (d.date === today ? 'Not collected yet' : 'No pickup was recorded') : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: colors.line }}>
      <View style={{ width: 96 }}>
        <Text style={{ fontSize: 14.5, fontWeight: '800', color: colors.text }}>{dayName(d.date, today, false)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {st ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <View style={{ backgroundColor: st.bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, marginRight: 6 }}>
              <Text style={{ color: st.fg, fontSize: 12.5, fontWeight: '800' }}>{st.label}</Text>
            </View>
            <Text style={type.small}>{text}</Text>
          </View>
        ) : null}
        {d.emergencies.map((e, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: st || i ? 5 : 0 }}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
            <Text style={[type.small, { marginLeft: 4, flex: 1 }]}>Extra pickup: {e.location} ({fmtTime(e.start)}) · {e.status}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Calendar({ days, today, from, picked, onPick }) {
  const byDate = useMemo(() => Object.fromEntries(days.map((d) => [d.date, d])), [days]);
  const months = useMemo(() => {
    const out = [];
    for (let m = from.slice(0, 7); m <= today.slice(0, 7);) {
      out.push(m);
      const [y, mm] = m.split('-').map(Number);
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
    }
    return out;
  }, [from, today]);
  const [idx, setIdx] = useState(months.length - 1);
  const month = months[Math.min(idx, months.length - 1)];
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const arrow = (dir, on) => (
    <Pressable onPress={() => on && setIdx(idx + dir)} disabled={!on} hitSlop={10} accessibilityRole="button" accessibilityLabel={dir < 0 ? 'Previous month' : 'Next month'}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.surface2 : 'transparent' }}>
      <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={20} color={on ? colors.text : colors.border} />
    </Pressable>
  );
  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 12, marginBottom: 12 }, shadow.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        {arrow(-1, idx > 0)}
        <Text style={[type.heading, { flex: 1, textAlign: 'center' }]}>{MONTHS[m - 1]} {y}</Text>
        {arrow(1, idx < months.length - 1)}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={{ width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '800', color: colors.faint }}>{w}</Text>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
        {cells.map((iso, i) => {
          if (!iso) return <View key={`x${i}`} style={{ width: `${100 / 7}%`, height: 46 }} />;
          const d = byDate[iso];
          const inRange = iso >= from && iso <= today;
          const st = d ? STATUS[dayStatus(d, today)] : null;
          const extra = d?.emergencies?.length > 0;
          const sel = picked === iso;
          return (
            <Pressable key={iso} onPress={() => inRange && onPick(sel ? null : iso)} disabled={!inRange} accessibilityRole="button"
              accessibilityLabel={`${iso}${st ? `: ${st.label}` : ''}${extra ? ', extra pickup' : ''}`}
              style={{ width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                backgroundColor: st ? st.bg : 'transparent', borderWidth: sel ? 2 : iso === today ? 1.5 : 0, borderColor: sel ? colors.text : colors.primary }}>
                <Text style={{ fontSize: 14, fontWeight: st ? '800' : '500', color: !inRange ? colors.border : st ? st.fg : colors.text }}>{Number(iso.slice(8))}</Text>
              </View>
              {extra ? <View style={{ position: 'absolute', bottom: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger }} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
        {[['collected', 'Collected'], ['missed', 'Not collected'], ['norecord', 'No record']].map(([k, l]) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 2 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUS[k].fg, marginRight: 5 }} />
            <Text style={{ fontSize: 12.5, color: colors.muted, fontWeight: '600' }}>{l}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger, marginRight: 5 }} />
          <Text style={{ fontSize: 12.5, color: colors.muted, fontWeight: '600' }}>Extra pickup</Text>
        </View>
      </View>
    </View>
  );
}

export default function ZoneHistoryScreen() {
  const { data, error, loading, refreshing, reload, pull } = useApi(() => getZoneHistory(60));
  const [period, setPeriod] = useState(30);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('list');
  const [picked, setPicked] = useState(null);
  const all = useMemo(() => data ?? [], [data]);
  const today = all[0]?.date;
  const from = all[Math.min(period, all.length) - 1]?.date ?? today;
  const inPeriod = all.filter((d) => d.date >= from && (d.expected || d.collected_at || d.missed_reason || d.emergencies.length));
  const counts = {
    collected: inPeriod.filter((d) => dayStatus(d, today) === 'collected').length,
    missed: inPeriod.filter((d) => dayStatus(d, today) === 'missed').length,
    norecord: inPeriod.filter((d) => dayStatus(d, today) === 'norecord').length,
    extra: inPeriod.filter((d) => d.emergencies.length).length,
  };
  const judged = counts.collected + counts.missed + counts.norecord;
  const q = search.trim().toLowerCase();
  const matches = (d) => !q || `${dateWords(d.date)} ${d.missed_reason ?? ''} ${d.emergencies.map((e) => `${e.location} ${e.status}`).join(' ')} ${STATUS[dayStatus(d, today)]?.label ?? ''}`.toLowerCase().includes(q);
  const shown = inPeriod.filter((d) => {
    const s = dayStatus(d, today);
    if (filter === 'collected' && s !== 'collected') return false;
    if (filter === 'missed' && s !== 'missed') return false;
    if (filter === 'extra' && !d.emergencies.length) return false;
    return matches(d);
  });
  const pickedDay = picked ? all.find((d) => d.date === picked) : null;

  return (
    <Screen refreshing={refreshing} onRefresh={pull} style={{ paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        {[[7, '7 days'], [30, '30 days'], [60, '60 days']].map(([n, l]) => {
          const on = period === n;
          return (
            <Pressable key={n} onPress={() => { setPeriod(n); setPicked(null); }} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={{ flex: 1, paddingVertical: 9, alignItems: 'center', backgroundColor: on ? colors.text : colors.surface, borderWidth: 1, borderColor: on ? colors.text : colors.line,
                borderTopLeftRadius: n === 7 ? radius.md : 0, borderBottomLeftRadius: n === 7 ? radius.md : 0, borderTopRightRadius: n === 60 ? radius.md : 0, borderBottomRightRadius: n === 60 ? radius.md : 0 }}>
              <Text style={{ fontWeight: '800', color: on ? '#fff' : colors.text }}>{l}</Text>
            </Pressable>
          );
        })}
      </View>

      {data ? (
        <View style={[{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 12 }, shadow.card]}>
          <View style={{ flex: 1 }}>
            <Text style={type.overline}>Last {period} days</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 2 }}>{judged ? `${Math.round((counts.collected / judged) * 100)}%` : '–'}</Text>
            <Text style={type.small}>of pickup days collected</Text>
          </View>
          <View style={{ justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, color: colors.done, fontWeight: '700' }}>{counts.collected} collected</Text>
            <Text style={{ fontSize: 14, color: colors.danger, fontWeight: '700' }}>{counts.missed} not collected</Text>
            {counts.norecord ? <Text style={{ fontSize: 14, color: colors.amber, fontWeight: '700' }}>{counts.norecord} no record</Text> : null}
            <Text style={{ fontSize: 14, color: colors.muted, fontWeight: '700' }}>{counts.extra} extra pickup day{counts.extra === 1 ? '' : 's'}</Text>
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <SearchBox value={search} onChangeText={setSearch} placeholder="Search a day, reason or place" />
        </View>
        <Pressable onPress={() => setView(view === 'list' ? 'calendar' : 'list')} accessibilityRole="button" accessibilityLabel={view === 'list' ? 'Show calendar' : 'Show list'}
          style={{ width: 46, height: 46, borderRadius: radius.md, marginLeft: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
          <Ionicons name={view === 'list' ? 'calendar-outline' : 'list-outline'} size={21} color={colors.text} />
        </Pressable>
      </View>

      {view === 'list' ? (
        <FilterChips value={filter} onChange={setFilter}
          options={[['all', 'All', null], ['collected', 'Collected', counts.collected], ['missed', 'Not collected', counts.missed], ['extra', 'Extra pickups', counts.extra]]} />
      ) : null}

      <StateView loading={loading} error={error} onRetry={reload}
        empty={data && view === 'list' && shown.length === 0}
        emptyTitle={q || filter !== 'all' ? 'No matches' : 'Nothing yet'}
        emptyText={q || filter !== 'all' ? 'Try another filter, a longer period or clear the search.' : `Pickup days of your zone from the last ${period} days appear here.`} />

      {data && view === 'calendar' && today ? (
        <>
          <Calendar days={all.filter(matches)} today={today} from={from} picked={picked} onPick={setPicked} />
          {pickedDay ? (
            <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, shadow.card]}>
              {dayStatus(pickedDay, today) || pickedDay.emergencies.length ? <Row d={pickedDay} today={today} first />
                : <Text style={[type.small, { padding: 14 }]}>{dayName(pickedDay.date, today)}: no pickup for your zone.</Text>}
            </View>
          ) : <Text style={[type.small, { textAlign: 'center' }]}>Tap a day to see what happened.</Text>}
        </>
      ) : null}

      {view === 'list' && shown.length ? (
        <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, shadow.card]}>
          {shown.map((d, i) => <Row key={d.date} d={d} today={today} first={i === 0} />)}
        </View>
      ) : null}
    </Screen>
  );
}

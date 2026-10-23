// Collector app: my last 14 days — truck stops, emergency pickups and shifts.
import React from 'react';
import { Text, View } from 'react-native';
import { getHistory } from '../data/collector';
import { useApi } from '../hooks';
import { Card, Screen, StateView } from '../components/ui';
import { colors, radius, type } from '../theme';
import { fmtTime } from '../utils/schedule';
import { IconCircle } from './parts';
import { loadText } from './sheets';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayTitle = (iso, day) => { const [, m, d] = iso.split('-').map(Number); return `${day}, ${MONTHS[m - 1]} ${d}`; };
const clock = (ts) => { if (!ts) return ''; const d = new Date(new Date(ts).getTime() + 8 * 3600000); return fmtTime(`${d.getUTCHours()}:${d.getUTCMinutes()}:00`); };
const mins = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const hm = (m) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;

function Line({ icon, color, bg, title, sub }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
      <IconCircle name={icon} size={32} color={color} bg={bg} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ fontSize: 15.5, fontWeight: '700', color: colors.text }}>{title}</Text>
        {sub ? <Text style={type.small}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function Pill({ text, fg, bg }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, marginRight: 6, marginTop: 6 }}>
      <Text style={{ color: fg, fontSize: 12.5, fontWeight: '800' }}>{text}</Text>
    </View>
  );
}

export default function HistoryScreen() {
  const { data, error, loading, refreshing, reload, pull } = useApi(() => getHistory(14));
  return (
    <Screen refreshing={refreshing} onRefresh={pull} style={{ paddingTop: 12 }}>
      <StateView loading={loading} error={error} onRetry={reload}
        empty={data && data.length === 0} emptyTitle="Nothing yet" emptyText="Your stops, emergency pickups and shifts from the last 14 days appear here." />
      {(data ?? []).map((d) => {
        const done = d.stops.filter((s) => s.outcome === 'done').length;
        const missed = d.stops.length - done;
        const worked = d.shifts.reduce((n, s) => n + (s.end ? mins(s.start, s.end) : 0), 0);
        return (
          <Card key={d.date}>
            <Text style={type.heading}>{dayTitle(d.date, d.day)}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
              {done ? <Pill text={`${done} done`} fg={colors.done} bg={colors.doneLight} /> : null}
              {missed ? <Pill text={`${missed} not collected`} fg={colors.danger} bg={colors.dangerLight} /> : null}
              {d.emergencies.length ? <Pill text={`${d.emergencies.length} emergency`} fg={colors.amber} bg={colors.amberLight} /> : null}
              {worked ? <Pill text={hm(worked)} fg={colors.blue} bg={colors.blueLight} /> : null}
            </View>
            {d.shifts.map((s, i) => (
              <Line key={`sh${i}`} icon="time-outline" color={colors.blue} bg={colors.blueLight}
                title={`Shift ${clock(s.start)} – ${s.end ? clock(s.end) : 'still on'}`}
                sub={s.auto ? 'Not ended in the app (closed at the last GPS reading)' : ''} />
            ))}
            {d.stops.map((s, i) => (
              <Line key={`st${i}`} icon={s.outcome === 'done' ? 'checkmark' : 'close'} color={s.outcome === 'done' ? colors.done : colors.danger}
                bg={s.outcome === 'done' ? colors.doneLight : colors.dangerLight} title={s.name}
                sub={s.outcome === 'done'
                  ? `Done ${clock(s.at)}${s.load ? ` · ${loadText(s.load)}` : ''}`
                  : `Not collected: ${s.reason}${s.note ? ` (${s.note})` : ''}`} />
            ))}
            {d.emergencies.map((e, i) => (
              <Line key={`em${i}`} icon="alert" color={e.status === 'Completed' ? colors.done : colors.amber} bg={e.status === 'Completed' ? colors.doneLight : colors.amberLight}
                title={e.location} sub={`Emergency · ${e.status}${e.at ? ` ${clock(e.at)}` : ''} · ${e.reason}`} />
            ))}
          </Card>
        );
      })}
    </Screen>
  );
}

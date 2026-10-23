// Collector app: the week's truck stops. Pick a day at the top; its stops are listed in order.
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApi } from '../hooks';
import { getWeek } from '../data/collector';
import { Card, Screen, StateView } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { fmtRange } from '../utils/schedule';
import { Header, IconCircle, ZoneChips } from './parts';

const SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
/** Philippine date for each weekday of this week (Mon–Sun), and today's weekday. */
function thisWeek() {
  const ph = new Date(Date.now() + 8 * 3600000);
  const dow = (ph.getUTCDay() + 6) % 7;   // Monday = 0
  const monday = new Date(ph.getTime() - dow * 86400000);
  const names = Object.keys(SHORT);
  return { today: names[dow], dates: Object.fromEntries(names.map((n, i) => [n, new Date(monday.getTime() + i * 86400000).getUTCDate()])) };
}

export default function CollectorScheduleScreen() {
  const { data, error, loading, refreshing, reload, pull } = useApi(getWeek);
  const week = thisWeek();
  const [picked, setPicked] = useState(week.today);
  const day = data?.days.find((d) => d.day === picked);
  const total = data?.days.reduce((n, d) => n + d.stops.length, 0) ?? 0;

  return (
    <Screen refreshing={refreshing} onRefresh={pull}>
      <Header title="This week" sub={data?.assigned ? `${total} truck stops` : 'Your schedule'} />
      <StateView
        loading={loading} error={error} onRetry={reload}
        empty={data && !data.assigned}
        emptyTitle="No schedule yet"
        emptyText="Your Barangay Admin hasn’t set you as the truck crew yet."
      />
      {data?.assigned && (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
            {data.days.map((d) => {
              const on = d.day === picked;
              const isToday = d.day === week.today;
              return (
                <Pressable key={d.day} onPress={() => setPicked(d.day)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${d.day}${isToday ? ', today' : ''}, ${d.stops.length} stops`}
                  style={[{ width: 46, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md,
                    backgroundColor: on ? colors.primary : colors.surface, borderWidth: 1, borderColor: on ? colors.primary : colors.line }, on ? shadow.card : null]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: on ? '#dcefe3' : colors.faint }}>{SHORT[d.day]}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: on ? '#fff' : colors.text, marginTop: 1 }}>{week.dates[d.day]}</Text>
                  <View style={{ flexDirection: 'row', marginTop: 4, height: 6 }}>
                    {d.stops.slice(0, 3).map((s) => (
                      <View key={s.id} style={{ width: 5, height: 5, borderRadius: 3, marginHorizontal: 1, backgroundColor: on ? '#fff' : colors.primary }} />
                    ))}
                  </View>
                  {isToday ? <Text style={{ fontSize: 10, fontWeight: '800', color: on ? '#fff' : colors.primary, marginTop: 1 }}>TODAY</Text> : null}
                </Pressable>
              );
            })}
          </View>

          <Text style={[type.overline, { color: colors.muted, marginBottom: 10 }]}>
            {picked}{picked === week.today ? ' · today' : ''} · {day?.stops.length ? `${day.stops.length} ${day.stops.length === 1 ? 'stop' : 'stops'}` : 'no stops'}
          </Text>

          {!day?.stops.length ? (
            <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
              <IconCircle name={picked === 'Sunday' ? 'cafe-outline' : 'calendar-clear-outline'} size={52} color={colors.muted} bg={colors.surface2} />
              <Text style={[type.heading, { marginTop: 10 }]}>{picked === 'Sunday' ? 'No collection on Sunday' : 'No truck stops'}</Text>
              <Text style={[type.small, { marginTop: 4, textAlign: 'center' }]}>Nothing is scheduled for you on this day.</Text>
            </Card>
          ) : day.stops.map((s, i) => (
            <View key={s.id} style={{ flexDirection: 'row' }}>
              <View style={{ width: 54, paddingTop: 16 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>{fmtRange(s.start).replace(/ (AM|PM)$/, '')}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.faint }}>{/PM$/.test(fmtRange(s.start)) ? 'PM' : 'AM'}</Text>
                {i < day.stops.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: colors.line, marginLeft: 10, marginTop: 6 }} /> : null}
              </View>
              <Card style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>{s.name}</Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.muted, marginTop: 2 }}>{fmtRange(s.start, s.end)}{s.standby ? ` · ${s.standby} min standby` : ''}</Text>
                {s.landmark ? <Text style={[type.small, { marginTop: 4 }]} numberOfLines={2}>{s.landmark}</Text> : null}
                <ZoneChips zones={s.zones} />
              </Card>
            </View>
          ))}

          {data.dropOff.length > 0 && (
            <View style={{ flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.md, padding: 12, marginTop: 6 }}>
              <IconCircle name="information" size={28} color={colors.muted} bg={colors.line} />
              <Text style={[type.small, { flex: 1, marginLeft: 10 }]}>{data.dropOff.join(', ')}: no truck stop. Residents bring their garbage directly to the designated place.</Text>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

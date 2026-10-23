// Resident app, Home: today's pickup in my zone, the live truck, my truck stops, the week, emergency pickups,
// and "Rate today's pickup".
import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getHome, ratePickup } from '../data/resident';
import { useApi } from '../hooks';
import { useAuth } from '../AuthContext';
import { Button, Card, Screen, StateView } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { fmtRange } from '../utils/schedule';
import { Header, IconCircle, LinkButton, SectionTitle, openInMaps } from '../collector/parts';
import { TONES, canRate, dateNum, dayName, nextPickup, todayStatus, todayStops, weekday } from './status';
import { scheduleReminders } from './reminders';
import { useResidentServices } from './ResidentServices';
import Bell from '../shared/Bell';

const STATE_LABEL = { done: 'Collected', now: 'Open now', upcoming: 'Later today', late: 'Waiting', missed: 'Not collected' };

function Banner({ icon, color, bg, text, action, onPress }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', backgroundColor: bg, borderRadius: radius.md, padding: 12, marginBottom: 12, opacity: pressed ? 0.85 : 1 })}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={{ flex: 1, marginLeft: 8, fontSize: 14.5, lineHeight: 20, color: colors.text }}>{text}</Text>
      {action ? <Text style={{ color, fontWeight: '800', marginLeft: 8 }}>{action}</Text> : null}
    </Pressable>
  );
}

function TodayCard({ day, onMap }) {
  const st = todayStatus(day);
  const tone = TONES[st.tone];
  const list = todayStops(day);
  return (
    <View style={[{ backgroundColor: tone.bg, borderRadius: radius.xl, padding: 18, marginBottom: 14 }, shadow.card]}>
      <Text style={[type.overline, { color: tone.fg }]}>{dayName(day.date, day.date)} · {day.day}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
        <Ionicons name={tone.icon} size={30} color={tone.fg} />
        <Text style={{ flex: 1, marginLeft: 10, fontSize: 22, fontWeight: '800', color: colors.text }}>{st.title}</Text>
      </View>
      <Text style={[type.body, { marginTop: 8 }]}>{st.text}</Text>
      {list.length > 1 ? (
        <View style={{ marginTop: 10 }}>
          {list.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: (TONES[s.state] ?? TONES.idle).fg, marginRight: 8 }} />
              <Text style={{ flex: 1, fontSize: 14.5, color: colors.text }} numberOfLines={1}>{s.name} · {fmtRange(s.start, s.end)}</Text>
              <Text style={{ fontSize: 13, fontWeight: '800', color: (TONES[s.state] ?? TONES.idle).fg }}>{STATE_LABEL[s.state]}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {day.trucks?.length ? (
        <Pressable onPress={onMap} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, marginTop: 12, opacity: pressed ? 0.85 : 1 })}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.done, marginRight: 8 }} />
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.text }}>The truck is sharing its location · {day.trucks[0].sub.toLowerCase()}</Text>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>See it</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Week({ day }) {
  const has = new Set((day.next ?? []).filter((d) => d.stops?.length).map((d) => d.date));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginBottom: 6 }} contentContainerStyle={{ paddingHorizontal: 20 }}>
      {(day.next ?? []).map((d) => {
        const on = has.has(d.date);
        const today = d.date === day.date;
        return (
          <View key={d.date} accessibilityLabel={`${dayName(d.date, day.date)}: ${on ? 'garbage pickup' : 'no pickup'}`}
            style={{ width: 52, alignItems: 'center', paddingVertical: 10, marginRight: 8, borderRadius: radius.md,
              backgroundColor: on ? colors.primary : colors.surface, borderWidth: today ? 2 : 1, borderColor: today ? colors.primaryDark : colors.line }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#cfe3d7' : colors.faint }}>{weekday(d.date).toUpperCase()}</Text>
            <Text style={{ fontSize: 19, fontWeight: '800', color: on ? '#fff' : colors.text, marginTop: 2 }}>{dateNum(d.date)}</Text>
            <Ionicons name={on ? 'trash' : 'remove'} size={14} color={on ? '#fff' : colors.border} style={{ marginTop: 3 }} />
          </View>
        );
      })}
    </ScrollView>
  );
}

function RateCard({ onDone }) {
  const [mode, setMode] = useState(null); // null | 'problem'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (good) => {
    setBusy(true);
    try {
      await ratePickup(good, note);
      onDone(good);
    } catch (e) {
      Alert.alert('Couldn’t send', e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text style={type.heading}>How was today’s pickup?</Text>
      <Text style={[type.small, { marginTop: 2, marginBottom: 12 }]}>Your answer goes to the barangay. Once a day.</Text>
      {mode === 'problem' ? (
        <>
          <TextInput value={note} onChangeText={setNote} placeholder="What happened? (for example: the truck came early)" placeholderTextColor="#9aa59a" multiline
            style={{ backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, minHeight: 80, fontSize: 15.5, color: colors.text, textAlignVertical: 'top', marginBottom: 10 }} />
          <View style={{ flexDirection: 'row' }}>
            <Button title="Back" variant="ghost" onPress={() => setMode(null)} style={{ flex: 1, marginRight: 8 }} />
            <Button title="Send" icon="send" loading={busy} onPress={() => send(false)} style={{ flex: 1.4 }} />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row' }}>
          <Button title="Good" icon="thumbs-up-outline" variant="soft" loading={busy} onPress={() => send(true)} style={{ flex: 1, marginRight: 8 }} />
          <Button title="Had a problem" icon="thumbs-down-outline" variant="dangerGhost" disabled={busy} onPress={() => setMode('problem')} style={{ flex: 1.3 }} />
        </View>
      )}
    </Card>
  );
}

export default function HomeScreen({ navigation }) {
  const { name } = useAuth();
  const { data: day, error, loading, refreshing, reload, pull, setData } = useApi(getHome, { pollMs: 60000 });
  useEffect(() => { if (day && !day.offline) scheduleReminders(day); }, [day]);

  const { inbox, refreshInbox } = useResidentServices();
  useFocusEffect(useCallback(() => { refreshInbox(); }, [refreshInbox]));
  const header = <Header title={`Hi${name ? `, ${name}` : ''}!`} sub={day?.me?.zone ? `${day.me.zone} · Barangay Poblacion` : 'Barangay Poblacion'}
    right={<Bell count={inbox} onPress={() => navigation.navigate('Notifications')} />} />;
  if (!day) {
    return (
      <Screen refreshing={refreshing} onRefresh={pull}>
        {header}
        <StateView loading={loading} error={error} onRetry={reload} />
      </Screen>
    );
  }

  const goMap = () => navigation.navigate('Truck');
  const noZone = !day.me?.zone_id;
  const dropOff = day.me?.mode === 'drop_off';
  const next = nextPickup(day);

  return (
    <Screen refreshing={refreshing} onRefresh={pull}>
      {header}
      {day.offline ? <Banner icon="cloud-offline-outline" color={colors.amber} bg={colors.amberLight} text="No internet. Showing what was saved on this phone." /> : null}

      {noZone ? (
        <Card>
          <IconCircle name="map-outline" />
          <Text style={[type.heading, { marginTop: 10 }]}>Choose your zone</Text>
          <Text style={[type.small, { marginTop: 4, marginBottom: 12 }]}>Your pickup days, truck stop and alerts depend on your zone.</Text>
          <Button title="Set my zone" icon="locate-outline" onPress={() => navigation.navigate('More', { screen: 'Profile', initial: false })} />
        </Card>
      ) : dropOff ? (
        <View style={[{ backgroundColor: colors.primaryLight, borderRadius: radius.xl, padding: 18, marginBottom: 14 }, shadow.card]}>
          <Text style={[type.overline, { color: colors.primaryDark }]}>{day.me.zone}</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 6 }}>Drop-off zone</Text>
          <Text style={[type.body, { marginTop: 8 }]}>The truck does not stop in your zone. Bring your garbage to the place the barangay has set for your zone. Ask the barangay office if you are not sure where it is.</Text>
        </View>
      ) : (
        <TodayCard day={day} onMap={goMap} />
      )}

      {!noZone && !dropOff && canRate(day) ? (
        <RateCard onDone={(good) => {
          setData({ ...day, rated_today: true });
          Alert.alert('Thank you', good ? 'Glad the pickup went well.' : 'The barangay will look into it.');
        }} />
      ) : null}

      {!noZone && !dropOff ? (
        <>
          <SectionTitle right={next ? `Next: ${dayName(next.date, day.date)}` : undefined}>This week</SectionTitle>
          <Week day={day} />

          <SectionTitle>My truck stop{(day.stops ?? []).length === 1 ? '' : 's'}</SectionTitle>
          {(day.stops ?? []).length === 0 ? (
            <Card><Text style={type.small}>No truck stop is set for your zone yet. Ask the barangay office.</Text></Card>
          ) : (day.stops ?? []).map((s) => (
            <Card key={s.id}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <IconCircle name="location" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>{s.name}</Text>
                  <Text style={[type.small, { marginTop: 2 }]}>{(s.days ?? []).join(', ')} · {fmtRange(s.start, s.end)}</Text>
                  {s.standby ? <Text style={type.small}>The truck waits {s.standby} minutes</Text> : null}
                  {s.landmark ? <Text style={[type.small, { color: colors.faint }]}>{s.landmark}</Text> : null}
                  {s.confirmed === false ? <Text style={[type.small, { color: colors.amber }]}>Exact spot to be confirmed by the barangay</Text> : null}
                </View>
              </View>
              {s.lat != null ? (
                <View style={{ flexDirection: 'row', marginTop: 2, marginLeft: 52 }}>
                  <View style={{ marginRight: 18 }}><LinkButton icon="navigate-outline" title="Directions" onPress={() => openInMaps(s)} /></View>
                  <LinkButton icon="map-outline" title="On the map" onPress={goMap} />
                </View>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {(day.emergencies ?? []).length ? (
        <>
          <SectionTitle>Extra pickups in your zone</SectionTitle>
          {day.emergencies.map((e) => (
            <Card key={e.id} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <IconCircle name={e.status === 'Completed' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                color={e.status === 'Completed' ? colors.done : colors.danger} bg={e.status === 'Completed' ? colors.doneLight : colors.dangerLight} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{e.location}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>{dayName(e.date, day.date)} · {e.end ? fmtRange(e.start, e.end) : `from ${fmtRange(e.start)}`}</Text>
                <Text style={type.small}>{e.reason}</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', marginTop: 4, color: e.status === 'Completed' ? colors.done : e.status === 'In progress' ? colors.blue : colors.amber }}>
                  {e.status === 'In progress' ? 'The truck is on the way' : e.status}
                </Text>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {!noZone ? (
        <Button title="My zone’s pickup history" icon="calendar-outline" variant="ghost" onPress={() => navigation.navigate('More', { screen: 'ZoneHistory', initial: false })} style={{ marginTop: 6 }} />
      ) : null}
    </Screen>
  );
}

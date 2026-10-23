// Collector app: one emergency pickup — where, when, why, its progress, and the next action.
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getEmergency, setEmergencyStatus } from '../data/collector';
import { useApi } from '../hooks';
import { Button, Card, Screen, StateView } from '../components/ui';
import { colors, radius, type } from '../theme';
import { fmtDateTime } from '../utils/schedule';
import { IconCircle, LinkButton, ShiftLock, ZoneChips, openInMaps, useOnShift } from './parts';
import { EM_STYLE, dayLabel, emWindow, isOpenEmergency, isOverdue } from './EmergencyScreen';

function Step({ done, label, when, last, color = colors.primary }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: 24, alignItems: 'center' }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: done ? color : colors.surface, borderWidth: done ? 0 : 2, borderColor: colors.borderStrong,
          alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          {done ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
        </View>
        {!last ? <View style={{ flex: 1, width: 2, backgroundColor: done ? color : colors.line, marginVertical: 2 }} /> : null}
      </View>
      <View style={{ flex: 1, marginLeft: 10, paddingBottom: last ? 0 : 14 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: done ? colors.text : colors.faint }}>{label}</Text>
        {when ? <Text style={type.small}>{when}</Text> : null}
      </View>
    </View>
  );
}

export default function EmergencyDetailScreen({ route, navigation }) {
  const id = route.params?.id;
  const { data, error, loading, reload, setData } = useApi(() => getEmergency(id));
  const [busy, setBusy] = useState(false);
  const onShift = useOnShift();
  const e = data?.item;
  const today = data?.today;

  const change = async (status) => {
    setBusy(true);
    try {
      const r = await setEmergencyStatus(e, status);
      if (r.queued) {
        setData({ ...data, item: { ...e, status, pending: true } });
      } else {
        await reload();
      }
    } catch (err) {
      Alert.alert('Couldn’t save', err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!e) {
    return (
      <Screen style={{ paddingTop: 12 }}>
        <StateView loading={loading} error={error} onRetry={reload} empty={data && !e}
          emptyTitle="Not found" emptyText="This emergency pickup is no longer assigned to you." />
      </Screen>
    );
  }

  const st = EM_STYLE[e.status] ?? EM_STYLE.Scheduled;
  const overdue = isOverdue(e, today);
  const isOpen = isOpenEmergency(e);
  const canAct = isOpen && e.date <= today;
  const cancelled = e.status === 'Cancelled';
  const progressed = e.status === 'In progress' || e.status === 'Completed';

  return (
    <Screen style={{ paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: overdue ? colors.dangerLight : st.bg, borderRadius: radius.lg, padding: 14, marginBottom: 12 }}>
        <IconCircle name={overdue ? 'alert' : st.icon} size={44} color={overdue ? '#fff' : st.fg} bg={overdue ? colors.danger : colors.surface} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: overdue ? colors.danger : st.fg }}>{overdue ? 'Overdue' : st.label}{e.pending ? ' · saved, sending…' : ''}</Text>
          <Text style={[type.small, { color: colors.text }]}>{dayLabel(e.date, today)} · {emWindow(e)}</Text>
        </View>
      </View>

      <Card>
        <Text style={type.overline}>Emergency pickup</Text>
        <Text style={{ fontSize: 21, fontWeight: '800', color: colors.text, marginTop: 4 }}>{e.location}</Text>
        {e.zone ? <ZoneChips zones={[e.zone]} /> : null}
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <Ionicons name="help-circle-outline" size={19} color={colors.muted} style={{ marginTop: 1 }} />
          <Text style={[type.body, { flex: 1, marginLeft: 8, fontSize: 15.5 }]}>{e.reason}</Text>
        </View>
        {e.notes ? (
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Ionicons name="document-text-outline" size={19} color={colors.muted} style={{ marginTop: 1 }} />
            <Text style={[type.body, { flex: 1, marginLeft: 8, fontSize: 15.5 }]}>{e.notes}</Text>
          </View>
        ) : null}
        {e.lat != null ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
            <View style={{ marginRight: 18 }}><LinkButton icon="navigate-outline" title="Directions" onPress={() => openInMaps(e)} /></View>
            <LinkButton icon="map-outline" title="Show on the map" onPress={() => navigation.navigate('Map', { focusEmergency: e.id })} />
          </View>
        ) : (
          <Text style={[type.small, { marginTop: 8 }]}>No map location was given. Use the place description above.</Text>
        )}
      </Card>

      <Card>
        <Text style={[type.label, { marginBottom: 12 }]}>Progress</Text>
        <Step done label="Assigned to you" when={fmtDateTime(e.created_at)} />
        {cancelled ? (
          <Step done last label="Cancelled by the barangay" when={fmtDateTime(e.updated_at)} color={colors.faint} />
        ) : (
          <>
            <Step done={progressed} label="On the way" />
            <Step done={e.status === 'Completed'} last label="Completed" when={e.completed_at ? fmtDateTime(e.completed_at) : ''} color={colors.done} />
          </>
        )}
      </Card>

      {canAct && onShift === false ? (
        <ShiftLock text="Start your shift (on the Today tab) to update this pickup." onStart={() => navigation.navigate('Today')} />
      ) : canAct ? (
        <Button title={e.status === 'In progress' ? 'Mark completed' : 'On the way'} icon={e.status === 'In progress' ? 'checkmark-circle-outline' : 'car-outline'}
          loading={busy} onPress={() => change(e.status === 'In progress' ? 'Completed' : 'In progress')} style={{ minHeight: 56 }} />
      ) : isOpen ? (
        <View style={{ flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.md, padding: 12 }}>
          <Ionicons name="calendar-outline" size={20} color={colors.muted} />
          <Text style={[type.small, { flex: 1, marginLeft: 8 }]}>Scheduled for {dayLabel(e.date, today).toLowerCase() === 'tomorrow' ? 'tomorrow' : dayLabel(e.date, today)}. You can mark it on the way on that day.</Text>
        </View>
      ) : e.status === 'Completed' && e.date >= today && onShift ? (
        <Button title="Undo: not completed yet" variant="ghost" icon="arrow-undo-outline" loading={busy} onPress={() => change('In progress')} />
      ) : null}
    </Screen>
  );
}

// Collector app: report a problem from the field. It appears on the Barangay Admin's dashboard.
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { REPORT_TYPES, getDay, getMyFieldReports, sendFieldReport } from '../data/collector';
import { useApi } from '../hooks';
import { Button, Card, ErrorBanner, Field, Screen, StateView } from '../components/ui';
import { colors, radius, type } from '../theme';
import { fmtDateTime } from '../utils/schedule';
import { ChoiceTile, IconCircle, REASON_ICONS, SectionTitle, ShiftLock, useOnShift } from './parts';

const STEPS = ['Sent', 'Seen', 'Resolved'];
const STEP_OF = { Open: 0, Acknowledged: 1, Resolved: 2 };

async function load() {
  const [mine, day] = await Promise.all([getMyFieldReports(), getDay().catch(() => null)]);
  return { mine, stops: day?.stops ?? [] };
}

/** Sent → Seen → Resolved */
function Progress({ status }) {
  const at = STEP_OF[status] ?? 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
      {STEPS.map((s, i) => (
        <React.Fragment key={s}>
          {i ? <View style={{ flex: 1, height: 2, backgroundColor: i <= at ? colors.primary : colors.line, marginHorizontal: 4 }} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: i <= at ? colors.primary : colors.line }}>
              {i <= at ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
            </View>
            <Text style={{ marginLeft: 4, fontSize: 12.5, fontWeight: '700', color: i <= at ? colors.primaryDark : colors.faint }}>{s}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

export default function ReportProblemScreen({ navigation }) {
  const { data, error, loading, refreshing, reload, pull } = useApi(load);
  const [kind, setKind] = useState(null);
  const [stopId, setStopId] = useState(null);
  const [text, setText] = useState('');
  const [withLocation, setWithLocation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const onShift = useOnShift();
  const locked = onShift === false;

  const send = async () => {
    if (!kind) return setFormError('Choose what the problem is.');
    if (kind === 'Other' && !text.trim()) return setFormError('Describe the problem.');
    setBusy(true); setFormError('');
    try {
      let coords = null;
      if (withLocation) {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          coords = (await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
          ]).catch(() => null))?.coords ?? (await Location.getLastKnownPositionAsync().catch(() => null))?.coords ?? null;
        }
      }
      const r = await sendFieldReport({ type: kind, description: text.trim(), pointId: stopId, latitude: coords?.latitude, longitude: coords?.longitude });
      setKind(null); setStopId(null); setText('');
      Alert.alert(r.queued ? 'Saved on the phone' : 'Report sent', r.queued
        ? 'No signal right now. The report will be sent by itself when the signal is back.'
        : 'Your Barangay Admin will see it on their dashboard.');
      reload();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={pull} style={{ paddingTop: 12 }}>
      <Text style={[type.small, { marginBottom: 12, marginHorizontal: 2 }]}>Something wrong on the route? Your Barangay Admin sees it right away on their dashboard.</Text>
      {locked ? <ShiftLock text="Reports can be sent during your shift. Start your shift on the Today tab." onStart={() => navigation.navigate('Today')} /> : null}

      <Card>
        <Text style={[type.label, { marginBottom: 10 }]}>What happened?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {REPORT_TYPES.map((t) => <ChoiceTile key={t} label={t} selected={kind === t} onPress={() => setKind(t)} />)}
        </View>

        {(data?.stops ?? []).length > 0 && (
          <>
            <Text style={[type.label, { marginTop: 8, marginBottom: 8 }]}>At which stop? <Text style={{ color: colors.faint, fontWeight: '500' }}>(optional)</Text></Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
              {data.stops.map((s) => {
                const on = stopId === s.id;
                return (
                  <Pressable key={s.id} onPress={() => setStopId(on ? null : s.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.pill, marginRight: 8,
                      backgroundColor: on ? colors.primary : colors.surface, borderWidth: 1.5, borderColor: on ? colors.primary : colors.line }}>
                    <Ionicons name="location-outline" size={16} color={on ? '#fff' : colors.muted} />
                    <Text style={{ marginLeft: 5, fontWeight: '700', fontSize: 14, color: on ? '#fff' : colors.text }}>{s.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        <View style={{ marginTop: 14 }}>
          <Field label={kind === 'Other' ? 'Details (needed)' : 'Details'} value={text} onChangeText={setText} multiline maxLength={1000}
            placeholder="For example: road works on Zamora St., the truck cannot pass" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface2, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 14 }}>
          <Ionicons name="locate-outline" size={20} color={colors.primary} />
          <Text style={[type.body, { flex: 1, marginLeft: 8, fontSize: 15 }]}>Include my current location</Text>
          <Switch value={withLocation} onValueChange={setWithLocation} trackColor={{ true: colors.primary, false: colors.borderStrong }} thumbColor="#fff"
            accessibilityLabel="Include my current location" />
        </View>
        <ErrorBanner message={formError} />
        <Button title="Send report" icon="paper-plane-outline" onPress={send} loading={busy} disabled={locked} style={{ minHeight: 54 }} />
      </Card>

      <SectionTitle>My recent reports</SectionTitle>
      <StateView loading={loading} error={error} onRetry={reload}
        empty={data && data.mine.length === 0} emptyTitle="No reports yet" emptyText="Reports you send appear here with their status." />
      {data?.mine.map((r) => (
        <Card key={r.field_report_id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconCircle name={REASON_ICONS[r.report_type] ?? 'alert-circle-outline'} size={38} color={r.status === 'Resolved' ? colors.done : colors.amber}
              bg={r.status === 'Resolved' ? colors.doneLight : colors.amberLight} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{r.report_type}</Text>
              <Text style={type.small}>{fmtDateTime(r.created_at)}{r.collection_point?.name ? ` · ${r.collection_point.name}` : ''}</Text>
            </View>
          </View>
          {r.description ? <Text style={[type.body, { marginTop: 8, fontSize: 15 }]}>{r.description}</Text> : null}
          <Progress status={r.status} />
        </Card>
      ))}
    </Screen>
  );
}

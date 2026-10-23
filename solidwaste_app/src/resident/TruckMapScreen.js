// Resident app, Truck: map of Barangay Poblacion with my zone, my truck stops (today's state), extra pickups
// in my zone, and the garbage truck whenever its collector is sharing GPS (during a shift). Refreshes every 15 s.
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getTruckMap } from '../data/resident';
import { useApi } from '../hooks';
import { Button } from '../components/ui';
import { colors, radius, shadow, status as STATUS, type } from '../theme';
import PobMap from '../map/PobMap';
import RoundButton from '../map/RoundButton';

const LEGEND = [['done', 'Collected'], ['now', 'Open now'], ['upcoming', 'Later today'], ['missed', 'Not collected'], ['off', 'Not today']];
const DOT = { off: colors.faint };

export default function TruckMapScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { data, error, loading, reload } = useApi(getTruckMap, { pollMs: 15000 });
  const map = useRef(null);
  const [ready, setReady] = useState(false);
  const [satellite, setSatellite] = useState(false);
  const top = insets.top + 8;
  const mapInsets = useMemo(() => ({ top: top + 64, bottom: 190 }), [top]);
  // Zones and stops change rarely: keep the same object while only the trucks move, so the map isn't rebuilt.
  const key = data ? JSON.stringify(data.data) : '';
  const mapData = useMemo(() => (key ? JSON.parse(key) : null), [key]);
  const trucks = data?.trucks ?? [];
  const zone = data?.me?.zone;
  const noZone = data && !data.me?.zone_id;

  return (
    <View style={{ flex: 1, backgroundColor: '#eef1ed' }}>
      {mapData ? (
        <PobMap ref={map} data={mapData} trucks={trucks} insets={mapInsets} satellite={satellite} myZone={zone} onReady={() => setReady(true)} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {loading ? <ActivityIndicator size="large" color={colors.primary} /> : (
            <>
              <Text style={[type.heading, { textAlign: 'center' }]}>Couldn’t load the map</Text>
              <Text style={[type.small, { textAlign: 'center', marginVertical: 8 }]}>{error}</Text>
              <Button title="Try again" variant="ghost" onPress={reload} style={{ paddingHorizontal: 28 }} />
            </>
          )}
        </View>
      )}

      <View pointerEvents="box-none" style={{ position: 'absolute', top, left: 12, right: 12 }}>
        <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 14 }, shadow.raised]}>
          <View style={{ flex: 1 }}>
            <Text style={type.overline}>{zone ? `${zone} · Barangay Poblacion` : 'Barangay Poblacion'}</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>Truck map</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: trucks.length ? colors.doneLight : colors.surface2, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: trucks.length ? colors.done : colors.faint, marginRight: 6 }} />
            <Text style={{ fontWeight: '800', fontSize: 13, color: trucks.length ? colors.done : colors.faint }}>{trucks.length ? 'Truck live' : 'No truck'}</Text>
          </View>
        </View>
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', right: 12, top: top + 78 }}>
        <RoundButton icon="scan-outline" label="Show the whole barangay" onPress={() => map.current?.fitAll()} disabled={!ready} />
        <RoundButton icon="bus-outline" label="Show the truck" disabled={!ready || !trucks.length} onPress={() => trucks[0] && map.current?.focusTruck(trucks[0].id)} />
        <RoundButton icon={satellite ? 'map-outline' : 'earth-outline'} label={satellite ? 'Street view' : 'Satellite view'} on={satellite} disabled={!ready} onPress={() => setSatellite((v) => !v)} />
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
        <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14 }, shadow.raised]}>
          {noZone ? (
            <Pressable onPress={() => navigation.navigate('More', { screen: 'Profile', initial: false })} accessibilityRole="button">
              <Text style={[type.body, { fontWeight: '700' }]}>Choose your zone to see your truck stop.</Text>
              <Text style={{ color: colors.primary, fontWeight: '800', marginTop: 4 }}>Set my zone ›</Text>
            </Pressable>
          ) : trucks.length ? (
            trucks.map((t) => (
              <Pressable key={t.id} onPress={() => map.current?.focusTruck(t.id)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}>
                <Ionicons name="bus" size={22} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontSize: 16.5, fontWeight: '800', color: colors.text }}>{t.title}</Text>
                  <Text style={[type.small, !t.live && { color: colors.amber }]}>{t.live ? t.sub : `${t.sub} (signal may be weak)`}</Text>
                </View>
              </Pressable>
            ))
          ) : (
            <Text style={[type.body, { fontSize: 15 }]}>
              {data?.offline ? 'No internet: the truck can’t be shown. Your zone and stops are from the last time you were online.'
                : 'The truck appears here while its collector is on shift and sharing GPS.'}
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
            {LEGEND.map(([k, label]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: DOT[k] ?? STATUS[k].fg, marginRight: 5 }} />
                <Text style={{ fontSize: 12.5, color: colors.muted, fontWeight: '600' }}>{label}</Text>
              </View>
            ))}
            {mapData?.emergencies?.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', marginRight: 5 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>!</Text>
                </View>
                <Text style={{ fontSize: 12.5, color: colors.muted, fontWeight: '600' }}>Extra pickup</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ fontSize: 11.5, color: colors.faint, marginTop: 2 }}>Your zone is highlighted. Zone lines are approximate until the barangay confirms them.</Text>
        </View>
      </View>
    </View>
  );
}

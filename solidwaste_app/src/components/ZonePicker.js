import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getZones } from '../data/resident';
import { zoneAt } from '../map/geo';
import { colors, radius, type } from '../theme';
import { Chip } from './ui';

/** Lets the resident choose the collection zone their home belongs to ("Use my location" finds it). */
export default function ZonePicker({ value, onChange }) {
  const [zones, setZones] = useState(null);
  const [error, setError] = useState(null);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    getZones().then(setZones).catch((e) => setError(e.message));
  }, []);

  const find = async () => {
    setFinding(true); setNote('');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setNote('Location is off for ECollect. Choose your zone below.'); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const r = zoneAt(zones ?? [], p.coords.latitude, p.coords.longitude);
      if (r.zone) { onChange(r.zone.route_id); setNote(`You seem to be in ${r.zone.zone_name}. Zone lines are approximate, so check that it’s right.`); }
      else if (r.outside) setNote('You seem to be outside Barangay Poblacion. If you are not at home now, choose your zone below.');
      else setNote('We couldn’t tell your zone from here. Choose it below, or ask the barangay office.');
    } catch (e) {
      setNote(`Couldn’t find your location: ${e.message}`);
    } finally {
      setFinding(false);
    }
  };

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[type.label, { marginBottom: 8 }]}>Your collection zone</Text>
      {zones?.length ? (
        <Pressable onPress={find} disabled={finding} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radius.pill,
            paddingVertical: 9, paddingHorizontal: 14, marginBottom: 10, opacity: pressed ? 0.8 : 1 })}>
          {finding ? <ActivityIndicator size="small" color={colors.primaryDark} /> : <Ionicons name="locate" size={17} color={colors.primaryDark} />}
          <Text style={{ color: colors.primaryDark, fontWeight: '800', marginLeft: 6 }}>Use my location (at home)</Text>
        </Pressable>
      ) : null}
      {note ? <Text style={[type.small, { marginBottom: 8, color: colors.text }]}>{note}</Text> : null}
      {!zones && !error && <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start' }} />}
      {error && <Text style={[type.small, { color: colors.danger }]}>{error}</Text>}
      {zones && zones.length === 0 && (
        <Text style={type.small}>No zones have been set up yet. Ask your barangay office.</Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {zones?.map((z) => (
          <Chip key={z.route_id} label={z.zone_name} selected={String(value) === String(z.route_id)} onPress={() => onChange(z.route_id)} />
        ))}
      </View>
      <Text style={[type.small, { marginTop: 2 }]}>Your pickup days, truck stop and alerts depend on this.</Text>
    </View>
  );
}

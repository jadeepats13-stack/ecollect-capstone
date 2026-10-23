// Resident app: new report in four short steps — what, details, photo, place. Send stays at the bottom.
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { REPORT_TYPES, sendReport } from '../data/resident';
import { Button, Card, ErrorBanner, Screen } from '../components/ui';
import { colors, radius, type } from '../theme';
import { ChoiceTile } from '../collector/parts';
import { TYPE_ICONS } from './ReportParts';
import PhotoPicker from './PhotoPicker';

const MAX = 2000;

function Step({ n, title, hint, done, children }) {
  return (
    <Card style={{ padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? colors.primary : colors.primaryLight }}>
          {done ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Text style={{ fontWeight: '900', color: colors.primaryDark }}>{n}</Text>}
        </View>
        <Text style={[type.heading, { marginLeft: 10, flex: 1, fontSize: 17 }]}>{title}</Text>
        {hint ? <Text style={{ fontSize: 12.5, color: colors.faint }}>{hint}</Text> : null}
      </View>
      {children}
    </Card>
  );
}

export default function ReportNewScreen({ navigation }) {
  const [kind, setKind] = useState(null);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [place, setPlace] = useState(null);       // { latitude, longitude, accuracy }
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const locate = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return Alert.alert('Location is off', 'Allow location for ECollect to add the place, or describe the place in the text.');
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (Math.abs(p.coords.latitude - 8.229) > 0.05 || Math.abs(p.coords.longitude - 124.236) > 0.05) {
        return Alert.alert('You seem to be far from Poblacion', 'The place can only be added when you are in or near Barangay Poblacion. Describe the place in the text instead.');
      }
      setPlace({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy });
    } catch (e) {
      Alert.alert('Couldn’t find your location', e.message);
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!kind) return setError('Step 1: choose what the report is about.');
    if (!text.trim() && !photo) return setError('Step 2 or 3: describe the problem or add a photo.');
    setBusy(true); setError('');
    try {
      const id = await sendReport({ type: kind, description: text, latitude: place?.latitude, longitude: place?.longitude, photo });
      navigation.replace('ReportDetail', { id, sent: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: 12 }}
      footer={(
        <>
          <ErrorBanner message={error} />
          <Button title="Send report" icon="send" onPress={submit} loading={busy} style={{ minHeight: 54 }} />
        </>
      )}>
      <Step n={1} title="What is it about?" done={!!kind}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: -8 }}>
          {REPORT_TYPES.map((t) => <ChoiceTile key={t} label={t} icon={TYPE_ICONS[t]} selected={kind === t} onPress={() => setKind(t)} />)}
        </View>
      </Step>

      <Step n={2} title="What happened?" done={!!text.trim()} hint={`${text.length}/${MAX}`}>
        <TextInput value={text} onChangeText={setText} multiline maxLength={MAX} placeholder="Where exactly, since when, anything that helps the barangay"
          placeholderTextColor="#9aa59a" accessibilityLabel="What happened"
          style={{ backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, minHeight: 110,
            fontSize: 16, color: colors.text, textAlignVertical: 'top' }} />
      </Step>

      <Step n={3} title="Photo" hint="Optional" done={!!photo}>
        <PhotoPicker photo={photo} onChange={setPhoto} />
      </Step>

      <Step n={4} title="Place" hint="Optional" done={!!place}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name={place ? 'location' : 'location-outline'} size={22} color={place ? colors.primary : colors.faint} />
          <Text style={[type.body, { flex: 1, marginLeft: 10, fontSize: 15 }]}>
            {place ? `Your location is added${place.accuracy ? ` (within about ${Math.round(place.accuracy)} m)` : ''}.` : 'Add where you are now, if you are at the place.'}
          </Text>
          {locating ? <ActivityIndicator color={colors.primary} /> : (
            <Pressable onPress={place ? () => setPlace(null) : locate} accessibilityRole="button" hitSlop={8}
              style={{ backgroundColor: place ? colors.dangerLight : colors.primaryLight, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 14 }}>
              <Text style={{ color: place ? colors.danger : colors.primaryDark, fontWeight: '800' }}>{place ? 'Remove' : 'Add'}</Text>
            </Pressable>
          )}
        </View>
      </Step>
      <Text style={[type.small, { textAlign: 'center', marginTop: 2 }]}>Your name and zone are sent with the report.</Text>
    </Screen>
  );
}

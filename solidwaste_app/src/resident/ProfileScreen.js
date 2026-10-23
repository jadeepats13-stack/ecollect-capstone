// Resident app: my details and my zone (changing the zone changes the schedule, truck stop and alerts).
import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { getMe, saveMe } from '../data/resident';
import { useAuth } from '../AuthContext';
import { useApi } from '../hooks';
import { Button, ErrorBanner, Field, Screen, StateView } from '../components/ui';
import ZonePicker from '../components/ZonePicker';
import { type } from '../theme';

function ProfileForm({ me, navigation }) {
  const { setName } = useAuth();
  const [f, setF] = useState({
    first_name: me.first_name ?? '', last_name: me.last_name ?? '', contact_number: me.contact_number ?? '',
    home_address: me.home_address ?? '', route_id: me.route_id,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      const row = await saveMe(f);
      setName(row.first_name);
      Alert.alert('Saved', row.route_id !== me.route_id ? 'Your zone was changed. Home and the truck map now show your new zone.' : 'Your details were updated.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={[type.small, { marginBottom: 16 }]}>Signed in as {me.email}</Text>
      <ErrorBanner message={error} />
      <ZonePicker value={f.route_id} onChange={set('route_id')} />
      <Field label="First name" value={f.first_name} onChangeText={set('first_name')} autoComplete="given-name" />
      <Field label="Last name" value={f.last_name} onChangeText={set('last_name')} autoComplete="family-name" />
      <Field label="Contact number (optional)" value={f.contact_number} onChangeText={set('contact_number')} keyboardType="phone-pad" />
      <Field label="Home address (optional)" value={f.home_address} onChangeText={set('home_address')} multiline />
      <Button title="Save changes" icon="checkmark" onPress={save} loading={busy} />
    </>
  );
}

export default function ProfileScreen({ navigation }) {
  const { data: me, error, loading, reload } = useApi(getMe);
  return (
    <Screen style={{ paddingTop: 12 }}>
      {me ? <ProfileForm key={me.resident_id} me={me} navigation={navigation} /> : <StateView loading={loading} error={error} onRetry={reload} />}
    </Screen>
  );
}

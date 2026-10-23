// Collector app: my account, change password, log out.
import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { changePassword, getCollector, unregisterPushToken } from '../data/collector';
import { useAuth } from '../AuthContext';
import { useApi } from '../hooks';
import { Button, Card, ErrorBanner, Field, Screen, StateView } from '../components/ui';
import { colors, type } from '../theme';
import { useLocationShare } from './LocationShare';
import { IconCircle, ListGroup, ListRow } from './parts';
import { clearOffline, subscribeOutbox } from './offline';
import { clearArrivals } from './arrival';
import { forgetPush } from './notify';

export default function CollectorAccountScreen() {
  const { signOut, email } = useAuth();
  const share = useLocationShare();
  const { data: me, error, loading, reload } = useApi(getCollector);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwError, setPwError] = useState('');
  const [busy, setBusy] = useState(false);

  const savePassword = async () => {
    if (!pw.current || !pw.next) return setPwError('Enter your current and new password.');
    if (pw.next !== pw.again) return setPwError('The new passwords do not match.');
    setBusy(true); setPwError('');
    try {
      await changePassword(email, pw.current, pw.next);
      setPw({ current: '', next: '', again: '' });
      Alert.alert('Password changed', 'Use the new password next time you log in.');
    } catch (e) {
      setPwError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const [pending, setPending] = useState(0);
  useEffect(() => subscribeOutbox((s) => setPending(s.pending)), []);

  const confirmLogout = () =>
    Alert.alert('Log out?', [
      pending ? `${pending} ${pending === 1 ? 'tap has' : 'taps have'} not been sent yet (no signal) and will be lost.` : '',
      share.sharing ? 'Location sharing will stop and the truck will disappear from the map.' : 'You’ll need to log in again.',
    ].filter(Boolean).join(' '), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: async () => {
        await share.stop();
        await forgetPush(unregisterPushToken);
        await clearOffline();
        await clearArrivals();
        await signOut();
      } },
    ]);

  return (
    <Screen style={{ paddingTop: 12 }}>
      <StateView loading={loading} error={error} onRetry={reload} />
      {me && (
        <ListGroup>
          <ListRow icon="person-outline" title={`${me.first_name ?? ''} ${me.last_name ?? ''}`.trim()} sub={`${me.email} · Garbage collector`} />
          <ListRow icon="bus-outline" iconColor={colors.blue} iconBg={colors.blueLight} title={me.truck?.plate_number || 'Not assigned'} sub="Truck" />
          <ListRow icon="map-outline" iconColor={colors.amber} iconBg={colors.amberLight} title={me.route?.zone_name || 'Not set'} sub="Home zone" />
        </ListGroup>
      )}
      <Text style={[type.small, { marginBottom: 16, marginHorizontal: 4 }]}>To change your truck, zone or schedule, contact your Barangay Admin.</Text>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <IconCircle name="key-outline" size={38} color={colors.amber} bg={colors.amberLight} />
          <Text style={[type.heading, { marginLeft: 10 }]}>Change password</Text>
        </View>
        <Field label="Current password" value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} secureTextEntry autoCapitalize="none" />
        <Field label="New password (at least 8 characters)" value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} secureTextEntry autoCapitalize="none" />
        <Field label="New password again" value={pw.again} onChangeText={(v) => setPw({ ...pw, again: v })} secureTextEntry autoCapitalize="none" />
        <ErrorBanner message={pwError} />
        <Button title="Change password" onPress={savePassword} loading={busy} />
      </Card>

      <Button title="Log out" icon="log-out-outline" variant="dangerGhost" onPress={confirmLogout} style={{ marginTop: 4 }} />
    </Screen>
  );
}

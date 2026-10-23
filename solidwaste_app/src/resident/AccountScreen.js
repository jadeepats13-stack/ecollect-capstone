// Resident app: change password, log out.
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { changePassword, clearCache, unregisterPushToken } from '../data/resident';
import { useAuth } from '../AuthContext';
import { Button, Card, ErrorBanner, Field, Screen } from '../components/ui';
import { colors, type } from '../theme';
import { IconCircle } from '../collector/parts';
import { forgetPush } from '../collector/notify';

export default function AccountScreen() {
  const { signOut, email } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const savePassword = async () => {
    if (!pw.current || !pw.next) return setError('Enter your current and new password.');
    if (pw.next !== pw.again) return setError('The new passwords do not match.');
    setBusy(true); setError('');
    try {
      await changePassword(email, pw.current, pw.next);
      setPw({ current: '', next: '', again: '' });
      Alert.alert('Password changed', 'Use the new password next time you log in.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmLogout = () => Alert.alert('Log out?', 'This phone stops getting your pickup alerts and reminders until you log in again.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: async () => {
      await forgetPush(unregisterPushToken);
      await clearCache();
      await signOut();
    } },
  ]);

  return (
    <Screen style={{ paddingTop: 12 }}>
      <Text style={[type.small, { marginBottom: 12 }]}>Signed in as {email}</Text>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <IconCircle name="key-outline" size={38} color={colors.amber} bg={colors.amberLight} />
          <Text style={[type.heading, { marginLeft: 10 }]}>Change password</Text>
        </View>
        <Field label="Current password" value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} secureTextEntry autoCapitalize="none" />
        <Field label="New password (at least 8 characters)" value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} secureTextEntry autoCapitalize="none" />
        <Field label="New password again" value={pw.again} onChangeText={(v) => setPw({ ...pw, again: v })} secureTextEntry autoCapitalize="none" />
        <ErrorBanner message={error} />
        <Button title="Change password" onPress={savePassword} loading={busy} />
      </Card>
      <Button title="Log out" icon="log-out-outline" variant="dangerGhost" onPress={confirmLogout} style={{ marginTop: 4 }} />
    </Screen>
  );
}

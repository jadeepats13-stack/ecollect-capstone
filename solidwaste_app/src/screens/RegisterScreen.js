import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../AuthContext';
import { Button, ErrorBanner, Field, Screen, ScreenTitle } from '../components/ui';
import ZonePicker from '../components/ZonePicker';
import { colors, type } from '../theme';

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [f, setF] = useState({
    first_name: '', last_name: '', email: '', password: '',
    contact_number: '', home_address: '', route_id: null,
  });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!f.email.trim()) return setError('Enter your email.');
    if (!f.first_name.trim() || !f.last_name.trim()) return setError('Enter your name and email.');
    if (f.password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    setError('');
    try {
      const res = await register({ ...f, email: f.email.trim() });
      // If your Supabase project requires email confirmation, there is no session yet.
      if (res?.needsEmailConfirm) {
        setInfo('Account created. Check your email to confirm it, then log in.');
        setBusy(false);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenTitle sub="Resident sign-up. It takes a minute — your zone decides which schedule you see.">
        Create account
      </ScreenTitle>

      <ErrorBanner message={error} />
      {info ? (
        <View style={{ backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Text style={{ color: colors.primaryDark, fontSize: 14, lineHeight: 20 }}>{info}</Text>
        </View>
      ) : null}

      <Field label="First name" value={f.first_name} onChangeText={set('first_name')} autoComplete="given-name" />
      <Field label="Last name" value={f.last_name} onChangeText={set('last_name')} autoComplete="family-name" />
      <Field
        label="Email" value={f.email} onChangeText={set('email')}
        autoCapitalize="none" keyboardType="email-address" autoComplete="email"
      />
      <Field
        label="Password (8+ characters)" value={f.password} onChangeText={set('password')}
        secureTextEntry autoCapitalize="none"
      />
      <Field
        label="Contact number (optional)" value={f.contact_number} onChangeText={set('contact_number')}
        keyboardType="phone-pad"
      />
      <Field
        label="Home address (optional)" value={f.home_address} onChangeText={set('home_address')}
        multiline
      />
      <ZonePicker value={f.route_id} onChange={set('route_id')} />
      <Button title="Create account" onPress={submit} loading={busy} />
      <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 20, alignItems: 'center' }}>
        <Text style={type.body}>
          Already registered? <Text style={{ color: colors.primary, fontWeight: '700' }}>Log in</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}

import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useAuth } from '../AuthContext';
import { Button, ErrorBanner, Field, Screen } from '../components/ui';
import { colors, type } from '../theme';

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: 48 }}>
      <View style={{ marginBottom: 32, marginTop: 24 }}>
        <Image source={require('../../assets/images/logo-mark.png')} style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 14 }} accessibilityIgnoresInvertColors />
        <Text style={{ fontSize: 40, fontWeight: '800', color: colors.primary, letterSpacing: -1 }}>ECollect</Text>
        <Text style={[type.body, { color: colors.muted, marginTop: 6 }]}>
          Waste pickup schedules and live truck tracking for your barangay.
        </Text>
      </View>

      <ErrorBanner message={error} />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@example.com"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder="Your password"
        onSubmitEditing={submit}
      />
      <Button title="Log in" onPress={submit} loading={busy} style={{ marginTop: 6 }} />

      <Pressable onPress={() => navigation.navigate('Register')} style={{ marginTop: 24, alignItems: 'center' }}>
        <Text style={type.body}>
          New resident? <Text style={{ color: colors.primary, fontWeight: '700' }}>Create an account</Text>
        </Text>
      </Pressable>
      <Text style={[type.small, { textAlign: 'center', marginTop: 14 }]}>
        Garbage collectors: your Barangay Admin creates your account. Log in with the email and password they gave you.
      </Text>
    </Screen>
  );
}

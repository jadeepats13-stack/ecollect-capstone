import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** false until you create .env (see .env.example) */
export const configured = !!(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: {
    // Web uses the browser's localStorage (default); phones use AsyncStorage.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/** Turns Supabase / network errors into messages a person can act on. */
export function explain(error) {
  const m = String(error?.message ?? error ?? '');
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first — check your inbox.';
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Try logging in.';
  if (/database error saving new user/i.test(m)) return 'Could not create the account. Check your details and try again.';
  if (/password should be at least/i.test(m)) return 'Password is too short.';
  if (/failed to fetch|network request failed|networkerror/i.test(m)) return 'Cannot reach the server. Check your internet connection.';
  if (/row-level security/i.test(m)) return 'Your account is not allowed to do that.';
  if (/foreign key/i.test(m)) return 'This record is still used by something else, so it cannot be removed.';
  if (/duplicate key|unique constraint/i.test(m)) return 'That value already exists.';
  return m || 'Something went wrong. Try again.';
}

/** Unwraps a Supabase response: returns data or throws a readable Error. */
export function must(res) {
  if (res.error) throw new Error(explain(res.error));
  return res.data;
}

export async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  const id = data?.session?.user?.id;
  if (!id) throw new Error('You are signed out. Please log in again.');
  return id;
}

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** false until web/.env is filled in (see web/.env.example). */
export const configured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ecollect-web-auth' },
});

/** Turns Supabase / network errors into messages a person can act on. */
export function explain(error) {
  const m = String(error?.message ?? error ?? '');
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'This email is not confirmed yet.';
  if (/failed to fetch|network ?error|load failed/i.test(m)) return 'Cannot reach the server. Check your internet connection.';
  if (/row-level security|permission denied/i.test(m)) return 'Your account is not allowed to do that.';
  if (/violates foreign key/i.test(m)) return 'This record is still used by something else, so it cannot be removed.';
  if (/duplicate key|unique constraint/i.test(m)) return 'That value already exists.';
  if (/JWT expired|invalid JWT/i.test(m)) return 'Your session expired. Please sign in again.';
  return m || 'Something went wrong. Please try again.';
}

/** Error messages from the database rules come as one message per line. */
export function errorLines(error) {
  return explain(error).split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Unwraps a Supabase response: returns data or throws a readable Error. */
export function must(res) {
  if (res.error) {
    const e = new Error(explain(res.error));
    e.lines = errorLines(res.error);
    throw e;
  }
  return res.data;
}

/** Calls the manage-staff Edge Function and returns its JSON, throwing its error message. */
export async function manageStaff(body) {
  const { data, error } = await supabase.functions.invoke('manage-staff', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    if (/failed to send a request|fetch/i.test(msg)) {
      msg = 'The account service is not reachable. Deploy the manage-staff Edge Function (see the setup guide).';
    }
    throw new Error(msg);
  }
  return data;
}

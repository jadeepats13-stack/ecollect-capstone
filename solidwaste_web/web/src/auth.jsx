// Sign-in state for the admin website. Only LGU Admins and Barangay Admins can use it;
// the database (row-level security) enforces the same rule for every request.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, explain } from './lib/supabase';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const IDLE_MINUTES = 30;   // same idle sign-out as the PHP version

// A sign-in opens ONE panel: the account type chosen on the sign-in form (as in the PHP version).
// A login that is both an LGU Admin and a Barangay Admin must sign out and back in to use the other panel.
const ACTIVE_KEY = 'ecollect-active-role';
const readActive = () => { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } };
const writeActive = (r) => { try { if (r) localStorage.setItem(ACTIVE_KEY, r); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ } };

/** 'barangay' | 'lgu' -> database role name */
export const ROLE_DB = { barangay: 'barangay_admin', lgu: 'lgu_admin' };
export const ROLE_LABEL = { barangay: 'Barangay Admin', lgu: 'LGU Admin' };

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);   // undefined = still checking
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(readActive);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user?.id ?? null;
  const loadProfiles = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('my_profile');
    if (e) throw new Error(explain(e));
    return data ?? [];
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!uid) { setProfiles([]); return; }
    setProfiles(null);
    loadProfiles().then(setProfiles).catch((e) => { setError(e.message); setProfiles([]); });
  }, [uid, session, loadProfiles]);

  // Idle sign-out: 30 minutes without mouse/keyboard activity (live polling does not count).
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (!uid) return undefined;
    const bump = () => { lastActive.current = Date.now(); };
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_MINUTES * 60000) {
        supabase.auth.signOut();
        try { sessionStorage.setItem('ecollect-expired', '1'); } catch { /* ignore */ }
      }
    }, 30000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); clearInterval(timer); };
  }, [uid]);

  const value = useMemo(() => {
    const list = profiles ?? [];
    const find = (role) => list.find((p) => p.r_role === ROLE_DB[role]) ?? null;
    const roles = ['barangay', 'lgu'].filter((r) => find(r));
    return {
      loading: session === undefined || (Boolean(uid) && profiles === null),
      signedIn: Boolean(uid),
      email: session?.user?.email ?? '',
      error,
      /** Admin roles this login has: ['lgu', 'barangay'] */
      roles,
      /** The one panel this sign-in may use. */
      activeRole: roles.includes(chosen) ? chosen : (roles[0] ?? null),
      profile: (role) => {
        const p = find(role);
        return p ? { id: p.r_id, name: `${p.r_first_name ?? ''} ${p.r_last_name ?? ''}`.trim() } : null;
      },
      hasOtherRoles: list.some((p) => p.r_role === 'garbage_collector' || p.r_role === 'resident'),
      /** Signs in and checks the account really is the chosen kind of admin. */
      signIn: async (email, password, role) => {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw new Error(explain(e));
        const list2 = await loadProfiles();
        setProfiles(list2);
        const has = (r) => list2.some((p) => p.r_role === ROLE_DB[r]);
        if (!has('barangay') && !has('lgu')) {
          await supabase.auth.signOut();
          throw new Error('This website is for Barangay Admins and LGU Admins only. Residents and garbage collectors: please use the ECollect mobile app.');
        }
        if (!has(role)) {
          const other = role === 'lgu' ? 'barangay' : 'lgu';
          await supabase.auth.signOut();
          throw new Error(`This account is not ${role === 'lgu' ? 'an' : 'a'} ${ROLE_LABEL[role]}. Choose "${ROLE_LABEL[other]}" as the account type.`);
        }
        lastActive.current = Date.now();
        writeActive(role);
        setChosen(role);
        return role;
      },
      signOut: () => { writeActive(null); setChosen(null); return supabase.auth.signOut(); },
    };
  }, [session, uid, profiles, error, loadProfiles, chosen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

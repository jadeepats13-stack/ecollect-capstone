// Supabase Edge Function: manage-staff
// Creates, edits and deletes the logins of staff accounts, which needs the
// service-role key (it must never ship in the website or app, so it lives here).
//
//   Barangay Admin  -> garbage collectors        (create, update, set_password, delete)
//   LGU Admin       -> Barangay Admin accounts   (create, update, set_password, delete)
//   LGU Admin       -> resident accounts         (delete only, when the resident asks)
//
// One person may hold several roles with the same email (one Supabase login).
// Creating an account for an email that already has a login links that login;
// deleting a role only deletes the login when no other role uses it.
//
// Deploy:  supabase functions deploy manage-staff
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => json({ error }, status);

type Cfg = { table: string; id: string; first: string; last: string; extras: string[]; manager: 'lgu' | 'barangay'; actions: string[] };
const ROLES: Record<string, Cfg> = {
  garbage_collector: { table: 'garbage_collector', id: 'garbage_collector_id', first: 'first_name', last: 'last_name', extras: ['route_id', 'truck_id'], manager: 'barangay', actions: ['create', 'update', 'set_password', 'delete'] },
  barangay_admin: { table: 'barangay_admin', id: 'barangay_admin_id', first: 'firstname', last: 'lastname', extras: [], manager: 'lgu', actions: ['create', 'update', 'set_password', 'delete'] },
  resident: { table: 'resident', id: 'resident_id', first: 'first_name', last: 'last_name', extras: [], manager: 'lgu', actions: ['delete'] },
};
const ROLE_TABLES = ['lgu_admin', 'barangay_admin', 'garbage_collector', 'resident'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const intOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : null);
const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);   // ilike without wildcards

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Is this login still used by any role row? */
async function loginInUse(admin: SupabaseClient, uid: string) {
  for (const t of ROLE_TABLES) {
    const { count } = await admin.from(t).select('*', { count: 'exact', head: true }).eq('auth_user_id', uid);
    if (count) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'Use POST.');

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) Who is calling?
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: userData } = await caller.auth.getUser();
    const user = userData?.user;
    if (!user) return fail(401, 'Please sign in again.');
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // 2) What do they want, and may they?
    const body = await req.json().catch(() => ({}));
    const cfg = ROLES[String(body.role)];
    if (!cfg) return fail(400, 'Unknown account type.');
    if (!cfg.actions.includes(String(body.action))) return fail(400, 'That action is not available for this account type.');
    const managerTable = cfg.manager === 'lgu' ? 'lgu_admin' : 'barangay_admin';
    const { data: mgr, error: mErr } = await admin.from(managerTable).select('*').eq('auth_user_id', user.id).maybeSingle();
    if (mErr) return fail(500, mErr.message);
    if (!mgr) {
      return fail(403, cfg.manager === 'lgu'
        ? 'Only the LGU Admin can manage these accounts.'
        : 'Only the Barangay Admin can manage collector accounts.');
    }

    // ---------- create ----------
    if (body.action === 'create') {
      const email = clean(body.email, 100).toLowerCase();
      const password = String(body.password ?? '');
      const first = clean(body.first_name, 50);
      const last = clean(body.last_name, 50);
      if (!first || !last) return fail(400, 'Enter a first and last name.');
      if (!EMAIL_RE.test(email)) return fail(400, 'Enter a valid email address.');

      const { data: existing, error: exErr } = await admin.from(cfg.table).select('*').ilike('email', likeExact(email)).maybeSingle();
      if (exErr) return fail(500, exErr.message);
      if (existing?.auth_user_id) return fail(409, 'That email already has an account of this type.');

      let uid: string;
      let linked = false;
      const known = await findUserByEmail(admin, email);
      if (known) {
        // Same person, another role (e.g. the LGU Admin is also a Barangay Admin): reuse the login.
        // Its password is NOT changed: it may be another person's role (e.g. an admin's own login).
        uid = known.id;
        linked = true;
      } else {
        if (password.length < 8) return fail(400, 'Set a password of at least 8 characters.');
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          app_metadata: { provisioned_by: 'ecollect_admin', staff_role: body.role },
        });
        if (createErr || !created?.user) return fail(400, createErr?.message ?? 'Could not create the login.');
        uid = created.user.id;
        // Safety net: a staff login must not also become a resident (see 02_security.sql).
        await admin.from('resident').delete().eq('auth_user_id', uid);
      }

      const values: Record<string, unknown> = { email, [cfg.first]: first, [cfg.last]: last, auth_user_id: uid };
      for (const k of cfg.extras) values[k] = intOrNull(body[k]);
      const { data: row, error: rowErr } = existing
        ? await admin.from(cfg.table).update(values).eq(cfg.id, existing[cfg.id]).select().single()
        : await admin.from(cfg.table).insert(values).select().single();
      if (rowErr) {
        if (!linked) await admin.auth.admin.deleteUser(uid);   // roll back so the email stays free
        return fail(400, /duplicate|unique/i.test(rowErr.message) ? 'That email is already used by another account of this type.' : rowErr.message);
      }
      return json({ ok: true, row, linked });
    }

    // ---------- actions on an existing row ----------
    const id = Number(body.id);
    if (!Number.isInteger(id)) return fail(400, 'Missing account id.');
    const { data: target, error: tErr } = await admin.from(cfg.table).select('*').eq(cfg.id, id).maybeSingle();
    if (tErr) return fail(500, tErr.message);
    if (!target) return fail(404, 'That account no longer exists.');

    if (body.action === 'update') {
      const first = clean(body.first_name, 50);
      const last = clean(body.last_name, 50);
      const email = clean(body.email, 100).toLowerCase();
      const password = String(body.password ?? '');
      if (!first || !last) return fail(400, 'Enter a first and last name.');
      if (!EMAIL_RE.test(email)) return fail(400, 'Enter a valid email address.');
      if (password && password.length < 8) return fail(400, 'A new password must be at least 8 characters.');
      const values: Record<string, unknown> = { [cfg.first]: first, [cfg.last]: last };
      for (const k of cfg.extras) if (k in body) values[k] = intOrNull(body[k]);

      if (email !== String(target.email ?? '').toLowerCase()) {
        const { data: clash } = await admin.from(cfg.table).select(cfg.id).ilike('email', likeExact(email)).neq(cfg.id, id).maybeSingle();
        if (clash) return fail(409, 'Another account of this type already uses that email.');
        if (target.auth_user_id) {
          const other = await findUserByEmail(admin, email);
          if (other && other.id !== target.auth_user_id) return fail(409, 'That email already belongs to another login.');
          const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { email, email_confirm: true });
          if (error) return fail(400, error.message);
        }
        values.email = email;
      }
      if (password && target.auth_user_id) {
        const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
        if (error) return fail(400, error.message);
      }
      const { data: row, error } = await admin.from(cfg.table).update(values).eq(cfg.id, id).select().single();
      if (error) return fail(400, error.message);
      return json({ ok: true, row, needs_login: !target.auth_user_id });
    }

    if (body.action === 'set_password') {
      const password = String(body.password ?? '');
      if (password.length < 8) return fail(400, 'The password must be at least 8 characters.');
      if (!target.auth_user_id) return fail(400, 'This person has no login yet. Use "Create login" instead.');
      const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
      if (error) return fail(400, error.message);
      return json({ ok: true });
    }

    if (body.action === 'delete') {
      if (cfg.table === 'garbage_collector') {
        const { count } = await admin.from('collection_schedule').select('*', { count: 'exact', head: true })
          .eq('garbage_collector_id', id).eq('schedule_status', 'Active');
        if (count) return fail(409, `This collector still has ${count} active schedule(s). Assign another collector under Collection schedule -> Truck crew first.`);
      }
      if (cfg.table === 'barangay_admin') {
        const [{ count: zones }, { count: scheds }] = await Promise.all([
          admin.from('route').select('*', { count: 'exact', head: true }).eq('barangay_admin_id', id),
          admin.from('collection_schedule').select('*', { count: 'exact', head: true }).eq('barangay_admin_id', id),
        ]);
        if (zones || scheds) return fail(409, `This account is linked to ${zones ?? 0} zone(s) and ${scheds ?? 0} schedule(s), so it cannot be deleted. Change the password instead to remove this person's access.`);
      }
      const { error: delErr } = await admin.from(cfg.table).delete().eq(cfg.id, id);
      if (delErr) return fail(409, /foreign key/i.test(delErr.message) ? 'This record is still used by something else, so it cannot be removed.' : delErr.message);
      if (target.auth_user_id && !(await loginInUse(admin, target.auth_user_id))) {
        await admin.auth.admin.deleteUser(target.auth_user_id);
      }
      return json({ ok: true });
    }

    return fail(400, 'Unknown action.');
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : 'Something went wrong.');
  }
});

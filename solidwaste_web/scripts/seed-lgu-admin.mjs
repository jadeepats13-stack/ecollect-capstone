// Creates the default LGU admin login (run once, from your own computer).
//
//   1. Put these in a file called .env.seed (it is git-ignored — never commit it, never use the EXPO_PUBLIC_ prefix):
//        SUPABASE_URL=https://YOUR-PROJECT.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=...        # Supabase -> Project Settings -> API -> service_role
//        LGU_ADMIN_EMAIL=...   (optional; default = the email already in your lgu_admin table, else lgu.admin@ecollect.ph)
//        LGU_ADMIN_PASSWORD=...                     (optional; a random one is generated and printed if omitted)
//        LGU_ADMIN_FIRST_NAME=LGU  LGU_ADMIN_LAST_NAME=Admin   (optional)
//   2. npm run seed:lgu
//
// Run supabase/setup/01-04 first. Safe to re-run: it never creates a second default admin.

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = process.env;
const url = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see the comments at the top of this file).');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const die = (msg, err) => { console.error(`${msg}${err ? `: ${err.message ?? err}` : ''}`); process.exit(1); };

// Your data script may already contain an LGU admin row. Adopt it instead of adding a second one.
const { data: rows, error: rowErr } = await sb.from('lgu_admin').select('*');
if (rowErr) die('Could not read the lgu_admin table', rowErr);
const linked = rows.find((r) => r.auth_user_id);
if (linked) {
  console.log(`The LGU admin (${linked.email}) already has a login. Nothing to do.`);
  console.log('Forgot the password? Supabase -> Authentication -> Users -> that user -> reset it.');
  process.exit(0);
}
if (!env.LGU_ADMIN_EMAIL && rows.length > 1) {
  die(`The lgu_admin table has ${rows.length} rows (${rows.map((r) => r.email).join(', ')}). Set LGU_ADMIN_EMAIL in .env.seed to choose which one becomes the default admin`);
}
const existingRow = env.LGU_ADMIN_EMAIL
  ? rows.find((r) => r.email?.toLowerCase() === env.LGU_ADMIN_EMAIL.trim().toLowerCase())
  : rows[0];
const email = (env.LGU_ADMIN_EMAIL || existingRow?.email || 'lgu.admin@ecollect.ph').trim().toLowerCase();
const first = env.LGU_ADMIN_FIRST_NAME || existingRow?.first_name || 'LGU';
const last = env.LGU_ADMIN_LAST_NAME || existingRow?.last_name || 'Admin';
const generated = !env.LGU_ADMIN_PASSWORD;
const password = env.LGU_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
if (password.length < 8) { console.error('LGU_ADMIN_PASSWORD must be at least 8 characters.'); process.exit(1); }

let userId;
const { data: created, error: createErr } = await sb.auth.admin.createUser({
  email, password, email_confirm: true,
  app_metadata: { provisioned_by: 'ecollect_admin', staff_role: 'lgu_admin' },
});
if (createErr) {
  if (!/already|registered|exists/i.test(createErr.message)) die('Could not create the login', createErr);
  // The auth user exists (e.g. made by hand in the dashboard): link it instead.
  for (let page = 1; !userId && page <= 20; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die('Could not look up the existing user', error);
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 200) break;
  }
  if (!userId) die('That email is registered but the user could not be found');
  console.log('A login for that email already existed — linking it to the LGU admin record. Its password was NOT changed.');
} else {
  userId = created.user.id;
}

const fields = existingRow ? { auth_user_id: userId } : { email, first_name: first, last_name: last, auth_user_id: userId };
const { error: saveErr } = existingRow
  ? await sb.from('lgu_admin').update(fields).eq('lgu_admin_id', existingRow.lgu_admin_id)
  : await sb.from('lgu_admin').insert(fields);
if (saveErr) {
  if (created) await sb.auth.admin.deleteUser(userId);   // don't leave a login with no admin record
  die('Could not save the lgu_admin record', saveErr);
}

// A staff login must not also become a resident (Supabase Auth saves app_metadata after the
// sign-up trigger runs; supabase/setup/02_security.sql cleans this up too).
if (created) await sb.from('resident').delete().eq('auth_user_id', userId);

console.log('\nDefault LGU admin ready.');
console.log(`  Email:    ${email}`);
if (created) console.log(`  Password: ${password}${generated ? '   (generated — save it now, it is not stored anywhere)' : ''}`);
console.log('Sign in on the website (cd web && npm run dev) with these details.');

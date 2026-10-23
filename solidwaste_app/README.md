# ECollect: Barangay Poblacion solid waste collection

| Part | Folder | For |
|---|---|---|
| Admin website (React + Vite) | `web/` | LGU Admin, Barangay Admin |
| Mobile app (Expo / React Native) | project root (`App.js`, `src/`) | Garbage collectors, residents |
| Database, security rules, schedule logic | `supabase/setup/` | shared by both |
| Staff-account Edge Function | `supabase/functions/manage-staff/` | creating and deleting logins |

Both the website and the app talk to **Supabase** directly with the public anon key. Who may read or change what is enforced by the database's row-level security (`supabase/setup/02_security.sql`), not by the screens.

**Setup:** see [SETUP.md](SETUP.md).

## Mobile app (development)

```
cp .env.example .env      # EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run android           # or: npm start, then scan with Expo Go
```

Restart with `npx expo start -c` after changing `.env`.

## Website (development)

```
cd web
cp .env.example .env
npm install
npm run dev
```

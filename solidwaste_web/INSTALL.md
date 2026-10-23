# How to install ECollect (step by step)

This guide sets up everything from start to finish: the database, the admin website, and the mobile app (garbage collectors and residents). Follow the steps in order. It takes about an hour the first time.

Already set up before 22 Oct 2026? Do the **Updating** section at the end instead.

**What you need**
- A computer (Windows is fine) with [Node.js 22 LTS or newer](https://nodejs.org) and, optionally, Git.
- A free [Supabase](https://supabase.com) account (database and logins).
- A free [Expo](https://expo.dev) account (builds the Android app). Your Expo account is `jadee55`.
- A Google account for Firebase (phone notifications) and Google Cloud (Google Maps).
- An Android phone to install the app.

**Two keys, two rules**
- The Supabase **anon key** is public. It goes in `web/.env`, the app's `.env` and `eas.json`.
- The Supabase **service_role key**, the **Firebase private key file** and the **Google Maps key** are secret. Never put them in Git, in a chat or in a screenshot.

---

## Step 1. Database (Supabase)

1. In Supabase, create a project (or open the existing ECollect project). Choose the region closest to the Philippines, for example Singapore.
2. **Back up first** if the project already has data: Table Editor → each table → … → Export to CSV.
3. Database → **Extensions** → turn on **pg_net** (it sends the phone notifications).
4. Open **SQL Editor** → New query. Paste each file below, click **Run**, and wait for "Success" before the next one:
   1. `supabase/setup/01_schema.sql`
   2. `supabase/setup/02_security.sql`
   3. `supabase/setup/03_logic.sql`
   4. **Only one** of these, and only once:
      - `supabase/setup/04_upgrade_existing.sql`: the project **already has ECollect data**.
      - `supabase/setup/04_data.sql`: a **new, empty** project. It loads the Barangay Poblacion data.
   5. `supabase/setup/05_split_mwf_stops.sql`: only for a project set up **before 20 Oct 2026** (single truck, Mon/Wed/Fri: Back of Kim Guan 5:00–5:30 PM for Zones 5–6, then Sapporo – Araneta St. 5:30–6:00 PM for Zones 1–2).
   6. `supabase/setup/06_report_photos.sql`: creates the private **report-photos** storage for photos residents attach to reports.
5. Project Settings → **API**: copy the **Project URL** and the **anon public** key. You need them in steps 3, 5 and 6.

Files 01–03 and 06 are safe to run again. Run them again whenever an update changes them.

## Step 2. Staff accounts (Edge Function)

Creating logins for staff needs the service_role key, so it runs inside Supabase. In a terminal, in the project folder:

```
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF      (the part before .supabase.co)
npx supabase functions deploy manage-staff
```

For a **new** project, create the first LGU Admin login once with `npm run seed:lgu`. The instructions are at the top of `scripts/seed-lgu-admin.mjs`. The existing project already has it.

## Step 3. Admin website

In a terminal:

```
cd web
copy .env.example .env
```

Open `web/.env` in Notepad and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (from step 1.5). Then:

```
npm install
npm run dev
```

Open http://localhost:5173 → **Login** → choose *Barangay Admin* or *LGU Admin*.

**Put it online (free).** On [Vercel](https://vercel.com) or [Netlify](https://netlify.com), import the project and set:
- Root directory: `web`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Then, in Supabase → Authentication → URL Configuration, set **Site URL** to the website's address.

**First things on the website (Barangay Admin):**
1. **Collection schedule → Truck crew:** choose the collector who drives the truck. Until then no collector sees the schedule.
2. **Garbage collectors:** create a login for each collector (email and password). They use it in the app.
3. **Truck stops:** confirm each stop's exact spot with the barangay, then tick "confirmed".

**Google Maps on the website (optional).** Without it, the website uses the street map. With it, every map (Live map, dashboards, Zones & routes, the emergency location picker, the report drawer) is Google Maps, locked to Barangay Poblacion, with a Satellite button.
1. In Google Cloud (same project as step 5), **APIs & Services → Library** → enable **Maps JavaScript API**.
2. **Credentials → Create credentials → API key** (a separate key from the app's). Restrict it: *Application restrictions* → **Websites** → add `http://localhost:5173/*` (and later your online address, e.g. `https://your-site.vercel.app/*`); *API restrictions* → only **Maps JavaScript API**.
3. Add one line at the end of `web/.env`: `VITE_GOOGLE_MAPS_API_KEY=your-website-key`, then restart `npm run dev`. When you host the site, add the same name and value under the host's Environment variables.

## Step 4. Firebase (phone notifications)

Needed for notifications sent by the system: emergency pickups for collectors; for residents, "truck is near", "not collected", replies to reports and announcements. Reminders made on the phone itself work without it.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Google Analytics is not needed).
2. **Add app → Android**, package name `ph.ecollect.poblacion`. Download **google-services.json** and put it in the app's project folder, next to `app.json`. (`app.json` already points to it.)
3. Project settings → **Service accounts** → **Generate new private key**. This downloads a secret key file. Keep it outside the project folder, or make sure its name ends in `-firebase-adminsdk-….json` (Git ignores those).
4. In a terminal in the project folder: `npx eas-cli credentials` → Android → **preview** → Google Service Account → *Manage your Google Service Account Key for Push Notifications (FCM V1)* → *Set up* → upload the key file from step 3.

## Step 5. Google Maps key (for the app's maps)

The maps show only Barangay Poblacion: the barangay boundary, zones, truck stops, extra pickups and the truck. Shop and place pins are hidden, and there is a satellite button. Without a key the app still works and shows a simpler street map.

1. [console.cloud.google.com](https://console.cloud.google.com) → choose or create a project (it can be the Firebase project).
2. **APIs & Services → Library** → enable **Maps SDK for Android**. Google asks for a billing account; Maps SDK for Android has a free monthly allowance.
3. **APIs & Services → Credentials → Create credentials → API key.** Then **restrict** it:
   - Application restrictions: **Android apps** → Add → package `ph.ecollect.poblacion` and the **SHA-1** of the app's signing key. To see the SHA-1, run `npx eas-cli credentials` → Android → preview → it shows "SHA1 Fingerprint".
   - API restrictions: **Restrict key** → only **Maps SDK for Android**.
4. Give the key to Expo, **not** to Git, in a terminal in the project folder:

```
npx eas-cli env:set --name GOOGLE_MAPS_API_KEY --value YOUR-KEY --environment preview --visibility sensitive
```

   You can also add it on expo.dev → your project → **Environment variables**: name `GOOGLE_MAPS_API_KEY`, environment *preview*, visibility *Sensitive*.

**About the key you already have:** it was shared in our chat. If it is not restricted yet, either restrict it now (step 3), or, safer, create a new key, restrict it, and delete the old one.

## Step 6. Mobile app

In a terminal, in the app's project folder (not `web`):

```
copy .env.example .env
npm install
```

Open `.env` in Notepad and fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Optionally add `GOOGLE_MAPS_API_KEY=` for Google Maps while testing on your computer.

**Quick test with Expo Go.** Run `npx expo start` and scan the QR code with the Expo Go app. In Expo Go, notifications from the system and background GPS don't work; everything else does.

**Build the installable app (APK).**
1. Open `eas.json`. Under `"preview"`, keep `"environment": "preview"` and add your two public values. EAS doesn't upload `.env`.

```json
"preview": {
  "distribution": "internal",
  "android": { "buildType": "apk" },
  "environment": "preview",
  "env": {
    "EXPO_PUBLIC_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your anon public key"
  }
}
```

2. Build:

```
npx eas-cli login
npx eas-cli build -p android --profile preview
```

3. When it finishes (about 10–20 minutes), open the link it prints on the phone, download the APK and install it. Android asks to allow installing from this source; allow it.

**On the phone**
- **Residents** tap *Create account*. *Use my location (at home)* finds their zone; they can check and change it. Then allow notifications.
- **Collectors** sign in with the login from the website. Tap **Start shift** first: stops, emergency pickups, *Report a problem* and GPS work only during a shift, and *End shift* stops the GPS. When asked, allow location **"All the time"** so the truck stays on the map when the phone is locked.
- **More** shows whether notifications from the barangay are on. The resident app also has the **Pickup reminders** switch (7:00 PM the day before, and 30 minutes before the truck).

## Step 7. Check that it works

1. Website (Barangay Admin): create an announcement. Both apps show it under News / Announcements, and the phones get a notification.
2. Collector app: Start shift → turn on GPS. In the resident app, **Truck** shows the truck (and Home says "The truck is sharing its location").
3. Collector: mark a stop **Done**. The resident's Home shows "Collected today" and the "How was today's pickup?" card.
4. Resident: **Report → New report** with a photo. On the website, **Resident feedback** → *Open · reply* shows the photo; reply and set *In Progress*. The resident sees "Seen by the barangay" and the reply.
5. Collector: End shift. The truck disappears from the resident's map.

## Updating an existing setup (22 Oct 2026 update)

1. **Database:** in the SQL Editor run `01_schema.sql`, `02_security.sql`, `03_logic.sql`, then `06_report_photos.sql` (new).
2. **Website:** replace the `web` folder with the new one, keeping your `web/.env`. Run `npm install`, then `npm run dev`, or redeploy on Vercel/Netlify.
3. **App:** replace the project files, keeping your `.env`, `eas.json` and `google-services.json`. Add `"environment": "preview"` to the preview profile in `eas.json` (see step 6). Run `npm install` (new packages: image picker for report photos), do step 5 (Google Maps key), then build a new APK. Install it over the old one; collectors stay signed in.

## Updating: notifications inbox and report ratings (22 Oct 2026, afternoon)

1. **Database:** in the SQL Editor run `01_schema.sql`, `02_security.sql`, `03_logic.sql` again, in that order. They add the inbox "read" mark, the report rating (stars, comment, proof photo) and make every resident's alerts appear in the inbox even without a registered phone. Nothing is deleted.
2. **Website:** replace the `web` folder (keep `web/.env`), then `npm run dev` or redeploy.
3. **App:** replace the project files (keep `.env`, `eas.json`, `google-services.json`), delete the old `src/screens` files listed in the chat if they are still there, run `npm install`, then build a new APK.

## Updating: Google Maps on the website, Submit to LGU, emergency search and delete (22 Oct 2026, last update)

1. **Database:** run `01_schema.sql`, `02_security.sql`, `03_logic.sql` again (adds the submitted-report fields and the rule that lets the Barangay Admin delete completed or cancelled emergency collections).
2. **Website:** replace the `web` folder (keep `web/.env`), add the Google Maps line to `web/.env` (see step 3), `npm install`, `npm run dev`.
3. **App:** no change in this update.

## Troubleshooting

| Problem | What to do |
|---|---|
| "Supabase isn't set up" in the app | `.env` (Expo Go) or `eas.json` `env` (APK) is missing the URL or anon key. |
| The map is grey with only the zones | No internet, or the Google key is wrong or not yet allowed for this app's SHA-1. Check the key restrictions (step 5). Without a key, the app uses the street map. |
| "Start your shift first" | Collector: tap Start shift on Today. |
| Notifications "not available" in More | Use the APK (not Expo Go), check Firebase (step 4) and pg_net (step 1.3), allow notifications for ECollect in Android settings, then tap *Try again*. |
| A photo cannot be uploaded | Run `06_report_photos.sql`. Photos must be JPEG/PNG under 5 MB; the app shrinks them automatically. |
| The website map is plain (no Google Maps) | `VITE_GOOGLE_MAPS_API_KEY` is missing from `web/.env`, the dev server was not restarted, or the key is not allowed for this address (check the key's Websites list and that Maps JavaScript API is enabled). The browser console says which. |
| Website pages show nothing after a while | Free Supabase projects pause after about a week without use. Open the Supabase dashboard and restore the project. |

More details on how each part works are in `SETUP.md`.

## Update 22 Oct 2026 (evening): trucks move to the Barangay Admin, truck trail removed
1. In Supabase → SQL Editor, run `supabase/setup/07_trucks_barangay.sql` once. After it, only the Barangay Admin can add, edit or remove trucks; the LGU Admin can only view them.
2. Replace the website files from the update zip and restart `npm run dev`.
3. Barangay Admin → Trucks: add a truck, tick the collectors who drive it and choose the zone each one covers. The LGU sees the same list read-only.

## Update 22 Oct 2026 (night): emergency collections in a pop-up, closed ones locked
1. In Supabase → SQL Editor, run `supabase/setup/08_emergency_lock.sql` once. After it, a Completed or Cancelled emergency collection can no longer be edited from the website (it can still be deleted). The collector app's "Undo: not completed yet" still works.
2. Replace the website files from the update zip; `npm run dev` reloads them.

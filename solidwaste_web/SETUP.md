# ECollect setup (Supabase, admin website, mobile app)

**Installing for the first time? Follow `INSTALL.md` step by step.** This file explains how the parts work.

There is one database, **Supabase**. The admin website (`web/`) and the mobile app (Expo, project root) both use it.

| Who | Uses | Signs in with |
|---|---|---|
| LGU Admin, Barangay Admin | Website (`web/`) | Email and password created in the system |
| Garbage collector | Mobile app | Login created by the Barangay Admin (website → Garbage collectors) |
| Resident | Mobile app | Self sign-up in the app |

Keys:
- **anon key** (Project Settings → API): public. It goes in `web/.env` and the app's `.env`.
- **service_role key**: secret. It only ever goes in `.env.seed` on your own computer and in Supabase itself. Never put it in `web/.env`, the app, GitHub or a chat.

---

## 1. Database

Open Supabase → **SQL Editor** → New query. Paste each file, click **Run**, and wait for it to finish before the next one.

1. `supabase/setup/01_schema.sql`
2. `supabase/setup/02_security.sql`
3. `supabase/setup/03_logic.sql`
4. **One** of:
   - `supabase/setup/04_upgrade_existing.sql`: your project **already has ECollect data** (the current project). It keeps every row; see the list at the top of the file. The last two result tables should show Zone 1 … Zone 10 with the official days and times, and `17` active fixed rows.
   - `supabase/setup/04_data.sql`: a **new, empty** project only. It loads the Barangay Poblacion data copied from the old MySQL database.

5. `supabase/setup/06_report_photos.sql`: storage for photos residents attach to reports (22 Oct 2026). Safe to run again; run it again after re-running `02_security.sql`.

Files 01–03 are safe to run again later, and **must** be run again after an update that changes them, for example the collector-app updates: truck-stop visits and field reports (19 Oct 2026), then missed stops, truck load, shifts and notifications (20 Oct 2026), then the shift lock, resident app and report photos (22 Oct 2026). Run 04 only once.

> **Back up first.** Free projects have no automatic backups. Before step 1, export each table from the Table Editor (… → Export to CSV).

If `04_upgrade_existing.sql` stops with "Zone records need attention", nothing was changed. Send the message to whoever maintains the system.

## 2. Staff-account function

Creating and deleting logins needs the service key, so it runs as a Supabase **Edge Function** rather than in the website. Install the Supabase CLI and deploy once (again after any change to `supabase/functions/`):

```
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF      # the part before .supabase.co
npx supabase functions deploy manage-staff
```

Who can do what with it:
- the **LGU Admin** creates Barangay Admin accounts and deletes resident accounts;
- the **Barangay Admin** creates, edits and deletes garbage collector accounts.

The LGU Admin login already exists in the current project. For a new project, create it once with `npm run seed:lgu` (instructions at the top of `scripts/seed-lgu-admin.mjs`).

## 3. Website

```
cd web
cp .env.example .env        # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev                 # http://localhost:5173
```

Sign in on the home page with **Login**, choosing *Barangay Admin* or *LGU Admin*.

**Put it online (free):** on Vercel or Netlify, import the GitHub repository and set:
- **Root directory:** `web`
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variables:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

`web/vercel.json` and `web/public/_redirects` make page links such as `/barangay/schedules` work when opened directly.

Then add the website's address in Supabase → Authentication → URL Configuration (Site URL).

## 4. After the upgrade, on the website

1. **Barangay Admin → Collection schedule → Truck crew:** choose the collector who drives the truck. Until then, no collector sees the fixed schedule in the app.
2. **Truck stops:** confirm each stop's exact spot with the barangay, then tick "confirmed". Consunji St. has no Google Maps link yet.
3. **Single truck, Mon/Wed/Fri 5:00–6:00 PM** (decided 20 Oct 2026): 1st stop **Back of Kim Guan** 5:00–5:30 PM for **Zones 5 and 6**, 2nd stop **Sapporo – Araneta St.** 5:30–6:00 PM for **Zones 1 and 2**, 30 min standby each. A project set up before that date: run `supabase/setup/05_split_mwf_stops.sql` once in the SQL Editor (after 01–03).
4. **Zone areas:** the traced zone areas are provisional (dashed on the map) until the barangay confirms them.
5. **Collectors without a login:** collectors that appear with "No login yet" get one when you set a password on their Edit form.

## 5. Collector app (mobile)

In the project folder (not `web/`):

```
copy .env.example .env      # then fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start              # scan the QR code with the Expo Go app on the phone
```

Sign in with a collector account the Barangay Admin created. In **Expo Go**, location sharing works while the app is open (Expo Go cannot share in the background).

**Installable app (APK) with background GPS** — built free in the cloud by Expo (EAS):

```
npm install -g eas-cli      # once
eas login                   # free Expo account
eas build -p android --profile preview
```

Before the first build, put the two public values in `eas.json`, because EAS does not upload `.env` (it is git-ignored). Under `"preview"`, add:

```
"env": {
  "EXPO_PUBLIC_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your anon / publishable key"
}
```

Use the anon key, never the service_role key. When the build finishes, open the link it prints on the phone and install the APK. On first "Start sharing", allow location **"All the time"** so the truck stays on the map when the phone is locked; Android then shows an "ECollect is sharing the truck's location" notification while it runs.

What the collector sees:
- **Shift lock:** without an open shift the collector can only look (and change the password or log out). Stops, emergency pickups, Report a problem and GPS need **Start shift**; the database refuses them too. **End shift** stops the GPS.
- **Today:**
  - **Start shift / End shift** (the barangay sees the truck's working hours in Reports).
  - The GPS switch.
  - The day's truck stops: time, place, standby, zones and "Open in Google Maps" to the exact spot. Each stop has **Done at this stop** (then a quick "how full is the truck?" ¼ / ½ / ¾ / Full, or skip) and **Couldn't collect** (reason and note; it also appears under *Field reports from the truck*, and the zones show *Missed: reason* on the website).
  - Open emergency pickups (*On the way* → *Mark completed*). Completed or cancelled ones leave Today and stay in the Emergency tab.
  - A zone counts as collected when every stop serving it that day is done.
- **Arrival and standby:** while location sharing is on, reaching a stop (within 50 m) shows "You're at …" and starts the standby countdown; a reminder comes when the standby time is over. The collector can also start the timer by hand. Nothing is marked done automatically.
- **No signal:** the day stays on the phone, and taps are saved and sent with the time they were tapped once the signal is back.
- **Emergency:** every emergency pickup assigned to the collector, filtered as *Needs action* (today and overdue), *Coming up*, *Completed* and *Cancelled* (all history, 30 at a time with "Show more"), with a search box, details, directions and progress. The tab shows a red badge with the number that need action, and an emergency notification opens it.
- **Week, Map:** Google Maps when the app is built with a key (`GOOGLE_MAPS_API_KEY`, see INSTALL.md step 5), otherwise the street map. Only Poblacion: the camera stays on the barangay, outside is faded, shop and place pins are hidden, and there is a satellite button. The truck is a top-view truck turned to its direction of travel; open emergency pickups are red pins.
- **More:** Report a problem (also a quick link on Today), Announcements, My history (last 14 days), Account (change password, log out).
- GPS stops by itself one hour after the day's last stop.

### Notifications

The phone reminds the collector 15 minutes before the first stop, and shows the arrival and standby alerts. These work in Expo Go too.

Notifications **from the barangay** need the installed app (APK) and a free Firebase project. They cover emergency pickups that are new, changed, reassigned or cancelled, a truck stop's new days or time, and new announcements. Do this once:

1. **Firebase.**
   1. [console.firebase.google.com](https://console.firebase.google.com) → Add project.
   2. Add an **Android app** with package name `ph.ecollect.poblacion`.
   3. Download **google-services.json** into the project folder (next to `app.json`).
   4. In `app.json`, under `"android"`, add `"googleServicesFile": "./google-services.json"`.
2. **Firebase key for Expo.**
   1. Firebase → Project settings → Service accounts → **Generate new private key**.
   2. Run `eas credentials` → Android → production → Google Service Account → *Manage your Google Service Account Key for Push Notifications (FCM V1)* → *Set up …* → *Upload a new service account key*.
   3. That key file is secret: do not commit it.
3. **Build the APK** (`eas build -p android --profile preview`). The first `eas build` links the project to Expo (it adds `extra.eas.projectId` to `app.json`).
4. **Supabase.** The **pg_net** extension sends the notifications; `01_schema.sql` turns it on. If it says pg_net is not available, turn it on under Database → Extensions → pg_net and run `01_schema.sql` again.

On the phone, **More** shows whether notifications are on. Every notification is also recorded in the `notification` table.

## 6. Resident app (same app, resident login)

Residents create their own account in the app (*Use my location (at home)* suggests the zone from the approximate zone areas).
- **Home:** today's pickup in plain words (pickup today / truck stop open now / collected at … / not collected and why / waiting for the truck), the live truck when it is sharing GPS, this week's pickup days, my truck stop(s) with directions, extra (emergency) pickups in my zone, and **How was today's pickup?** (*Good* or *Had a problem*, once a day, after the truck came or the time passed). Drop-off zones (Zone 10) are told to bring garbage to the barangay's place.
- **Truck:** the Poblacion map with my zone highlighted, my stops coloured by today's state, extra pickups, and trucks serving my zone while their collector is on shift and sent GPS in the last 15 minutes (updates every 15 s).
- **Report:** new report (type, text, optional photo and current location) and my reports with *Sent → Seen → Resolved*, the barangay's reply and every update. Photos are in the private `report-photos` storage: only the resident and the admins can open them.
- **Bell (Home):** the notification inbox — every alert, grouped by day, All / Unread, "Mark all as read"; tapping one opens the matching screen. Collectors have the same bell on Today.
- **Report ratings:** once the barangay resolves or closes a report, the resident rates how it was handled (1–5 stars, comment, optional proof photo), once. The website shows it in the report drawer, as the "Handling rating" tile on Resident feedback, and in Reports → "How residents rated report handling" (by month and type, low ratings listed).
- **News** (search; tap a post to read it in full; badge for new announcements) and **More:** waste sorting guide (search and category filter), my zone's pickup history (7/30/60 days, filters, search, list or calendar), my details and zone, pickup reminders switch, notification status, password and log out.
- **Alerts from the system** (need the APK and Firebase): the truck is near my stop (300 m), garbage not collected (with the reason), a reply or status change on my report, new announcements. **Reminders on the phone:** 7:00 PM the day before and 30 minutes before the truck.
- Without signal the app shows the last Home, map, news and history saved on the phone.

On the website, **Resident feedback** shows the photo in the report drawer; good pickup ratings are counted (Feedback tile and **Reports → Resident pickup ratings**, by zone), while "Had a problem" ratings are listed as concerns to handle.

## 7. Website extras (22 Oct 2026)

- **Maps:** Google Maps (Maps JavaScript API) when `web/.env` has `VITE_GOOGLE_MAPS_API_KEY`, otherwise the street map. Either way only Barangay Poblacion is in view (camera held around it, outside faded, shop pins hidden on Google) and there is a Satellite button. The **Live map** refreshes every 10 s, trucks glide to each new GPS position, and *Today’s truck trail* shows where each truck drove on the selected day.
- **Emergency collections:** search (place, reason, notes, zone, collector, truck, status); the Barangay Admin can **Delete** completed or cancelled ones (test or wrong entries).
- **Submit to LGU:** on Reports the Barangay Admin clicks *Submit to LGU*, adds a title and remarks; the figures are saved as they are. The LGU sees them under **Submitted reports** (red count for new ones), opens one, then *Mark reviewed* or *Return with comments*. The barangay follows them under **Sent to the LGU** (red count for returned ones). Submitted reports cannot be edited or deleted.

## Notes

- **Free plan pausing:** Supabase pauses a free project after about a week without activity. Open the dashboard and restore it before a demo.
- **Zone lock:** the 10 zones are locked in the database: they cannot be added, renamed or deleted, even in the Table Editor. For an official re-zoning, see the comment at the top of the zone section in `03_logic.sql`.
- **Server clock:** times come from the server clock in Philippine time, not from phones.

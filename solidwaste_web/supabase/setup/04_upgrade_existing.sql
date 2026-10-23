-- =====================================================================
-- ECollect | Supabase setup 4 of 4 (EXISTING project): upgrade your data
-- Run ONCE in Supabase -> SQL Editor, after 01_schema.sql, 02_security.sql
-- and 03_logic.sql, on a project that already has ECollect data.
-- (For a new, empty project run 04_data.sql instead.)
--
-- Keeps every existing row. What it changes:
--   1. Removes the two unused test rows in the zone table (route 2 with no name,
--      route 18 named "1"), approved 20 Oct 2026, only if nothing uses them.
--   2. Checks there are exactly Zone 1 ... Zone 10 afterwards; stops (changing
--      nothing) if not.
--   3. Adds each zone's traced area (provisional) and marks Zone 10 as drop-off:
--      residents bring their garbage to the designated place, so it has no
--      collection days or time (its old Tue/Thu/Sat 9-10 AM is cleared).
--   4. Adds the 6 truck stops of the barangay's official fixed schedule.
--   5. Sets the older schedule rows to Inactive (not deleted) and creates the
--      fixed schedule from the truck stops (one row per zone per collection day).
--      Zones 3, 4, 7, 8, 9 and 10 change to the official days and times.
--   6. Writes resident report statuses in one spelling ('pending' -> 'Pending').
-- Matches zones by name (Zone 1 ... Zone 10), never by number.
-- Everything runs in one transaction: if any step fails, nothing is changed.
-- =====================================================================
begin;

-- 0. Were 01_schema.sql, 02_security.sql and 03_logic.sql run first?
do $$
begin
  if to_regclass('public.collection_point') is null or to_regclass('public.emergency_collection') is null then
    raise exception 'Run 01_schema.sql first (then 02_security.sql and 03_logic.sql), then this file. Nothing was changed.';
  end if;
  if to_regprocedure('public.is_barangay()') is null then
    raise exception 'Run 02_security.sql first (then 03_logic.sql), then this file. Nothing was changed.';
  end if;
  if to_regprocedure('public.fs_sync()') is null or to_regprocedure('public.route_lock()') is null then
    raise exception 'Run 03_logic.sql first, then this file. Nothing was changed.';
  end if;
end $$;

set local ecollect.allow_zone_change = 'on';

-- 1. Unused test rows in the zone table
do $$
declare r record;
begin
  for r in select route_id, zone_name from public.route
           where (route_id = 2 and zone_name is null) or (route_id = 18 and zone_name = '1')
  loop
    if exists (select 1 from public.collection_schedule where route_id = r.route_id)
       or exists (select 1 from public.resident where route_id = r.route_id)
       or exists (select 1 from public.garbage_collector where route_id = r.route_id)
       or exists (select 1 from public.collection_point where route_id = r.route_id)
       or exists (select 1 from public.collection_point_zone where route_id = r.route_id)
       or exists (select 1 from public.emergency_collection where route_id = r.route_id) then
      raise notice 'Kept route % (%): something still uses it.', r.route_id, coalesce(r.zone_name, 'no name');
    else
      delete from public.route where route_id = r.route_id;
      raise notice 'Removed unused route % (%).', r.route_id, coalesce(r.zone_name, 'no name');
    end if;
  end loop;
end $$;

-- 2. Exactly Zone 1 ... Zone 10?
do $$
declare v_missing text; v_extra text;
begin
  select string_agg(z, ', ') into v_missing from (select 'Zone ' || n as z from generate_series(1, 10) n) want
   where not exists (select 1 from public.route r where btrim(r.zone_name) = want.z);
  select string_agg(coalesce(zone_name, '(no name)') || ' [route ' || route_id || ']', ', ') into v_extra from public.route
   where coalesce(btrim(zone_name), '') not in (select 'Zone ' || n from generate_series(1, 10) n);
  if v_missing is not null or v_extra is not null
     or (select count(*) from public.route) <> 10 then
    raise exception 'Zone records need attention before upgrading. Missing: %. Not a Zone 1-10 name: %. Nothing was changed.',
      coalesce(v_missing, 'none'), coalesce(v_extra, 'none');
  end if;
end $$;

-- 3. Traced zone areas (provisional until the barangay confirms them) and Zone 10 drop-off
update public.route set boundary_coordinates = '[{"latitude":8.227377,"longitude":124.237541},{"latitude":8.227013,"longitude":124.240111},{"latitude":8.225933,"longitude":124.239934},{"latitude":8.226372,"longitude":124.237806},{"latitude":8.227072,"longitude":124.237281}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 1';
update public.route set boundary_coordinates = '[{"latitude":8.228757,"longitude":124.239178},{"latitude":8.228462,"longitude":124.241077},{"latitude":8.226933,"longitude":124.240831},{"latitude":8.227228,"longitude":124.23898}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 2';
update public.route set boundary_coordinates = '[{"latitude":8.230366,"longitude":124.23835},{"latitude":8.23124,"longitude":124.239745},{"latitude":8.230904,"longitude":124.24008},{"latitude":8.231264,"longitude":124.240849},{"latitude":8.229946,"longitude":124.240651},{"latitude":8.229944,"longitude":124.241102},{"latitude":8.229465,"longitude":124.241196},{"latitude":8.228605,"longitude":124.241125},{"latitude":8.228852,"longitude":124.239207},{"latitude":8.230266,"longitude":124.239472}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 3';
update public.route set boundary_coordinates = '[{"latitude":8.230101,"longitude":124.237773},{"latitude":8.230338,"longitude":124.238206},{"latitude":8.230175,"longitude":124.238445},{"latitude":8.230143,"longitude":124.239309},{"latitude":8.228852,"longitude":124.239159},{"latitude":8.229078,"longitude":124.23774}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 4';
update public.route set boundary_coordinates = '[{"latitude":8.228983,"longitude":124.237644},{"latitude":8.228786,"longitude":124.239082},{"latitude":8.227257,"longitude":124.238884},{"latitude":8.227454,"longitude":124.23757}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 5';
update public.route set boundary_coordinates = '[{"latitude":8.229298,"longitude":124.235467},{"latitude":8.229031,"longitude":124.237577},{"latitude":8.227425,"longitude":124.237541},{"latitude":8.22712,"longitude":124.237262},{"latitude":8.228132,"longitude":124.235462}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 6';
update public.route set boundary_coordinates = '[{"latitude":8.230994,"longitude":124.236981},{"latitude":8.230892,"longitude":124.2384},{"latitude":8.230701,"longitude":124.238496},{"latitude":8.230273,"longitude":124.237774},{"latitude":8.23015,"longitude":124.23763},{"latitude":8.229098,"longitude":124.237596},{"latitude":8.229489,"longitude":124.235535},{"latitude":8.229967,"longitude":124.235614},{"latitude":8.230375,"longitude":124.236431},{"latitude":8.230631,"longitude":124.236912}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 7';
update public.route set boundary_coordinates = '[{"latitude":8.231195,"longitude":124.234611},{"latitude":8.230994,"longitude":124.236933},{"latitude":8.230678,"longitude":124.236912},{"latitude":8.230441,"longitude":124.236431},{"latitude":8.230015,"longitude":124.235566},{"latitude":8.229423,"longitude":124.235343},{"latitude":8.229589,"longitude":124.23448}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 8';
update public.route set boundary_coordinates = '[{"latitude":8.231967,"longitude":124.232935},{"latitude":8.231243,"longitude":124.234535},{"latitude":8.22959,"longitude":124.234384},{"latitude":8.229638,"longitude":124.234269},{"latitude":8.231155,"longitude":124.232596}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'truck'
 where btrim(zone_name) = 'Zone 9';
update public.route set boundary_coordinates = '[{"latitude":8.230983,"longitude":124.232595},{"latitude":8.230503,"longitude":124.233188},{"latitude":8.229738,"longitude":124.233185},{"latitude":8.228811,"longitude":124.233162},{"latitude":8.228755,"longitude":124.232845},{"latitude":8.228162,"longitude":124.232804},{"latitude":8.228052,"longitude":124.23407},{"latitude":8.228028,"longitude":124.235126},{"latitude":8.22818,"longitude":124.23529},{"latitude":8.22927,"longitude":124.235342},{"latitude":8.229466,"longitude":124.234316},{"latitude":8.22983,"longitude":124.233934}]', boundary_source = 'Traced from the Barangay Poblacion zone map (received 19 Oct 2026); provisional until confirmed by the barangay', collection_mode = 'drop_off'
 where btrim(zone_name) = 'Zone 10';
update public.route set collection_days = null, start_time = null, end_time = null
 where collection_mode = 'drop_off';

-- 4. Truck stops of the official fixed schedule (skipped if a stop with that name exists)
insert into public.collection_point (name, landmark, route_id, latitude, longitude, location_source, location_confirmed, maps_url,
  collection_days, start_time, end_time, standby_minutes, stop_order, is_active)
select 'Back of Kim Guan', 'Kim Guan Educational and Sportsmaster, Inc.', (select route_id from public.route where btrim(zone_name) = 'Zone 5'), 8.22747470, 124.23828050, 'Exact spot from the Google Maps link given by the barangay (19 Oct 2026)', false, 'https://www.google.com/maps/place/8%C2%B013%2738.9%22N+124%C2%B014%2717.8%22E/@8.2277837,124.2380155,9a,75y,168.04h,71.27t/data=!3m7!1e1!3m5!1sGBrj20aGAY5-nL1ClGGMhw!2e0!6shttps:%2F%2Fstreetviewpixels-pa.clients6.google.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile%26w%3D900%26h%3D600%26pitch%3D18.73179686577575%26panoid%3DGBrj20aGAY5-nL1ClGGMhw%26yaw%3D168.0390762934162!7i16384!8i8192!4m4!3m3!8m2!3d8.2274747!4d124.2382805?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D',
  'Monday,Wednesday,Friday', '17:00:00', '17:30:00', 30, 1, true
where not exists (select 1 from public.collection_point where name = 'Back of Kim Guan');
insert into public.collection_point (name, landmark, route_id, latitude, longitude, location_source, location_confirmed, maps_url,
  collection_days, start_time, end_time, standby_minutes, stop_order, is_active)
select 'Sapporo - Araneta St.', 'Sapporo Tea House, near Iligan City National High School', (select route_id from public.route where btrim(zone_name) = 'Zone 1'), 8.22648740, 124.23960640, 'Exact spot from the Google Maps link given by the barangay (19 Oct 2026)', false, 'https://www.google.com/maps/place/Sapporo+Tea+House+Iligan/@8.2266665,124.2391922,8a,75y,270.32h,86.26t/data=!3m7!1e1!3m5!1sJIQ2JbD8lQw-W6-h2W4Eng!2e0!6shttps:%2F%2Fstreetviewpixels-pa.clients6.google.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile%26w%3D900%26h%3D600%26pitch%3D3.7421382910431475%26panoid%3DJIQ2JbD8lQw-W6-h2W4Eng%26yaw%3D270.31876220761546!7i16384!8i8192!4m14!1m7!3m6!1s0x3255758cd09f1de7:0x5043451566fdac30!2sSapporo+Tea+House+Iligan!8m2!3d8.2264874!4d124.2396064!16s%2Fg%2F11mp81tsd7!3m5!1s0x3255758cd09f1de7:0x5043451566fdac30!8m2!3d8.2264874!4d124.2396064!16s%2Fg%2F11mp81tsd7?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D',
  'Monday,Wednesday,Friday', '17:30:00', '18:00:00', 30, 2, true
where not exists (select 1 from public.collection_point where name = 'Sapporo - Araneta St.');
insert into public.collection_point (name, landmark, route_id, latitude, longitude, location_source, location_confirmed, maps_url,
  collection_days, start_time, end_time, standby_minutes, stop_order, is_active)
select 'Cocogrove / Baslayan', 'Golden Star General Merchandise & Supermarket (road between Zones 7 and 8)', (select route_id from public.route where btrim(zone_name) = 'Zone 7'), 8.22945310, 124.23573190, 'Exact spot from the Google Maps link given by the barangay (19 Oct 2026)', false, 'https://www.google.com/maps/place/8%C2%B013%2746.0%22N+124%C2%B014%2708.6%22E/@8.2299575,124.2356332,7a,75y,112.48h,63.73t/data=!3m7!1e1!3m5!1sH8XybnT56V0o2vZAm31HDg!2e0!6shttps:%2F%2Fstreetviewpixels-pa.clients6.google.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile%26w%3D900%26h%3D600%26pitch%3D26.27417311794119%26panoid%3DH8XybnT56V0o2vZAm31HDg%26yaw%3D112.48153499562744!7i16384!8i8192!4m4!3m3!8m2!3d8.2294531!4d124.2357319?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D',
  'Thursday', '19:00:00', '20:00:00', 60, 1, true
where not exists (select 1 from public.collection_point where name = 'Cocogrove / Baslayan');
insert into public.collection_point (name, landmark, route_id, latitude, longitude, location_source, location_confirmed, maps_url,
  collection_days, start_time, end_time, standby_minutes, stop_order, is_active)
select 'Phil Am', 'PHILAM LIFE', (select route_id from public.route where btrim(zone_name) = 'Zone 3'), 8.23125400, 124.24003400, 'Exact spot from the Google Maps link given by the barangay (19 Oct 2026)', false, 'https://www.google.com/maps/place/8%C2%B013%2752.5%22N+124%C2%B014%2724.1%22E/@8.2309018,124.2400108,8a,75y,154.24h,87.31t/data=!3m7!1e1!3m5!1siahbmDmqAHNcZ1GWLEOvgg!2e0!6shttps:%2F%2Fstreetviewpixels-pa.clients6.google.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile%26w%3D900%26h%3D600%26pitch%3D2.686534238186823%26panoid%3DiahbmDmqAHNcZ1GWLEOvgg%26yaw%3D154.236301074526!7i16384!8i8192!4m4!3m3!8m2!3d8.231254!4d124.240034?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D',
  'Tuesday', '17:00:00', '18:00:00', 60, 1, true
where not exists (select 1 from public.collection_point where name = 'Phil Am');
insert into public.collection_point (name, landmark, route_id, latitude, longitude, location_source, location_confirmed, maps_url,
  collection_days, start_time, end_time, standby_minutes, stop_order, is_active)
select 'Consunji St.', 'Consunji St.', (select route_id from public.route where btrim(zone_name) = 'Zone 4'), 8.23005440, 124.23981490, 'Google Maps reference given by barangay staff (19 Oct 2026)', false, null,
  'Thursday', '17:30:00', '18:30:00', 60, 1, true
where not exists (select 1 from public.collection_point where name = 'Consunji St.');
insert into public.collection_point (name, landmark, route_id, latitude, longitude, location_source, location_confirmed, maps_url,
  collection_days, start_time, end_time, standby_minutes, stop_order, is_active)
select 'Port Area', 'Bureau of Customs - Iligan (Port of Iligan)', (select route_id from public.route where btrim(zone_name) = 'Zone 9'), 8.23158100, 124.23339700, 'Exact spot from the Google Maps link given by the barangay (19 Oct 2026)', false, 'https://www.google.com/maps/place/8%C2%B013%2753.7%22N+124%C2%B014%2700.2%22E/@8.230629,124.2333851,8a,75y,150.65h,83.96t/data=!3m7!1e1!3m5!1sc8ZsVqavz93CEBebN6gXuw!2e0!6shttps:%2F%2Fstreetviewpixels-pa.clients6.google.com%2Fv1%2Fthumbnail%3Fcb_client%3Dmaps_sv.tactile%26w%3D900%26h%3D600%26pitch%3D6.041242294912394%26panoid%3Dc8ZsVqavz93CEBebN6gXuw%26yaw%3D150.64670668373964!7i16384!8i8192!4m4!3m3!8m2!3d8.231581!4d124.233397?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D',
  'Saturday', '18:30:00', '19:00:00', 30, 1, true
where not exists (select 1 from public.collection_point where name = 'Port Area');

-- Which zones each stop serves (Mon/Wed/Fri: Kim Guan = Zones 5-6, Sapporo = Zones 1-2; decided 20 Oct 2026)
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Back of Kim Guan' and btrim(r.zone_name) = 'Zone 5'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Back of Kim Guan' and btrim(r.zone_name) = 'Zone 6'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Sapporo - Araneta St.' and btrim(r.zone_name) = 'Zone 1'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Sapporo - Araneta St.' and btrim(r.zone_name) = 'Zone 2'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Cocogrove / Baslayan' and btrim(r.zone_name) = 'Zone 7'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Cocogrove / Baslayan' and btrim(r.zone_name) = 'Zone 8'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Phil Am' and btrim(r.zone_name) = 'Zone 3'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Consunji St.' and btrim(r.zone_name) = 'Zone 4'
on conflict do nothing;
insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id from public.collection_point cp, public.route r
 where cp.name = 'Port Area' and btrim(r.zone_name) = 'Zone 9'
on conflict do nothing;

-- 5. Older schedule rows -> Inactive (kept, with any pickup history); fixed schedule from the stops.
update public.collection_schedule set schedule_status = 'Inactive'
 where schedule_type = 'custom' and schedule_status = 'Active';
select public.fs_sync();

-- 6. One spelling for resident report statuses (the guard_feedback trigger normalises on update)
update public.feedback_report set status = status
 where status is distinct from initcap(status) or status is null;

commit;

-- Check 1: should list Zone 1 ... Zone 10 with the official days and times.
select route_id, zone_name, collection_days, start_time, end_time, collection_mode
  from public.route order by nullif(regexp_replace(zone_name, '\D', '', 'g'), '')::int;
-- Check 2: 17 active fixed-schedule rows (one per zone per collection day).
select count(*) as active_fixed_rows from public.collection_schedule where schedule_type = 'fixed' and schedule_status = 'Active';

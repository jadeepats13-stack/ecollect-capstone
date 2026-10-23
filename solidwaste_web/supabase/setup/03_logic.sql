set client_min_messages = warning;
-- =====================================================================
-- ECollect | Supabase setup 3 of 4: rules and actions
-- Run after 02_security.sql. Safe to re-run.
--   * Exactly 10 permanent zones (no add / rename / delete).
--   * Fixed schedule: truck stops drive the zones' days and times and the
--     per-zone schedule rows the mobile apps read.
--   * Actions the website calls (supabase.rpc): update_collection_point,
--     set_fixed_crew, update_zone_route, app_clock.
--   * Emergency collection checks.
-- =====================================================================

-- ---------- Clock (Philippine time; the database itself runs in UTC) ----------
create or replace function public.ph_now() returns timestamp
language sql stable as $$ select (now() at time zone 'Asia/Manila') $$;

create or replace function public.ph_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date $$;

/** The website uses the server's clock, so a wrong PC clock cannot change "today". */
create or replace function public.app_clock() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'date', to_char(public.ph_now(), 'YYYY-MM-DD'),
    'time', to_char(public.ph_now(), 'HH24:MI:SS'),
    'now',  to_char(public.ph_now(), 'YYYY-MM-DD HH24:MI:SS'),
    'day',  trim(to_char(public.ph_now(), 'Day')))
$$;
grant execute on function public.app_clock() to anon, authenticated;

-- ---------- The 10 permanent zones ----------
-- To deliberately change zones (e.g. after an official re-zoning), run in the SQL Editor:
--   set ecollect.allow_zone_change = 'on';   ...your change...;   reset ecollect.allow_zone_change;
create or replace function public.zone_change_allowed() returns boolean
language sql stable as $$ select coalesce(current_setting('ecollect.allow_zone_change', true), '') = 'on' $$;

create or replace function public.route_lock() returns trigger
language plpgsql as $$
begin
  if public.zone_change_allowed() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Zones are permanent: Barangay Poblacion has exactly 10 zones. New zones cannot be added.';
  elsif tg_op = 'DELETE' then
    raise exception 'Zones are permanent: Barangay Poblacion has exactly 10 zones. Zones cannot be deleted.';
  end if;
  if new.route_id is distinct from old.route_id or new.zone_name is distinct from old.zone_name then
    raise exception 'Zones are permanent: zone names and numbers cannot be changed.';
  end if;
  if public.api_request() then
    raise exception 'Zones can only be changed through the website''s Zones & routes page.';
  end if;
  return new;
end $$;

drop trigger if exists route_lock on public.route;
create trigger route_lock before insert or update or delete on public.route
  for each row execute function public.route_lock();

-- ---------- Helpers ----------
create or replace function public.week_days() returns text[]
language sql immutable as $$ select array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] $$;

/** "Monday, Friday,Junk" -> {Monday,Friday} in week order. */
create or replace function public.days_list(p_csv text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(d order by array_position(public.week_days(), d)), '{}')
  from (select distinct btrim(x) as d from unnest(string_to_array(coalesce(p_csv, ''), ',')) x) s
  where d = any (public.week_days())
$$;

create or replace function public.parse_hhmm(p text) returns time
language sql immutable as $$
  select case when btrim(coalesce(p, '')) ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
              then left(btrim(p), 5)::time end
$$;

/** Raises one error whose lines are the messages (the website shows each line). */
create or replace function public.raise_errors(p_errors text[]) returns void
language plpgsql as $$
begin
  if coalesce(array_length(p_errors, 1), 0) > 0 then
    raise exception using message = array_to_string(p_errors, E'\n'), errcode = 'P0001';
  end if;
end $$;

-- ---------- Fixed schedule ----------
/**
 * Rebuilds what is derived from the truck stops: each served zone's days and
 * time window, and its 'fixed' schedule rows (one per zone per weekday).
 * Never deletes rows: days that no longer apply are set to Inactive.
 */
create or replace function public.fs_sync() returns void
language plpgsql security definer set search_path = public as $$
declare
  z record;
  p record;
  v_days text[];
  v_start time;
  v_end time;
  v_point integer;
  v_crew integer;
  v_any boolean;
  d text;
  v_existing integer;
begin
  select case when count(distinct coalesce(garbage_collector_id, -1)) = 1 then max(garbage_collector_id) end
    into v_crew
    from collection_schedule where schedule_type = 'fixed' and schedule_status = 'Active';

  for z in select route_id, barangay_admin_id, collection_mode from route order by route_id loop
    continue when z.collection_mode = 'drop_off';
    v_days := '{}'; v_start := null; v_end := null; v_point := null; v_any := false;
    for p in
      select cp.* from collection_point cp
      join collection_point_zone cpz on cpz.collection_point_id = cp.collection_point_id
      where cpz.route_id = z.route_id and cp.is_active
      order by cp.start_time nulls last, cp.stop_order, cp.name
    loop
      v_any := true;
      v_days := v_days || public.days_list(p.collection_days);
      if p.start_time is not null and (v_start is null or p.start_time < v_start) then
        v_start := p.start_time; v_point := p.collection_point_id;
      end if;
      if p.end_time is not null and (v_end is null or p.end_time > v_end) then
        v_end := p.end_time;
      end if;
    end loop;
    continue when not v_any;   -- zone not served by a stop: leave it as the admin set it
    v_days := public.days_list(array_to_string(v_days, ','));

    update route set collection_days = nullif(array_to_string(v_days, ','), ''), start_time = v_start, end_time = v_end
     where route_id = z.route_id;

    foreach d in array public.week_days() loop
      select min(collection_schedule_id) into v_existing from collection_schedule
       where schedule_type = 'fixed' and route_id = z.route_id and day_of_week = d;
      if d = any (v_days) then
        if v_existing is not null then
          update collection_schedule set schedule_status = 'Active', start_time = v_start, end_time = v_end, collection_point_id = v_point
           where collection_schedule_id = v_existing;
        else
          insert into collection_schedule (waste_category_id, day_of_week, schedule_status, barangay_admin_id, garbage_collector_id,
                                           route_id, start_time, end_time, schedule_type, collection_point_id, effective_from)
          values (null, d, 'Active', z.barangay_admin_id, v_crew, z.route_id, v_start, v_end, 'fixed', v_point, public.ph_today());
        end if;
      elsif v_existing is not null then
        update collection_schedule set schedule_status = 'Inactive' where collection_schedule_id = v_existing;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.fs_sync() from public, anon, authenticated;

/** Website: Collection schedule -> Truck stops -> Edit. Barangay Admin only. */
create or replace function public.update_collection_point(
  p_id integer, p_days text[], p_start text, p_end text, p_standby integer,
  p_landmark text, p_lat numeric, p_lng numeric, p_confirmed boolean,
  p_set_maps boolean default false, p_maps_url text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cp record;
  errs text[] := '{}';
  v_days text[];
  v_start time := public.parse_hhmm(p_start);
  v_end time := public.parse_hhmm(p_end);
  v_source text;
  v_url text := nullif(btrim(coalesce(p_maps_url, '')), '');
begin
  if not public.is_barangay() then
    raise exception 'Only the Barangay Admin can change the collection schedule.';
  end if;
  select * into cp from collection_point where collection_point_id = p_id;
  if not found then
    raise exception 'That truck stop does not exist.';
  end if;
  v_days := public.days_list(array_to_string(coalesce(p_days, '{}'), ','));
  if 'Sunday' = any (v_days) then errs := array_append(errs, 'There is no collection on Sunday.'); end if;
  if v_start is null or v_end is null then
    errs := array_append(errs, 'Enter the start and end time of the stop.');
  elsif v_end <= v_start then
    errs := array_append(errs, 'The end time must be later than the start time.');
  end if;
  if p_standby is not null and (p_standby < 5 or p_standby > 240) then
    errs := array_append(errs, 'Standby time should be between 5 and 240 minutes.');
  end if;
  if (p_lat is null) <> (p_lng is null) or (p_lat is not null and (abs(p_lat - 8.229) > 0.05 or abs(p_lng - 124.236) > 0.05)) then
    errs := array_append(errs, 'The location must be latitude and longitude in Iligan City (latitude first, e.g. 8.2275, 124.2383).');
  end if;
  if p_set_maps and v_url is not null and (
       length(v_url) > 1000
       or v_url !~* '^https://((www\.)?google\.com(\.ph)?/maps|maps\.google\.com/|maps\.app\.goo\.gl/|goo\.gl/maps)'
       or v_url ~ '[\s<>"]') then
    errs := array_append(errs, 'The Google Maps link must be a link copied from Google Maps (google.com/maps or maps.app.goo.gl).');
  end if;
  perform public.raise_errors(errs);

  v_source := cp.location_source;
  if p_lat is not null and (cp.latitude is null or abs(p_lat - cp.latitude) > 1e-7 or abs(p_lng - cp.longitude) > 1e-7) then
    v_source := 'Set by Barangay Admin on ' || to_char(public.ph_today(), 'Mon FMDD, YYYY');
  end if;

  update collection_point set
    landmark = left(btrim(coalesce(p_landmark, '')), 160),
    latitude = p_lat, longitude = p_lng, location_source = v_source,
    location_confirmed = coalesce(p_confirmed, false),
    collection_days = nullif(array_to_string(v_days, ','), ''),
    start_time = v_start, end_time = v_end, standby_minutes = p_standby,
    maps_url = case when p_set_maps then v_url else maps_url end,
    updated_at = now()
  where collection_point_id = p_id;
  perform public.fs_sync();
end $$;
revoke all on function public.update_collection_point(integer, text[], text, text, integer, text, numeric, numeric, boolean, boolean, text) from public, anon;
grant execute on function public.update_collection_point(integer, text[], text, text, integer, text, numeric, numeric, boolean, boolean, text) to authenticated;

/** Website: Collection schedule -> Truck crew. One collector gets every fixed-schedule stop. */
create or replace function public.set_fixed_crew(p_collector integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_barangay() then
    raise exception 'Only the Barangay Admin can assign the truck crew.';
  end if;
  if p_collector is not null and not exists (select 1 from garbage_collector where garbage_collector_id = p_collector) then
    raise exception 'Choose a valid collector.';
  end if;
  update collection_schedule set garbage_collector_id = p_collector where schedule_type = 'fixed';
end $$;
revoke all on function public.set_fixed_crew(integer) from public, anon;
grant execute on function public.set_fixed_crew(integer) to authenticated;

/** Is a zone's schedule controlled by the truck stops (or is it the drop-off zone)? */
create or replace function public.zone_schedule_locked(p_route integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from route where route_id = p_route and collection_mode = 'drop_off')
      or exists (select 1 from collection_point_zone where route_id = p_route)
$$;

/**
 * Website: Zones & routes -> Edit route. Barangay Admin only.
 * p_path: [{"latitude":..,"longitude":..}, ...] or null to clear.
 * Days and times are ignored for zones served by truck stops (they follow the stops).
 * Returns warnings (the change is saved).
 */
create or replace function public.update_zone_route(
  p_route_id integer, p_path jsonb, p_days text[] default null, p_start text default null, p_end text default null)
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  z record;
  errs text[] := '{}';
  warns text[] := '{}';
  v_days text[];
  v_start time;
  v_end time;
  v_path jsonb := '[]'::jsonb;
  pt jsonb;
  n integer := 0;
  lat numeric;
  lng numeric;
  r record;
begin
  if not public.is_barangay() then
    raise exception 'Only the Barangay Admin can edit zone routes.';
  end if;
  select * into z from route where route_id = p_route_id;
  if not found then
    raise exception 'That zone does not exist. Zones cannot be added from the web.';
  end if;

  if public.zone_schedule_locked(p_route_id) then
    v_days := public.days_list(z.collection_days); v_start := z.start_time; v_end := z.end_time;
  else
    v_days := public.days_list(array_to_string(coalesce(p_days, '{}'), ','));
    v_start := public.parse_hhmm(p_start); v_end := public.parse_hhmm(p_end);
    if 'Sunday' = any (v_days) then errs := array_append(errs, 'Sunday is not a collection day in Poblacion.'); end if;
    if (nullif(btrim(coalesce(p_start, '')), '') is not null and v_start is null)
       or (nullif(btrim(coalesce(p_end, '')), '') is not null and v_end is null)
       or ((v_start is null) <> (v_end is null)) then
      errs := array_append(errs, 'Enter both a start and an end time, or leave both blank.');
    elsif v_start is not null and v_end <= v_start then
      errs := array_append(errs, 'The end time must be later than the start time.');
    end if;
  end if;

  if p_path is not null and jsonb_typeof(p_path) = 'array' then
    for pt in select * from jsonb_array_elements(p_path) loop
      n := n + 1;
      begin
        lat := (pt ->> 'latitude')::numeric; lng := (pt ->> 'longitude')::numeric;
      exception when others then lat := null; lng := null;
      end;
      if lat is null or lng is null then
        errs := array_append(errs, ('Route point ' || n || ' is not in "latitude,longitude" form.'));
      elsif abs(lat - 8.229) > 0.05 or abs(lng - 124.236) > 0.05 then
        errs := array_append(errs, ('Route point ' || n || ' (' || lat || ', ' || lng || ') is not in Iligan City. Check that latitude comes first.'));
      else
        v_path := v_path || jsonb_build_object('latitude', round(lat, 6), 'longitude', round(lng, 6));
      end if;
    end loop;
    if n = 1 and coalesce(array_length(errs, 1), 0) = 0 then errs := array_append(errs, 'A route needs at least two points.'); end if;
    if n > 500 then errs := array_append(errs, 'A route can have at most 500 points.'); end if;
  elsif p_path is not null and jsonb_typeof(p_path) <> 'null' then
    errs := array_append(errs, 'The route path is not valid.');
  end if;
  perform public.raise_errors(errs);

  for r in select day_of_week, count(*) c from collection_schedule
           where route_id = p_route_id and schedule_status = 'Active' group by day_of_week loop
    if not (r.day_of_week = any (v_days)) then
      warns := array_append(warns, (r.c || ' active schedule(s) on ' || r.day_of_week || ' no longer match this zone''s days. Review them under Collection schedule.')::text);
    end if;
  end loop;

  update route set
    path_coordinates = case when jsonb_array_length(v_path) > 0 then v_path::text end,
    collection_days = nullif(array_to_string(v_days, ','), ''),
    start_time = v_start, end_time = v_end
  where route_id = p_route_id;

  -- The mobile apps read the window from the schedule rows, so keep them in step.
  if v_start is not null then
    update collection_schedule set start_time = v_start, end_time = v_end where route_id = p_route_id;
  end if;
  return warns;
end $$;
revoke all on function public.update_zone_route(integer, jsonb, text[], text, text) from public, anon;
grant execute on function public.update_zone_route(integer, jsonb, text[], text, text) to authenticated;

-- ---------- Emergency collections ----------
create or replace function public.guard_emergency() returns trigger
language plpgsql as $$
declare
  errs text[] := '{}';
begin
  new.location_text := left(btrim(coalesce(new.location_text, '')), 255);
  new.reason := left(btrim(coalesce(new.reason, '')), 255);
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  -- Closed (Completed or Cancelled) emergency collections are locked for the Barangay Admin (22 Oct 2026).
  -- The collector app keeps its "Undo: not completed yet" (collectors are not barangay admins).
  if tg_op = 'UPDATE' and old.status in ('Completed', 'Cancelled') and public.api_request() and public.is_barangay() then
    raise exception 'Emergency collection #% is % and can no longer be changed.', old.emergency_collection_id, lower(old.status);
  end if;
  if public.api_request() then
    if tg_op = 'INSERT' then
      new.created_by := public.my_barangay_id();
      new.status := 'Scheduled';
      new.created_at := now();
      new.completed_at := null;
      if new.collection_date < public.ph_today() then
        errs := array_append(errs, 'An emergency collection cannot be scheduled in the past.');
      end if;
    else
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
  end if;
  if new.collection_date is null then errs := array_append(errs, 'Choose the collection date.'); end if;
  if new.start_time is null then errs := array_append(errs, 'Enter the start time.'); end if;
  if new.end_time is not null and new.start_time is not null and new.end_time <= new.start_time then
    errs := array_append(errs, 'The end time must be later than the start time, or left blank.');
  end if;
  if new.location_text = '' then errs := array_append(errs, 'Describe where the truck should go (street, landmark or household).'); end if;
  if new.reason = '' then errs := array_append(errs, 'Give the reason for the emergency collection.'); end if;
  if (new.latitude is null) <> (new.longitude is null)
     or (new.latitude is not null and (abs(new.latitude - 8.229) > 0.05 or abs(new.longitude - 124.236) > 0.05)) then
    errs := array_append(errs, 'Map location must be latitude and longitude in Iligan City, or left blank.');
  end if;
  if new.garbage_collector_id is not null and not exists (select 1 from public.garbage_collector where garbage_collector_id = new.garbage_collector_id) then
    errs := array_append(errs, 'Choose a valid collector.');
  end if;
  perform public.raise_errors(errs);

  -- The collector's truck is recorded with the pickup.
  if tg_op = 'INSERT' or new.garbage_collector_id is distinct from old.garbage_collector_id then
    new.truck_id := (select truck_id from public.garbage_collector where garbage_collector_id = new.garbage_collector_id);
  end if;
  if new.status = 'Completed' then
    -- Website: first time it is marked Completed. Data imports keep their own time.
    new.completed_at := case when public.api_request()
                             then coalesce(case when tg_op = 'UPDATE' then old.completed_at end, now())
                             else coalesce(new.completed_at, now()) end;
  else
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_emergency on public.emergency_collection;
create trigger guard_emergency before insert or update on public.emergency_collection
  for each row execute function public.guard_emergency();

-- ---------- Small guards ----------
-- Announcements keep their author and date.
create or replace function public.guard_announcement() returns trigger
language plpgsql as $$
begin
  new.title := btrim(new.title);
  new.content := btrim(new.content);
  if new.title = '' or new.content = '' then
    raise exception 'Enter a title and a message.';
  end if;
  if tg_op = 'UPDATE' and public.api_request() then
    new.barangay_admin_id := old.barangay_admin_id;
    new.lgu_admin_id := old.lgu_admin_id;
    new.published_timestamp := old.published_timestamp;
  elsif tg_op = 'INSERT' and public.api_request() then
    new.published_timestamp := now();
  end if;
  return new;
end $$;
drop trigger if exists guard_announcement on public.announcement;
create trigger guard_announcement before insert or update on public.announcement
  for each row execute function public.guard_announcement();

create or replace function public.guard_names() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'waste_category' then
    new.category_name := btrim(new.category_name);
    if new.category_name = '' then raise exception 'Enter a category name.'; end if;
  elsif tg_table_name = 'truck' then
    new.plate_number := upper(btrim(new.plate_number));
    if new.plate_number = '' then raise exception 'Enter the plate number.'; end if;
    if new.max_capacity_kg is not null and new.max_capacity_kg <= 0 then raise exception 'Maximum load must be more than 0 kg.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_names on public.waste_category;
create trigger guard_names before insert or update on public.waste_category for each row execute function public.guard_names();
drop trigger if exists guard_names on public.truck;
create trigger guard_names before insert or update on public.truck for each row execute function public.guard_names();

-- ---------- Fleet: latest GPS position per collector (admins only) ----------
-- heading: direction of travel in degrees (0 = north), from the last earlier reading at least 8 m away
-- within 10 minutes; null when the truck has not moved.
drop function if exists public.admin_latest_locations();
create or replace function public.admin_latest_locations()
returns table (garbage_collector_id integer, latitude double precision, longitude double precision,
               ping_at timestamptz, minutes_ago integer, heading double precision)
language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (lh.garbage_collector_id) lh.*
      from location_history lh
     where public.is_admin()
     order by lh.garbage_collector_id, lh.location_history_id desc)
  select l.garbage_collector_id, l.latitude::double precision, l.longitude::double precision, l."timestamp",
         greatest(0, floor(extract(epoch from (now() - l."timestamp")) / 60))::integer,
         case when p.latitude is not null then
           (degrees(atan2(sin(radians(l.longitude - p.longitude)) * cos(radians(l.latitude)),
                          cos(radians(p.latitude)) * sin(radians(l.latitude))
                          - sin(radians(p.latitude)) * cos(radians(l.latitude)) * cos(radians(l.longitude - p.longitude)))) + 360)::numeric % 360
         end::double precision
    from latest l
    left join lateral (
      select h.latitude, h.longitude from location_history h
       where h.garbage_collector_id = l.garbage_collector_id and h.location_history_id < l.location_history_id
         and h."timestamp" > l."timestamp" - interval '10 minutes'
         and sqrt(power((l.latitude - h.latitude) * 110540, 2)
                  + power((l.longitude - h.longitude) * 111320 * cos(radians(l.latitude)), 2)) >= 8
       order by h.location_history_id desc limit 1) p on true
$$;
revoke all on function public.admin_latest_locations() from public, anon;
grant execute on function public.admin_latest_locations() to authenticated;

-- ---------- Collector app ----------
/** A collector's active schedule rows for a date, with that date's pickup time if done. */
create or replace function public.collector_schedules(p_collector integer, p_date date)
returns table (schedule_id int, route_id int, zone_name text, zone_no int, schedule_type text,
               start_time time, end_time time, category text, done_at timestamptz)
language sql stable security definer set search_path = public as $$
  select cs.collection_schedule_id, cs.route_id, r.zone_name::text, nullif(regexp_replace(r.zone_name, '\D', '', 'g'), '')::int,
         cs.schedule_type::text, coalesce(cs.start_time, r.start_time), coalesce(cs.end_time, r.end_time),
         coalesce(wc.category_name, 'Garbage')::text,
         (select pl.completed_at from pickup_log pl where pl.collection_schedule_id = cs.collection_schedule_id and pl.pickup_date = p_date)
    from collection_schedule cs
    join route r on r.route_id = cs.route_id
    left join waste_category wc on wc.waste_category_id = cs.waste_category_id
   where cs.garbage_collector_id = p_collector and cs.schedule_status = 'Active'
     and cs.day_of_week = trim(to_char(p_date, 'FMDay'))
     and (cs.effective_from is null or cs.effective_from <= p_date)
$$;
revoke all on function public.collector_schedules(integer, date) from public, anon, authenticated;

/** A time sent by the phone (an action saved while offline): kept within the last 24 hours, never in the future. */
create or replace function public.client_time(p_at timestamptz) returns timestamptz
language sql stable as $$ select least(now(), greatest(coalesce(p_at, now()), now() - interval '24 hours')) $$;

/** Reasons a collector can give for "Couldn't collect" (also the field report type). */
create or replace function public.missed_reasons() returns text[]
language sql immutable as $$ select array['Blocked road', 'Truck breakdown', 'Truck full', 'Residents not ready', 'Other'] $$;

/** The signed-in collector's work for today (server clock): truck stops, other pickups, emergencies, shift. */
create or replace function public.collector_day() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me integer := public.my_collector_id();
  d date := public.ph_today();
  t time := public.ph_now()::time;
  dn text := trim(to_char(public.ph_today(), 'FMDay'));
  v_stops jsonb; v_other jsonb; v_em jsonb; v_me jsonb; v_shift jsonb;
begin
  if me is null then raise exception 'This login is not a garbage collector account.'; end if;

  select jsonb_build_object('id', gc.garbage_collector_id, 'first_name', gc.first_name, 'last_name', gc.last_name,
                            'truck', t2.plate_number, 'zone', r.zone_name)
    into v_me
    from garbage_collector gc left join truck t2 on t2.truck_id = gc.truck_id left join route r on r.route_id = gc.route_id
   where gc.garbage_collector_id = me;

  -- Truck stops on today's days that serve one of my zones
  select coalesce(jsonb_agg(x order by x->>'start', (x->>'order')::int, x->>'name'), '[]') into v_stops from (
    select jsonb_build_object(
      'id', cp.collection_point_id, 'name', cp.name, 'landmark', cp.landmark,
      'lat', cp.latitude, 'lng', cp.longitude, 'maps_url', cp.maps_url, 'confirmed', cp.location_confirmed,
      'start', to_char(cp.start_time, 'HH24:MI:SS'), 'end', to_char(cp.end_time, 'HH24:MI:SS'),
      'standby', cp.standby_minutes, 'order', cp.stop_order,
      'done_at', case when sv.outcome = 'done' then sv.completed_at end,
      'missed_at', case when sv.outcome = 'missed' then sv.completed_at end,
      'missed_reason', sv.missed_reason, 'note', sv.note, 'load', sv.load_level,
      'state', case when sv.outcome = 'done' then 'done'
                    when sv.outcome = 'missed' then 'missed'
                    when cp.end_time is not null and t > cp.end_time then 'late'
                    when cp.start_time is not null and t >= cp.start_time then 'now'
                    else 'upcoming' end,
      'zones', (select coalesce(jsonb_agg(jsonb_build_object('route_id', m.route_id, 'name', m.zone_name, 'done', m.done_at is not null)
                                          order by m.zone_no nulls last), '[]')
                  from collection_point_zone cpz join public.collector_schedules(me, d) m on m.route_id = cpz.route_id and m.schedule_type = 'fixed'
                 where cpz.collection_point_id = cp.collection_point_id)) as x
    from collection_point cp
    left join stop_visit sv on sv.collection_point_id = cp.collection_point_id and sv.visit_date = d
   where cp.is_active and dn = any (public.days_list(cp.collection_days))
     and exists (select 1 from collection_point_zone cpz join public.collector_schedules(me, d) m on m.route_id = cpz.route_id and m.schedule_type = 'fixed'
                  where cpz.collection_point_id = cp.collection_point_id)
  ) s;

  -- My pickups today that no truck stop covers (older custom schedules)
  select coalesce(jsonb_agg(jsonb_build_object('schedule_id', m.schedule_id, 'zone', m.zone_name, 'category', m.category,
                                               'start', to_char(m.start_time, 'HH24:MI:SS'), 'end', to_char(m.end_time, 'HH24:MI:SS'),
                                               'done_at', m.done_at) order by m.start_time nulls last, m.zone_no), '[]')
    into v_other
    from public.collector_schedules(me, d) m
   where m.schedule_type <> 'fixed'
      or not exists (select 1 from collection_point_zone cpz join collection_point cp on cp.collection_point_id = cpz.collection_point_id
                      where cpz.route_id = m.route_id and cp.is_active and dn = any (public.days_list(cp.collection_days)));

  -- My emergency collections: today, plus earlier ones not finished yet
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.emergency_collection_id, 'date', e.collection_date, 'start', to_char(e.start_time, 'HH24:MI:SS'),
           'end', to_char(e.end_time, 'HH24:MI:SS'), 'location', e.location_text, 'reason', e.reason, 'notes', e.notes,
           'lat', e.latitude, 'lng', e.longitude, 'zone', r.zone_name, 'status', e.status,
           'overdue', e.status in ('Scheduled', 'In progress') and (e.collection_date < d or (e.end_time is not null and e.collection_date = d and t > e.end_time)))
         order by e.collection_date, e.start_time), '[]')
    into v_em
    from emergency_collection e left join route r on r.route_id = e.route_id
   where e.garbage_collector_id = me
     and (e.collection_date = d or (e.collection_date < d and e.status in ('Scheduled', 'In progress')));

  -- My open shift, if any
  select jsonb_build_object('id', s.shift_id, 'started_at', s.started_at) into v_shift
    from collector_shift s where s.garbage_collector_id = me and s.ended_at is null;

  return jsonb_build_object('date', d, 'day', dn, 'time', to_char(t, 'HH24:MI:SS'), 'me', v_me,
                            'stops', v_stops, 'other', v_other, 'emergencies', v_em, 'shift', v_shift,
                            'missed_reasons', to_jsonb(public.missed_reasons()));
end $$;
revoke all on function public.collector_day() from public, anon;
grant execute on function public.collector_day() to authenticated;

/**
 * Collector app, one truck stop:
 *   'done'   "Done at this stop" (optional truck load level 1-4: about 1/4, 1/2, 3/4, full)
 *   'missed' "Couldn't collect" with a reason; also sends a field report to the Barangay Admin
 *   'undo'   back to not done (a field report nobody has looked at yet is withdrawn)
 * p_at: when it was tapped, for actions saved on the phone while offline (server clock otherwise).
 * A zone's pickup is logged once every stop serving it that day is done; anything else removes it.
 * Everything happens in one transaction, so it can never be half-saved.
 */
create or replace function public.collector_stop_action(
  p_point integer, p_action text, p_at timestamptz default null,
  p_load integer default null, p_reason text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me integer := public.my_collector_id();
  v_at timestamptz := public.client_time(p_at);
  d date := (public.client_time(p_at) at time zone 'Asia/Manila')::date;
  dn text := trim(to_char((public.client_time(p_at) at time zone 'Asia/Manila')::date, 'FMDay'));
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  cp record;
  old_visit record;
  v_report integer;
  z record;
begin
  if me is null then raise exception 'This login is not a garbage collector account.'; end if;
  if not public.on_shift(me) then raise exception 'Start your shift first.'; end if;
  if p_action not in ('done', 'missed', 'undo') then raise exception 'Unknown stop action.'; end if;
  select * into cp from collection_point where collection_point_id = p_point and is_active
     and dn = any (public.days_list(collection_days));
  if not found then
    raise exception 'This truck stop is not on the schedule for %.', dn;
  end if;
  if not exists (select 1 from collection_point_zone cpz join collection_schedule cs on cs.route_id = cpz.route_id
                  where cpz.collection_point_id = p_point and cs.garbage_collector_id = me and cs.schedule_type = 'fixed'
                    and cs.schedule_status = 'Active' and cs.day_of_week = dn) then
    raise exception 'This truck stop is not assigned to you. Ask your Barangay Admin to set you as the truck crew.';
  end if;
  if p_action = 'done' and p_load is not null and p_load not between 1 and 4 then
    raise exception 'Choose how full the truck is: 1/4, 1/2, 3/4 or full.';
  end if;
  if p_action = 'missed' then
    if p_reason is null or not (p_reason = any (public.missed_reasons())) then
      raise exception 'Choose why the stop could not be collected.';
    end if;
    if p_reason = 'Other' and v_note is null then
      raise exception 'Write a short note on why the stop could not be collected.';
    end if;
  end if;

  select * into old_visit from stop_visit where collection_point_id = p_point and visit_date = d for update;
  -- A field report sent with an earlier "Couldn't collect" is withdrawn if nobody has looked at it yet.
  if found and old_visit.field_report_id is not null then
    delete from field_report where field_report_id = old_visit.field_report_id and status = 'Open';
  end if;

  if p_action = 'undo' then
    delete from stop_visit where collection_point_id = p_point and visit_date = d;
  elsif p_action = 'done' then
    insert into stop_visit (collection_point_id, garbage_collector_id, visit_date, completed_at, outcome, load_level)
    values (p_point, me, d, v_at, 'done', p_load)
    on conflict (collection_point_id, visit_date) do update
      set outcome = 'done', garbage_collector_id = me, load_level = coalesce(excluded.load_level, case when stop_visit.outcome = 'done' then stop_visit.load_level end),
          completed_at = case when stop_visit.outcome = 'done' then stop_visit.completed_at else excluded.completed_at end,
          missed_reason = null, note = null, field_report_id = null;
  else
    insert into field_report (garbage_collector_id, report_type, description, collection_point_id, route_id, latitude, longitude, status, created_at)
    values (me, p_reason, 'Couldn''t collect at ' || cp.name || coalesce(': ' || v_note, '.'), p_point, cp.route_id,
            cp.latitude, cp.longitude, 'Open', v_at)
    returning field_report_id into v_report;
    insert into stop_visit (collection_point_id, garbage_collector_id, visit_date, completed_at, outcome, missed_reason, note, load_level, field_report_id)
    values (p_point, me, d, v_at, 'missed', p_reason, v_note, null, v_report)
    on conflict (collection_point_id, visit_date) do update
      set outcome = 'missed', garbage_collector_id = me, completed_at = excluded.completed_at, missed_reason = excluded.missed_reason,
          note = excluded.note, load_level = null, field_report_id = excluded.field_report_id;
  end if;

  -- Re-check each zone this stop serves
  for z in
    select cs.collection_schedule_id as sid, cs.route_id,
           not exists (select 1 from collection_point_zone c2 join collection_point p2 on p2.collection_point_id = c2.collection_point_id
                        where c2.route_id = cs.route_id and p2.is_active and dn = any (public.days_list(p2.collection_days))
                          and not exists (select 1 from stop_visit v where v.collection_point_id = p2.collection_point_id
                                             and v.visit_date = d and v.outcome = 'done')
                      ) as all_done,
           (select max(v.completed_at) from collection_point_zone c3 join stop_visit v on v.collection_point_id = c3.collection_point_id
             where c3.route_id = cs.route_id and v.visit_date = d and v.outcome = 'done') as last_done
      from collection_point_zone cpz
      join collection_schedule cs on cs.route_id = cpz.route_id
     where cpz.collection_point_id = p_point and cs.garbage_collector_id = me and cs.schedule_type = 'fixed'
       and cs.schedule_status = 'Active' and cs.day_of_week = dn
  loop
    if z.all_done then
      insert into pickup_log (collection_schedule_id, garbage_collector_id, pickup_date, completed_at)
      values (z.sid, me, d, coalesce(z.last_done, v_at)) on conflict (collection_schedule_id, pickup_date) do nothing;
    else
      delete from pickup_log where collection_schedule_id = z.sid and pickup_date = d;
    end if;
  end loop;
  return public.collector_day();
end $$;
revoke all on function public.collector_stop_action(integer, text, timestamptz, integer, text, text) from public, anon;
grant execute on function public.collector_stop_action(integer, text, timestamptz, integer, text, text) to authenticated;

/** Older app versions: "Done at this stop" (true) or "Undo" (false). */
create or replace function public.collector_complete_stop(p_point integer, p_done boolean default true) returns jsonb
language sql security definer set search_path = public as $$
  select public.collector_stop_action(p_point, case when p_done then 'done' else 'undo' end)
$$;
revoke all on function public.collector_complete_stop(integer, boolean) from public, anon;
grant execute on function public.collector_complete_stop(integer, boolean) to authenticated;

/** Collector app: mark one of my emergency collections In progress or Completed (or back). p_at: offline tap time. */
drop function if exists public.collector_set_emergency(integer, text);
create or replace function public.collector_set_emergency(p_id integer, p_status text, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me integer := public.my_collector_id();
begin
  if me is null then raise exception 'This login is not a garbage collector account.'; end if;
  if p_status not in ('Scheduled', 'In progress', 'Completed') then raise exception 'Choose In progress or Completed.'; end if;
  if not public.on_shift(me) then raise exception 'Start your shift first.'; end if;
  update emergency_collection
     set status = p_status,
         completed_at = case when p_status = 'Completed' then coalesce(case when status = 'Completed' then completed_at end, public.client_time(p_at)) end
   where emergency_collection_id = p_id and garbage_collector_id = me and status <> 'Cancelled';
  if not found then raise exception 'That emergency collection is not assigned to you, or it was cancelled.'; end if;
  return public.collector_day();
end $$;
revoke all on function public.collector_set_emergency(integer, text, timestamptz) from public, anon;
grant execute on function public.collector_set_emergency(integer, text, timestamptz) to authenticated;

/** Field reports: the collector writes type, text, place; the Barangay Admin only changes the status. */
create or replace function public.guard_field_report() returns trigger
language plpgsql as $$
begin
  new.description := nullif(left(btrim(coalesce(new.description, '')), 1000), '');
  if tg_op = 'INSERT' then
    if public.api_request() then
      new.status := 'Open'; new.created_at := public.client_time(new.created_at); new.handled_by := null; new.resolved_at := null;
      if not public.on_shift(new.garbage_collector_id) then raise exception 'Start your shift first.'; end if;
    end if;
    if new.route_id is null and new.collection_point_id is not null then
      new.route_id := (select route_id from collection_point where collection_point_id = new.collection_point_id);
    end if;
    if (new.latitude is null) <> (new.longitude is null)
       or (new.latitude is not null and (abs(new.latitude - 8.229) > 0.05 or abs(new.longitude - 124.236) > 0.05)) then
      new.latitude := null; new.longitude := null;     -- a GPS fix outside Iligan is not useful; keep the report
    end if;
  else
    if public.api_request() and (new.garbage_collector_id is distinct from old.garbage_collector_id
        or new.report_type is distinct from old.report_type or new.description is distinct from old.description
        or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude
        or new.created_at is distinct from old.created_at or new.collection_point_id is distinct from old.collection_point_id) then
      raise exception 'Only the status of a field report can be changed.';
    end if;
    if new.status is distinct from old.status then
      new.handled_by := coalesce(public.my_barangay_id(), old.handled_by);
      new.resolved_at := case when new.status = 'Resolved' then now() end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_field_report on public.field_report;
create trigger guard_field_report before insert or update on public.field_report for each row execute function public.guard_field_report();

-- ---------- Shifts ----------
/** Collector app: "Start shift". A shift left open on an earlier day is closed at its last GPS reading. */
create or replace function public.collector_start_shift(p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me integer := public.my_collector_id();
  v_at timestamptz := public.client_time(p_at);
  s record;
begin
  if me is null then raise exception 'This login is not a garbage collector account.'; end if;
  select * into s from collector_shift where garbage_collector_id = me and ended_at is null for update;
  if found then
    if (s.started_at at time zone 'Asia/Manila')::date = (v_at at time zone 'Asia/Manila')::date then
      return public.collector_day();          -- already on shift today
    end if;
    update collector_shift set auto_ended = true,
           ended_at = greatest(s.started_at, coalesce((select max(lh."timestamp") from location_history lh
                                                         where lh.garbage_collector_id = me and lh."timestamp" >= s.started_at
                                                           and lh."timestamp" < s.started_at + interval '18 hours'), s.started_at))
     where shift_id = s.shift_id;
  end if;
  insert into collector_shift (garbage_collector_id, truck_id, started_at)
  values (me, (select truck_id from garbage_collector where garbage_collector_id = me), v_at);
  return public.collector_day();
end $$;
revoke all on function public.collector_start_shift(timestamptz) from public, anon;
grant execute on function public.collector_start_shift(timestamptz) to authenticated;

/** Collector app: "End shift". */
create or replace function public.collector_end_shift(p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me integer := public.my_collector_id();
begin
  if me is null then raise exception 'This login is not a garbage collector account.'; end if;
  update collector_shift set ended_at = greatest(started_at, public.client_time(p_at))
   where garbage_collector_id = me and ended_at is null;
  return public.collector_day();
end $$;
revoke all on function public.collector_end_shift(timestamptz) from public, anon;
grant execute on function public.collector_end_shift(timestamptz) to authenticated;

/**
 * Website Reports: shifts that started in a date range (Philippine dates). A shift still open from an
 * earlier day counts until its last GPS reading (marked not_ended); today's open shift counts until now.
 */
create or replace function public.admin_shifts(p_from date, p_to date)
returns table (shift_id int, collector_id int, collector text, truck text, shift_date date,
               started_at timestamptz, ended_at timestamptz, hours numeric, status text)
language sql stable security definer set search_path = public as $$
  select s.shift_id, s.garbage_collector_id,
         coalesce(nullif(btrim(coalesce(gc.first_name, '') || ' ' || coalesce(gc.last_name, '')), ''), 'Deleted collector'),
         t.plate_number, (s.started_at at time zone 'Asia/Manila')::date, s.started_at, e.end_at,
         round(extract(epoch from (e.end_at - s.started_at)) / 3600.0, 2),
         case when s.ended_at is not null and s.auto_ended then 'not_ended'
              when s.ended_at is not null then 'ended'
              when (s.started_at at time zone 'Asia/Manila')::date = public.ph_today() then 'open'
              else 'not_ended' end
    from collector_shift s
    left join garbage_collector gc on gc.garbage_collector_id = s.garbage_collector_id
    left join truck t on t.truck_id = s.truck_id
    cross join lateral (select coalesce(s.ended_at,
        case when (s.started_at at time zone 'Asia/Manila')::date = public.ph_today() then now()
             else greatest(s.started_at, coalesce((select max(lh."timestamp") from location_history lh
                    where lh.garbage_collector_id = s.garbage_collector_id and lh."timestamp" >= s.started_at
                      and lh."timestamp" < s.started_at + interval '18 hours'), s.started_at)) end) as end_at) e
   where public.is_admin()
     and (s.started_at at time zone 'Asia/Manila')::date between p_from and p_to
   order by s.started_at
$$;
revoke all on function public.admin_shifts(date, date) from public, anon;
grant execute on function public.admin_shifts(date, date) to authenticated;

-- ---------- My history (collector app) ----------
/** The signed-in collector's last p_days days: stops, emergencies and shifts, newest day first. */
create or replace function public.collector_history(p_days integer default 14) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select public.my_collector_id() as id),
  rng as (select public.ph_today() - least(greatest(coalesce(p_days, 14), 1), 60) + 1 as f, public.ph_today() as t),
  stops as (
    select v.visit_date as d, jsonb_agg(jsonb_build_object('name', cp.name, 'outcome', v.outcome, 'at', v.completed_at,
             'reason', v.missed_reason, 'note', v.note, 'load', v.load_level,
             'start', to_char(cp.start_time, 'HH24:MI:SS'), 'end', to_char(cp.end_time, 'HH24:MI:SS'))
             order by v.completed_at) as j
      from stop_visit v join collection_point cp on cp.collection_point_id = v.collection_point_id, me, rng
     where v.garbage_collector_id = me.id and v.visit_date between rng.f and rng.t
     group by v.visit_date),
  ems as (
    select e.collection_date as d, jsonb_agg(jsonb_build_object('location', e.location_text, 'reason', e.reason, 'status', e.status,
             'at', e.completed_at, 'start', to_char(e.start_time, 'HH24:MI:SS')) order by e.start_time) as j
      from emergency_collection e, me, rng
     where e.garbage_collector_id = me.id and e.collection_date between rng.f and rng.t
     group by e.collection_date),
  sh as (
    select (s.started_at at time zone 'Asia/Manila')::date as d,
           jsonb_agg(jsonb_build_object('start', s.started_at, 'end', s.ended_at, 'auto', s.auto_ended) order by s.started_at) as j
      from collector_shift s, me, rng
     where s.garbage_collector_id = me.id and (s.started_at at time zone 'Asia/Manila')::date between rng.f and rng.t
     group by 1),
  days as (select d from stops union select d from ems union select d from sh)
  select case when (select id from me) is null then null else
    coalesce((select jsonb_agg(jsonb_build_object('date', days.d, 'day', trim(to_char(days.d, 'FMDay')),
                       'stops', coalesce(stops.j, '[]'), 'emergencies', coalesce(ems.j, '[]'), 'shifts', coalesce(sh.j, '[]'))
                       order by days.d desc)
                from days left join stops using (d) left join ems using (d) left join sh using (d)), '[]') end
$$;
revoke all on function public.collector_history(integer) from public, anon;
grant execute on function public.collector_history(integer) to authenticated;

-- ---------- Notifications ----------
/** Collector app: this phone wants notifications (Expo push token). */
create or replace function public.collector_register_push(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare me integer := public.my_collector_id();
begin
  if me is null then raise exception 'This login is not a garbage collector account.'; end if;
  if p_token is null or length(p_token) > 200 or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Not a valid notification token.';
  end if;
  insert into push_token (token, garbage_collector_id, resident_id, updated_at) values (p_token, me, null, now())
  on conflict (token) do update set garbage_collector_id = me, resident_id = null, updated_at = now();
end $$;
revoke all on function public.collector_register_push(text) from public, anon;
grant execute on function public.collector_register_push(text) to authenticated;

/** Collector app, on log out: this phone stops receiving notifications for this account. */
create or replace function public.collector_unregister_push(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from push_token where token = p_token and garbage_collector_id = public.my_collector_id()
$$;
revoke all on function public.collector_unregister_push(text) from public, anon;
grant execute on function public.collector_unregister_push(text) to authenticated;

/** Hands push messages to Expo's push service with pg_net, 100 per request. Never blocks the change that caused it. */
create or replace function public.push_send(p_msgs jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare i integer := 0; n integer := coalesce(jsonb_array_length(p_msgs), 0);
begin
  if n = 0 or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return false; end if;
  begin
    while i < n loop
      execute 'select net.http_post(url := $1, body := $2, headers := $3)'
        using 'https://exp.host/--/api/v2/push/send',
              (select jsonb_agg(m) from (select m from jsonb_array_elements(p_msgs) with ordinality as t(m, k) where k > i and k <= i + 100) x),
              '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb;
      i := i + 100;
    end loop;
    return true;
  exception when others then
    raise warning 'Push notification not sent: %', sqlerrm;
    return false;
  end;
end $$;
revoke all on function public.push_send(jsonb) from public, anon, authenticated;

/** Records a notification and hands it to Expo's push service for the collector's phones. */
create or replace function public.notify_collector(p_collector integer, p_title text, p_body text, p_data jsonb default '{}')
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_msgs jsonb;
begin
  if p_collector is null then return; end if;
  insert into notification (garbage_collector_id, title, body, data)
  values (p_collector, left(p_title, 120), left(p_body, 400), coalesce(p_data, '{}'))
  returning notification_id into v_id;
  select jsonb_agg(jsonb_build_object('to', token, 'title', left(p_title, 120), 'body', left(p_body, 400),
                                      'data', coalesce(p_data, '{}'), 'sound', 'default', 'priority', 'high', 'channelId', 'default'))
    into v_msgs from push_token where garbage_collector_id = p_collector;
  if public.push_send(v_msgs) then update notification set pushed = true where notification_id = v_id; end if;
end $$;
revoke all on function public.notify_collector(integer, text, text, jsonb) from public, anon, authenticated;

/**
 * Notifies residents: every resident with a login gets a row (their in-app inbox); phones that are
 * registered also get a push.
 */
create or replace function public.notify_residents(p_residents integer[], p_title text, p_body text, p_data jsonb default '{}')
returns integer
language plpgsql security definer set search_path = public as $$
declare v_msgs jsonb; v_n integer;
begin
  if p_residents is null or cardinality(p_residents) = 0 then return 0; end if;
  select jsonb_agg(jsonb_build_object('to', token, 'title', left(p_title, 120), 'body', left(p_body, 400),
                                      'data', coalesce(p_data, '{}'), 'sound', 'default', 'priority', 'high', 'channelId', 'default'))
    into v_msgs from push_token where resident_id = any (p_residents);
  insert into notification (resident_id, title, body, data, pushed)
  select r.resident_id, left(p_title, 120), left(p_body, 400), coalesce(p_data, '{}'),
         exists (select 1 from push_token pt where pt.resident_id = r.resident_id) and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
    from resident r where r.resident_id = any (p_residents) and r.auth_user_id is not null;
  get diagnostics v_n = row_count;
  perform public.push_send(v_msgs);
  return v_n;
end $$;
revoke all on function public.notify_residents(integer[], text, text, jsonb) from public, anon, authenticated;

/** "5:30 PM" */
create or replace function public.fmt_time(p time) returns text
language sql immutable as $$ select case when p is null then '' else ltrim(to_char(p, 'FMHH12:MI AM')) end $$;

/** Emergency pickups: the assigned collector hears about new, changed, reassigned and cancelled ones. */
create or replace function public.notify_emergency() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_when text := to_char(new.collection_date, 'FMDy, Mon FMDD') || ', ' || public.fmt_time(new.start_time);
  v_data jsonb := jsonb_build_object('kind', 'emergency', 'id', new.emergency_collection_id);
begin
  if public.my_collector_id() is not null then return null; end if;   -- the collector's own status changes
  if tg_op = 'INSERT' then
    if new.status in ('Scheduled', 'In progress') then
      perform public.notify_collector(new.garbage_collector_id, 'New emergency pickup', v_when || ' · ' || new.location_text, v_data);
    end if;
    return null;
  end if;
  if new.garbage_collector_id is distinct from old.garbage_collector_id then
    if new.status in ('Scheduled', 'In progress') then
      perform public.notify_collector(new.garbage_collector_id, 'Emergency pickup assigned to you', v_when || ' · ' || new.location_text, v_data);
    end if;
    if old.status in ('Scheduled', 'In progress') then
      perform public.notify_collector(old.garbage_collector_id, 'Emergency pickup reassigned',
        'Another collector will handle ' || old.location_text || '.', v_data);
    end if;
  elsif new.status = 'Cancelled' and old.status <> 'Cancelled' then
    perform public.notify_collector(new.garbage_collector_id, 'Emergency pickup cancelled', v_when || ' · ' || new.location_text, v_data);
  elsif new.status in ('Scheduled', 'In progress') and (new.collection_date, new.start_time, new.end_time, new.location_text)
        is distinct from (old.collection_date, old.start_time, old.end_time, old.location_text) then
    perform public.notify_collector(new.garbage_collector_id, 'Emergency pickup changed', v_when || ' · ' || new.location_text, v_data);
  end if;
  return null;
end $$;
drop trigger if exists notify_emergency on public.emergency_collection;
create trigger notify_emergency after insert or update on public.emergency_collection
  for each row execute function public.notify_emergency();

/** Truck stops: the truck crew hears when a stop's days or times change. */
create or replace function public.notify_stop_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if (new.collection_days, new.start_time, new.end_time, new.is_active)
     is not distinct from (old.collection_days, old.start_time, old.end_time, old.is_active) then
    return null;
  end if;
  for c in
    select distinct cs.garbage_collector_id as id
      from collection_point_zone cpz join collection_schedule cs on cs.route_id = cpz.route_id
     where cpz.collection_point_id = new.collection_point_id and cs.schedule_type = 'fixed'
       and cs.schedule_status = 'Active' and cs.garbage_collector_id is not null
  loop
    perform public.notify_collector(c.id, 'Truck stop changed',
      new.name || ': ' || case when not new.is_active then 'no longer on the schedule.'
        else coalesce(nullif(array_to_string(array(select left(x, 3) from unnest(public.days_list(new.collection_days)) x), ', '), ''), 'no days')
             || ', ' || public.fmt_time(new.start_time) || '–' || public.fmt_time(new.end_time) || '.' end,
      jsonb_build_object('kind', 'stop', 'id', new.collection_point_id));
  end loop;
  return null;
end $$;
drop trigger if exists notify_stop_change on public.collection_point;
create trigger notify_stop_change after update on public.collection_point
  for each row execute function public.notify_stop_change();

/** Announcements: every collector and resident with a login hears about a new one. */
create or replace function public.notify_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  for c in select garbage_collector_id as id from garbage_collector where auth_user_id is not null loop
    perform public.notify_collector(c.id, 'Announcement: ' || left(new.title, 100), left(regexp_replace(new.content, '\s+', ' ', 'g'), 300),
      jsonb_build_object('kind', 'announcement', 'id', new.announcement_id));
  end loop;
  perform public.notify_residents((select array_agg(resident_id) from resident where auth_user_id is not null),
    'Announcement: ' || left(new.title, 100), left(regexp_replace(new.content, '\s+', ' ', 'g'), 300),
    jsonb_build_object('kind', 'announcement', 'id', new.announcement_id));
  return null;
end $$;
drop trigger if exists notify_announcement on public.announcement;
create trigger notify_announcement after insert on public.announcement
  for each row execute function public.notify_announcement();

-- ---------- Resident app ----------
/** Resident app: this phone gets notifications for the signed-in resident. */
create or replace function public.resident_register_push(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare me integer := public.my_resident_id();
begin
  if me is null then raise exception 'This login is not a resident account.'; end if;
  if p_token is null or length(p_token) > 200 or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Not a valid notification token.';
  end if;
  insert into push_token (token, garbage_collector_id, resident_id, updated_at) values (p_token, null, me, now())
  on conflict (token) do update set garbage_collector_id = null, resident_id = me, updated_at = now();
end $$;
revoke all on function public.resident_register_push(text) from public, anon;
grant execute on function public.resident_register_push(text) to authenticated;

create or replace function public.resident_unregister_push(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from push_token where token = p_token and resident_id = public.my_resident_id()
$$;
revoke all on function public.resident_unregister_push(text) from public, anon;
grant execute on function public.resident_unregister_push(text) to authenticated;

/**
 * Resident app, Home: my zone, the truck stops that serve it, today's status, the next 7 days and
 * emergency pickups in my zone (no collector names). Server clock, Philippine time.
 */
create or replace function public.resident_day() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me record;
  d date := public.ph_today();
  t time := public.ph_now()::time;
  dn text := trim(to_char(public.ph_today(), 'FMDay'));
  v_zone record;
  v_stops jsonb; v_today jsonb; v_next jsonb; v_em jsonb; v_collected timestamptz; v_rated boolean;
begin
  select * into me from resident where auth_user_id = auth.uid();
  if not found then raise exception 'This login is not a resident account.'; end if;
  select route_id, zone_name, collection_mode into v_zone from route where route_id = me.route_id;

  -- Truck stops serving my zone (all days)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cp.collection_point_id, 'name', cp.name, 'landmark', cp.landmark, 'lat', cp.latitude, 'lng', cp.longitude,
           'maps_url', cp.maps_url, 'confirmed', cp.location_confirmed, 'days', to_jsonb(public.days_list(cp.collection_days)),
           'start', to_char(cp.start_time, 'HH24:MI:SS'), 'end', to_char(cp.end_time, 'HH24:MI:SS'), 'standby', cp.standby_minutes)
         order by cp.start_time, cp.stop_order), '[]')
    into v_stops
    from collection_point cp join collection_point_zone cpz on cpz.collection_point_id = cp.collection_point_id
   where cpz.route_id = me.route_id and cp.is_active;

  -- Today: each of my stops with what happened
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cp.collection_point_id,
           'state', case when sv.outcome = 'done' then 'done' when sv.outcome = 'missed' then 'missed'
                         when cp.end_time is not null and t > cp.end_time then 'late'
                         when cp.start_time is not null and t >= cp.start_time then 'now' else 'upcoming' end,
           'done_at', case when sv.outcome = 'done' then sv.completed_at end,
           'missed_reason', case when sv.outcome = 'missed' then sv.missed_reason end) order by cp.start_time), '[]')
    into v_today
    from collection_point cp join collection_point_zone cpz on cpz.collection_point_id = cp.collection_point_id
    left join stop_visit sv on sv.collection_point_id = cp.collection_point_id and sv.visit_date = d
   where cpz.route_id = me.route_id and cp.is_active and dn = any (public.days_list(cp.collection_days));

  select max(pl.completed_at) into v_collected
    from pickup_log pl join collection_schedule cs on cs.collection_schedule_id = pl.collection_schedule_id
   where cs.route_id = me.route_id and pl.pickup_date = d;

  -- The next 7 days (today included): which of my stops run that day
  select coalesce(jsonb_agg(jsonb_build_object('date', g.day, 'day', trim(to_char(g.day, 'FMDay')), 'stops', g.ids) order by g.day), '[]')
    into v_next
    from (select dd::date as day,
                 (select coalesce(jsonb_agg(cp.collection_point_id order by cp.start_time), '[]')
                    from collection_point cp join collection_point_zone cpz on cpz.collection_point_id = cp.collection_point_id
                   where cpz.route_id = me.route_id and cp.is_active
                     and trim(to_char(dd::date, 'FMDay')) = any (public.days_list(cp.collection_days))) as ids
            from generate_series(d, d + 6, interval '1 day') dd) g;

  -- Emergency pickups in my zone: today and the next 7 days (not cancelled), plus today's finished ones
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.emergency_collection_id, 'date', e.collection_date, 'start', to_char(e.start_time, 'HH24:MI:SS'),
           'end', to_char(e.end_time, 'HH24:MI:SS'), 'location', e.location_text, 'reason', e.reason,
           'lat', e.latitude, 'lng', e.longitude, 'status', e.status) order by e.collection_date, e.start_time), '[]')
    into v_em
    from emergency_collection e
   where e.route_id = me.route_id and e.status <> 'Cancelled'
     and e.collection_date between d and d + 7
     and (e.status in ('Scheduled', 'In progress') or e.collection_date = d);

  select exists (select 1 from feedback_report f where f.resident_id = me.resident_id and f.report_type = 'Pickup rating'
                  and (f.created_at at time zone 'Asia/Manila')::date = d) into v_rated;

  return jsonb_build_object(
    'date', d, 'day', dn, 'time', to_char(t, 'HH24:MI:SS'),
    'me', jsonb_build_object('id', me.resident_id, 'first_name', me.first_name, 'zone_id', me.route_id,
                             'zone', v_zone.zone_name, 'mode', coalesce(v_zone.collection_mode, 'truck')),
    'stops', v_stops, 'today', jsonb_build_object('stops', v_today, 'collected_at', v_collected),
    'next', v_next, 'emergencies', v_em, 'rated_today', v_rated);
end $$;
revoke all on function public.resident_day() from public, anon;
grant execute on function public.resident_day() to authenticated;

/** Resident app, calendar: my zone's last p_days days — expected pickups, collected, not collected, emergencies. */
create or replace function public.resident_history(p_days integer default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select resident_id, route_id from resident where auth_user_id = auth.uid()),
  days as (select dd::date as day from generate_series(public.ph_today() - least(greatest(coalesce(p_days, 30), 1), 62) + 1, public.ph_today(), interval '1 day') dd),
  info as (
    select days.day,
      exists (select 1 from collection_schedule cs, me where cs.route_id = me.route_id and cs.schedule_status = 'Active'
                 and cs.day_of_week = trim(to_char(days.day, 'FMDay')) and (cs.effective_from is null or cs.effective_from <= days.day)) as expected,
      (select max(pl.completed_at) from pickup_log pl join collection_schedule cs on cs.collection_schedule_id = pl.collection_schedule_id, me
        where cs.route_id = me.route_id and pl.pickup_date = days.day) as collected_at,
      (select string_agg(distinct sv.missed_reason, ', ') from stop_visit sv join collection_point_zone cpz on cpz.collection_point_id = sv.collection_point_id, me
        where cpz.route_id = me.route_id and sv.visit_date = days.day and sv.outcome = 'missed') as missed_reason,
      (select coalesce(jsonb_agg(jsonb_build_object('location', e.location_text, 'status', e.status, 'start', to_char(e.start_time, 'HH24:MI:SS'))), '[]')
         from emergency_collection e, me where e.route_id = me.route_id and e.collection_date = days.day and e.status <> 'Cancelled') as emergencies
    from days)
  select case when (select resident_id from me) is null then null else
    coalesce(jsonb_agg(jsonb_build_object('date', day, 'expected', expected, 'collected_at', collected_at,
                                          'missed_reason', missed_reason, 'emergencies', emergencies) order by day desc), '[]') end
    from info
$$;
revoke all on function public.resident_history(integer) from public, anon;
grant execute on function public.resident_history(integer) to authenticated;

-- ---------- Resident alerts ----------
/** "The garbage truck is near": first GPS reading within 300 m of a stop, from 1 hour before its time, once per stop per day. */
create or replace function public.alert_truck_near() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d date := public.ph_today();
  t time := public.ph_now()::time;
  dn text := trim(to_char(public.ph_today(), 'FMDay'));
  p record;
begin
  if new.latitude is null or new.garbage_collector_id is null then return null; end if;
  for p in
    select cp.* from collection_point cp
     where cp.is_active and cp.latitude is not null and dn = any (public.days_list(cp.collection_days))
       and cp.start_time is not null and t between cp.start_time - interval '60 minutes' and coalesce(cp.end_time, cp.start_time + interval '60 minutes')
       and exists (select 1 from collection_point_zone cpz join collection_schedule cs on cs.route_id = cpz.route_id
                    where cpz.collection_point_id = cp.collection_point_id and cs.schedule_type = 'fixed' and cs.schedule_status = 'Active'
                      and cs.day_of_week = dn and cs.garbage_collector_id = new.garbage_collector_id)
       and not exists (select 1 from stop_visit v where v.collection_point_id = cp.collection_point_id and v.visit_date = d)
       and sqrt(power((new.latitude - cp.latitude) * 110540, 2) + power((new.longitude - cp.longitude) * 111320 * cos(radians(cp.latitude)), 2)) <= 300
  loop
    insert into alert_sent (kind, ref_id, alert_date) values ('near', p.collection_point_id, d) on conflict do nothing;
    if found then
      perform public.notify_residents(
        (select array_agg(distinct r.resident_id) from resident r join collection_point_zone cpz on cpz.route_id = r.route_id
          where cpz.collection_point_id = p.collection_point_id and r.auth_user_id is not null),
        'The garbage truck is near',
        p.name || ': the truck stands by ' || public.fmt_time(p.start_time) || '–' || public.fmt_time(p.end_time) || '. Bring out your garbage.',
        jsonb_build_object('kind', 'truck', 'id', p.collection_point_id));
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists alert_truck_near on public.location_history;
create trigger alert_truck_near after insert on public.location_history
  for each row execute function public.alert_truck_near();

/** "Not collected today": the collector marked a stop Not collected; residents of the zones it serves are told why. */
create or replace function public.alert_not_collected() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.outcome <> 'missed' or (tg_op = 'UPDATE' and old.outcome = 'missed') or new.visit_date <> public.ph_today() then return null; end if;
  insert into alert_sent (kind, ref_id, alert_date) values ('missed', new.collection_point_id, new.visit_date) on conflict do nothing;
  if not found then return null; end if;
  select name into v_name from collection_point where collection_point_id = new.collection_point_id;
  perform public.notify_residents(
    (select array_agg(distinct r.resident_id) from resident r join collection_point_zone cpz on cpz.route_id = r.route_id
      where cpz.collection_point_id = new.collection_point_id and r.auth_user_id is not null),
    'Garbage not collected today',
    v_name || ': ' || coalesce(new.missed_reason, 'the truck could not collect') || '. The barangay has been told.',
    jsonb_build_object('kind', 'missed', 'id', new.collection_point_id));
  return null;
end $$;
drop trigger if exists alert_not_collected on public.stop_visit;
create trigger alert_not_collected after insert or update of outcome on public.stop_visit
  for each row execute function public.alert_not_collected();

/** Resident reports: keep a history of every status change / reply, and tell the resident. */
create or replace function public.log_feedback_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status and new.response is not distinct from old.response then return null; end if;
  insert into feedback_update (feedback_report_id, status, note, barangay_admin_id)
  values (new.feedback_report_id, case when new.status is distinct from old.status then new.status end,
          case when new.response is distinct from old.response then new.response end, new.handled_by);
  perform public.notify_residents(array[new.resident_id],
    case when new.response is distinct from old.response and new.response is not null then 'The barangay replied to your report'
         else 'Your report is now ' || lower(new.status) end,
    coalesce(new.report_type, 'Report') || ': ' || coalesce(case when new.response is distinct from old.response then new.response end, 'status ' || new.status) ,
    jsonb_build_object('kind', 'report', 'id', new.feedback_report_id));
  return null;
end $$;
drop trigger if exists log_feedback_change on public.feedback_report;
create trigger log_feedback_change after update on public.feedback_report
  for each row execute function public.log_feedback_change();


-- ---------- Notification inbox (both apps) ----------
/** Marks my notifications as read: the given ids, or all of them when p_ids is null. Returns how many changed. */
create or replace function public.notifications_mark_read(p_ids bigint[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare me_c integer := public.my_collector_id(); me_r integer := public.my_resident_id(); n integer;
begin
  if me_c is null and me_r is null then raise exception 'Not allowed.'; end if;
  update notification set read_at = now()
   where read_at is null and (p_ids is null or notification_id = any (p_ids))
     and ((me_c is not null and garbage_collector_id = me_c) or (me_r is not null and resident_id = me_r));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.notifications_mark_read(bigint[]) from public, anon;
grant execute on function public.notifications_mark_read(bigint[]) to authenticated;

-- ---------- Rating how the barangay handled a report ----------
/**
 * The resident rates a report the barangay resolved or closed: 1-5 stars, optional comment and proof photo
 * (in their own folder of the report-photos bucket). Once per report.
 */
create or replace function public.resident_rate_report(p_report integer, p_stars integer, p_comment text default null, p_photo text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me integer := public.my_resident_id(); r record;
begin
  if me is null then raise exception 'This login is not a resident account.'; end if;
  select * into r from feedback_report where feedback_report_id = p_report and resident_id = me for update;
  if not found then raise exception 'Report not found.'; end if;
  if r.report_type = 'Pickup rating' then raise exception 'Pickup ratings cannot be rated.'; end if;
  if r.status not in ('Resolved', 'Closed', 'Dismissed') then raise exception 'You can rate a report once the barangay has resolved or closed it.'; end if;
  if r.rating is not null then raise exception 'You already rated this report.'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars.'; end if;
  if p_photo is not null and p_photo !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'The photo could not be attached. Please try again.';
  end if;
  update feedback_report set rating = p_stars, rating_comment = nullif(left(btrim(coalesce(p_comment, '')), 1000), ''),
         rating_photo = p_photo, rated_at = now()
   where feedback_report_id = p_report;
end $$;
revoke all on function public.resident_rate_report(integer, integer, text, text) from public, anon;
grant execute on function public.resident_rate_report(integer, integer, text, text) to authenticated;

-- Tell the API about the changes.
notify pgrst, 'reload schema';

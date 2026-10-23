-- =====================================================================
-- ECollect | One-time fix for a project that was set up before 20 Oct 2026
-- Mon/Wed/Fri, one truck, 5:00-6:00 PM, split into two stops:
--   1st  Back of Kim Guan        5:00-5:30 PM, 30 min standby, Zones 5 and 6
--   2nd  Sapporo - Araneta St.   5:30-6:00 PM, 30 min standby, Zones 1 and 2
-- Safe to run more than once. Changes nothing if a stop or zone is missing.
-- Run after 01-03. (A new project set up from 04_data.sql already has this.)
-- =====================================================================
begin;

do $$
declare
  v_missing text;
begin
  select string_agg(n, ', ') into v_missing
    from unnest(array['Back of Kim Guan', 'Sapporo - Araneta St.']) n
   where not exists (select 1 from public.collection_point where name = n);
  if v_missing is not null then
    raise exception 'Truck stop not found: %. Nothing was changed.', v_missing;
  end if;
  select string_agg(z, ', ') into v_missing
    from unnest(array['Zone 1', 'Zone 2', 'Zone 5', 'Zone 6']) z
   where not exists (select 1 from public.route where btrim(zone_name) = z);
  if v_missing is not null then
    raise exception 'Zone not found: %. Nothing was changed.', v_missing;
  end if;
end $$;

-- Times, standby and order
update public.collection_point
   set collection_days = 'Monday,Wednesday,Friday', start_time = '17:00', end_time = '17:30',
       standby_minutes = 30, stop_order = 1, updated_at = now()
 where name = 'Back of Kim Guan';
update public.collection_point
   set collection_days = 'Monday,Wednesday,Friday', start_time = '17:30', end_time = '18:00',
       standby_minutes = 30, stop_order = 2, updated_at = now()
 where name = 'Sapporo - Araneta St.';

-- Which zones each stop serves
delete from public.collection_point_zone cpz
 using public.collection_point cp
 where cp.collection_point_id = cpz.collection_point_id
   and cp.name in ('Back of Kim Guan', 'Sapporo - Araneta St.');

insert into public.collection_point_zone (collection_point_id, route_id)
select cp.collection_point_id, r.route_id
  from public.collection_point cp
  join public.route r on (cp.name = 'Back of Kim Guan'      and btrim(r.zone_name) in ('Zone 5', 'Zone 6'))
                      or (cp.name = 'Sapporo - Araneta St.' and btrim(r.zone_name) in ('Zone 1', 'Zone 2'))
on conflict do nothing;

-- Main zone shown for each stop
update public.collection_point set route_id = (select route_id from public.route where btrim(zone_name) = 'Zone 5')
 where name = 'Back of Kim Guan';
update public.collection_point set route_id = (select route_id from public.route where btrim(zone_name) = 'Zone 1')
 where name = 'Sapporo - Araneta St.';

-- Rebuild each zone's days, times and fixed schedule rows from the stops
select public.fs_sync();

commit;

-- Check: Zones 5 and 6 at 17:00-17:30, Zones 1 and 2 at 17:30-18:00, Mon/Wed/Fri
select cp.name as stop, string_agg(btrim(r.zone_name), ', ' order by btrim(r.zone_name)) as zones,
       cp.collection_days, cp.start_time, cp.end_time, cp.standby_minutes
  from public.collection_point cp
  join public.collection_point_zone cpz on cpz.collection_point_id = cp.collection_point_id
  join public.route r on r.route_id = cpz.route_id
 where cp.name in ('Back of Kim Guan', 'Sapporo - Araneta St.')
 group by cp.collection_point_id, cp.name, cp.collection_days, cp.start_time, cp.end_time, cp.standby_minutes
 order by cp.start_time;

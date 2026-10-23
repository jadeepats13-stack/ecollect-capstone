-- 22 Oct 2026: a Completed or Cancelled emergency collection can no longer be edited from the website.
-- Run once in the Supabase SQL Editor (safe to run again). Same function as in 03_logic.sql.
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

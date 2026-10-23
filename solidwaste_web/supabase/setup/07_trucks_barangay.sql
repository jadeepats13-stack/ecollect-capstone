-- 22 Oct 2026: truck management moves from the LGU Admin to the Barangay Admin.
-- Run once in the Supabase SQL Editor (safe to run again). The LGU keeps read-only access; collectors still read their truck.
drop policy if exists truck_insert on public.truck;
drop policy if exists truck_update on public.truck;
drop policy if exists truck_delete on public.truck;
create policy truck_insert on public.truck for insert to authenticated with check (public.is_barangay());
create policy truck_update on public.truck for update to authenticated using (public.is_barangay()) with check (public.is_barangay());
create policy truck_delete on public.truck for delete to authenticated using (public.is_barangay());

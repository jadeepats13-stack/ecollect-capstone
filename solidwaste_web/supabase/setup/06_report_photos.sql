-- ECollect: photos residents attach to a report (Supabase Storage).
-- Run once in the Supabase SQL Editor AFTER 01_schema.sql, 02_security.sql and 03_logic.sql.
-- Safe to run again. Re-run it whenever you re-run 02_security.sql (its policies use functions from there).
--
-- Bucket "report-photos" is private: a resident uploads into a folder named after their login
-- (<auth user id>/<file>.jpg) and can view only their own photos; the Barangay and LGU Admins can view all.
-- Nobody can replace or delete a photo from the app or the website.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists report_photos_insert on storage.objects;
create policy report_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos'
              and public.my_resident_id() is not null
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists report_photos_read on storage.objects;
create policy report_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'report-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

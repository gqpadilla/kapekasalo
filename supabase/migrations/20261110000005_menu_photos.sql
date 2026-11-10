-- Menu photos uploaded from the admin menu editor live in a public Storage bucket.
-- products.img holds either a file name in img/products/ (original photos) or the full public URL of an upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "menu photos are public" on storage.objects for select using (bucket_id = 'menu');
create policy "admins upload menu photos" on storage.objects for insert to authenticated with check (bucket_id = 'menu' and public.is_admin());
create policy "admins replace menu photos" on storage.objects for update to authenticated using (bucket_id = 'menu' and public.is_admin());
create policy "admins delete menu photos" on storage.objects for delete to authenticated using (bucket_id = 'menu' and public.is_admin());

-- Private source images and sanitized published copies. Run after 001-005.
begin;

create table if not exists public.place_images (
  id uuid primary key,
  owner_id uuid not null,
  place_id text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  alt_text text not null default '' check (length(alt_text) <= 160),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint place_images_place_fkey foreign key (owner_id, place_id)
    references public.places(owner_id, id) on delete cascade,
  constraint place_images_storage_owner_check check (split_part(storage_path, '/', 1) = owner_id::text),
  constraint place_images_storage_place_check check (split_part(storage_path, '/', 2) = place_id),
  constraint place_images_storage_depth_check check (storage_path ~ '^[^/]+/[^/]+/[^/]+$')
);

create index if not exists place_images_owner_place_sort_idx
  on public.place_images(owner_id, place_id, sort_order, created_at);

alter table public.place_images enable row level security;
revoke all on table public.place_images from public, anon, authenticated;
grant select, insert, update, delete on table public.place_images to authenticated;

-- ai coding：元数据与 Storage 对象都同时校验审核状态、owner 和路径首段，匿名账号不能访问私有原图。
drop policy if exists "place_images_select_own" on public.place_images;
drop policy if exists "place_images_insert_own" on public.place_images;
drop policy if exists "place_images_update_own" on public.place_images;
drop policy if exists "place_images_delete_own" on public.place_images;
create policy "place_images_select_own" on public.place_images for select to authenticated
using ((select auth.uid()) = owner_id and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));
create policy "place_images_insert_own" on public.place_images for insert to authenticated
with check ((select auth.uid()) = owner_id and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));
create policy "place_images_update_own" on public.place_images for update to authenticated
using ((select auth.uid()) = owner_id and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()))
with check ((select auth.uid()) = owner_id and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));
create policy "place_images_delete_own" on public.place_images for delete to authenticated
using ((select auth.uid()) = owner_id and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-images', 'place-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ai coding：006 只预建默认私有的 WebP 发布 bucket，冲突时绝不覆盖 007 的最终安全配置。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('published-place-images', 'published-place-images', false, 5242880, array['image/webp'])
on conflict (id) do nothing;

drop policy if exists "private_place_images_select_own" on storage.objects;
drop policy if exists "private_place_images_insert_own" on storage.objects;
drop policy if exists "private_place_images_update_own" on storage.objects;
drop policy if exists "private_place_images_delete_own" on storage.objects;
create policy "private_place_images_select_own" on storage.objects for select to authenticated
using (bucket_id = 'place-images' and (storage.foldername(name))[1] = (select auth.uid())::text and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));
create policy "private_place_images_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'place-images' and (storage.foldername(name))[1] = (select auth.uid())::text and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));
create policy "private_place_images_update_own" on storage.objects for update to authenticated
using (bucket_id = 'place-images' and (storage.foldername(name))[1] = (select auth.uid())::text and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()))
with check (bucket_id = 'place-images' and (storage.foldername(name))[1] = (select auth.uid())::text and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));
create policy "private_place_images_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'place-images' and (storage.foldername(name))[1] = (select auth.uid())::text and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false and (select public.is_approved()));

commit;

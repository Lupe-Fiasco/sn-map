-- Hardens both image buckets after 009. Run only after 001-009; safe to rerun.
begin;

-- ai coding：Storage 的读改删必须由图片元数据确定 owner/map/place；不能再把 owner 路径首段当作授权关系。
drop policy if exists "private_place_images_select_own" on storage.objects;
drop policy if exists "private_place_images_insert_own" on storage.objects;
drop policy if exists "private_place_images_update_own" on storage.objects;
drop policy if exists "private_place_images_delete_own" on storage.objects;

create policy "private_place_images_select_own" on storage.objects for select to authenticated using (
  bucket_id = 'place-images'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
  and exists (
    select 1 from public.place_images image
    where image.owner_id = (select auth.uid()) and image.storage_path = name
      and (
        (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
          and split_part(name, '/', 1) = image.owner_id::text
          and split_part(name, '/', 2) = image.map_id
          and split_part(name, '/', 3) = image.place_id)
        or
        (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
          and image.map_id = 'suining'
          and split_part(name, '/', 1) = image.owner_id::text
          and split_part(name, '/', 2) = image.place_id)
      )
  )
);

-- 初次上传时 place_images 行尚不存在，因此 insert 通过 owner/map/place 外键来源校验合法新路径。
create policy "private_place_images_insert_own" on storage.objects for insert to authenticated with check (
  bucket_id = 'place-images'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
  and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
      and split_part(name, '/', 1) = (select auth.uid())::text
      and exists (select 1 from public.places place where place.owner_id = (select auth.uid())
        and place.map_id = split_part(name, '/', 2) and place.id = split_part(name, '/', 3)))
    or
    (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
      and split_part(name, '/', 1) = (select auth.uid())::text
      and exists (select 1 from public.places place where place.owner_id = (select auth.uid())
        and place.map_id = 'suining' and place.id = split_part(name, '/', 2)))
  )
);

create policy "private_place_images_update_own" on storage.objects for update to authenticated
using (
  bucket_id = 'place-images'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
  and exists (select 1 from public.place_images image where image.owner_id = (select auth.uid())
    and image.storage_path = name
    and ((split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id and split_part(name, '/', 3) = image.place_id
          and name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$')
      or (image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.place_id
          and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$')))
)
with check (
  bucket_id = 'place-images'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
  and exists (select 1 from public.place_images image where image.owner_id = (select auth.uid())
    and image.storage_path = name
    and ((split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id and split_part(name, '/', 3) = image.place_id
          and name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$')
      or (image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.place_id
          and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$')))
);

create policy "private_place_images_delete_own" on storage.objects for delete to authenticated using (
  bucket_id = 'place-images'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
  and (
    exists (select 1 from public.place_images image where image.owner_id = (select auth.uid())
      and image.storage_path = name
      and ((split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id
            and split_part(name, '/', 3) = image.place_id and split_part(split_part(name, '/', 4), '.', 1) = image.id::text
            and name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$')
        or (image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text
            and split_part(name, '/', 2) = image.place_id and split_part(split_part(name, '/', 3), '.', 1) = image.id::text
            and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$')))
    or (
      -- ai coding：仅 metadata 写入失败时，允许已审核本人按合法地点路径补偿删除孤儿原图；不放宽读、更新或公开桶。
      not exists (select 1 from public.place_images image where image.storage_path = name)
      and split_part(name, '/', 1) = (select auth.uid())::text
      and (
        (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
          and exists (select 1 from public.places place where place.owner_id = (select auth.uid())
            and place.map_id = split_part(name, '/', 2) and place.id = split_part(name, '/', 3)))
        or
        (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
          and exists (select 1 from public.places place where place.owner_id = (select auth.uid())
            and place.map_id = 'suining' and place.id = split_part(name, '/', 2)))
      )
    )
  )
);

drop policy if exists "published_place_images_select_own" on storage.objects;
drop policy if exists "published_place_images_insert_own" on storage.objects;
drop policy if exists "published_place_images_update_own" on storage.objects;
drop policy if exists "published_place_images_delete_own" on storage.objects;

-- ai coding：公开副本由路径中的 map/place/image 与 place_images 元数据逐项关联；旧四段路径只能归属 suining。
create policy "published_place_images_select_own" on storage.objects for select to authenticated using (
  bucket_id = 'published-place-images' and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved()) and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and exists (select 1 from public.place_images image where image.owner_id = (select auth.uid()) and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id
      and split_part(name, '/', 4) = image.place_id and split_part(name, '/', 5) = image.id::text || '.webp')
    or (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text
      and split_part(name, '/', 3) = image.place_id and split_part(name, '/', 4) = image.id::text || '.webp')))
);

create policy "published_place_images_insert_own" on storage.objects for insert to authenticated with check (
  bucket_id = 'published-place-images' and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved()) and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and exists (select 1 from public.place_images image where image.owner_id = (select auth.uid()) and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id
      and split_part(name, '/', 4) = image.place_id and split_part(name, '/', 5) = image.id::text || '.webp')
    or (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text
      and split_part(name, '/', 3) = image.place_id and split_part(name, '/', 4) = image.id::text || '.webp')))
);

create policy "published_place_images_update_own" on storage.objects for update to authenticated
using (
  bucket_id = 'published-place-images' and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved()) and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and exists (select 1 from public.place_images image where image.owner_id = (select auth.uid()) and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id
      and split_part(name, '/', 4) = image.place_id and split_part(name, '/', 5) = image.id::text || '.webp')
    or (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text
      and split_part(name, '/', 3) = image.place_id and split_part(name, '/', 4) = image.id::text || '.webp')))
)
with check (
  bucket_id = 'published-place-images' and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved()) and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and exists (select 1 from public.place_images image where image.owner_id = (select auth.uid()) and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id
      and split_part(name, '/', 4) = image.place_id and split_part(name, '/', 5) = image.id::text || '.webp')
    or (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text
      and split_part(name, '/', 3) = image.place_id and split_part(name, '/', 4) = image.id::text || '.webp')))
);

create policy "published_place_images_delete_own" on storage.objects for delete to authenticated using (
  bucket_id = 'published-place-images' and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved()) and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and exists (select 1 from public.place_images image where image.owner_id = (select auth.uid()) and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and split_part(name, '/', 1) = image.owner_id::text and split_part(name, '/', 2) = image.map_id
      and split_part(name, '/', 4) = image.place_id and split_part(name, '/', 5) = image.id::text || '.webp')
    or (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and image.map_id = 'suining' and split_part(name, '/', 1) = image.owner_id::text
      and split_part(name, '/', 3) = image.place_id and split_part(name, '/', 4) = image.id::text || '.webp')))
);

commit;

-- Hardens image publication after 006. Existing snapshots remain image-ineligible until republished.
begin;

-- ai coding：允许图片字段和全部公开能力都归 007 管理，006 重跑不会替换最终约束、policy 或 RPC。
alter table public.map_snapshots drop constraint if exists map_snapshots_public_fields_check;
alter table public.map_snapshots add constraint map_snapshots_public_fields_check check (
  public_fields @> array['name']::text[]
  and public_fields <@ array['name', 'type', 'coordinates', 'notes', 'images']::text[]
);

alter table public.map_snapshots
  add column if not exists image_manifest_version smallint not null default 0;
alter table public.map_snapshots drop constraint if exists map_snapshots_image_manifest_version_check;
alter table public.map_snapshots add constraint map_snapshots_image_manifest_version_check
  check (image_manifest_version in (0, 1));

-- ai coding：匿名兼容账号仍可发布纯地图，但数据库强制拒绝其直接写入任何 images 快照。
drop policy if exists "map_snapshots_insert_own" on public.map_snapshots;
create policy "map_snapshots_insert_own" on public.map_snapshots for insert to authenticated
with check (
  (select auth.uid()) = owner_id and (select public.is_approved())
  and (
    not ('images' = any (public_fields))
    or (
      coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
      and image_manifest_version = 1
    )
  )
);

drop policy if exists "map_snapshots_update_own" on public.map_snapshots;
create policy "map_snapshots_update_own" on public.map_snapshots for update to authenticated
using (
  (select auth.uid()) = owner_id and (select public.is_approved())
  and (
    not ('images' = any (public_fields))
    or coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  )
)
with check (
  (select auth.uid()) = owner_id and (select public.is_approved())
  and (
    not ('images' = any (public_fields))
    or (
      coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
      and image_manifest_version = 1
    )
  )
);

update storage.buckets
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/webp']
where id = 'published-place-images';

drop policy if exists "published_place_images_select_own" on storage.objects;
drop policy if exists "published_place_images_insert_own" on storage.objects;
drop policy if exists "published_place_images_update_own" on storage.objects;
drop policy if exists "published_place_images_delete_own" on storage.objects;

-- ai coding：新公开对象固定为 owner/release/place/image.webp；更新和删除额外兼容清理 006 的五层旧路径。
create policy "published_place_images_select_own" on storage.objects for select to authenticated
using (
  bucket_id = 'published-place-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?[.]webp$'
  and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
);
create policy "published_place_images_insert_own" on storage.objects for insert to authenticated
with check (
  bucket_id = 'published-place-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
  and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
);
create policy "published_place_images_update_own" on storage.objects for update to authenticated
using (
  bucket_id = 'published-place-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?[.]webp$'
  and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
)
with check (
  bucket_id = 'published-place-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
  and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
);
create policy "published_place_images_delete_own" on storage.objects for delete to authenticated
using (
  bucket_id = 'published-place-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?[.]webp$'
  and coalesce(metadata->>'mimetype', '') = 'image/webp'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
  and (select public.is_approved())
);

-- ai coding：RPC 忽略快照中的 URL/owner/token，只以已验证 manifest、私有图片元数据和受控 bucket 对象重建公开路径。
create or replace function public.get_public_map_snapshot(p_share_token text)
returns table(title text, published_at timestamptz, snapshot jsonb)
language sql stable security definer set search_path = '' as $$
  select m.title, m.updated_at,
    jsonb_build_object('type', 'FeatureCollection', 'name', 'public-places', 'features', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'id', coalesce(feature->'id', feature #> '{properties,id}'),
        'geometry', jsonb_build_object('type', feature #>> '{geometry,type}', 'coordinates', feature #> '{geometry,coordinates}'),
        'properties', jsonb_strip_nulls(
          jsonb_build_object('id', coalesce(feature->'id', feature #> '{properties,id}'), 'name', feature #> '{properties,name}')
          || case when 'type' = any (m.public_fields) then jsonb_build_object('type', feature #> '{properties,type}') else '{}'::jsonb end
          || case when 'coordinates' = any (m.public_fields) and coordinate is not null then jsonb_build_object('longitude', coordinate->0, 'latitude', coordinate->1) else '{}'::jsonb end
          -- ai coding：notes 是“备注等其他信息”的服务端白名单开关，只逐项输出安全业务字段。
          || case when 'notes' = any (m.public_fields) then jsonb_build_object(
            'notes', feature #> '{properties,notes}',
            'description', feature #> '{properties,description}',
            'address', feature #> '{properties,address}',
            'phone', feature #> '{properties,phone}',
            'website', feature #> '{properties,website}',
            'opening_hours', feature #> '{properties,opening_hours}'
          ) else '{}'::jsonb end
          || case when 'images' = any (m.public_fields) and m.image_manifest_version = 1
              and jsonb_typeof(feature #> '{properties,images}') = 'array'
            then jsonb_build_object('images', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', image->'id',
                'url', '/storage/v1/object/public/published-place-images/' || stored.name,
                'alt_text', left(case when jsonb_typeof(image->'alt_text') = 'string' then image->>'alt_text' else '' end, 160)
              ) order by image_position)
              from jsonb_array_elements(feature #> '{properties,images}') with ordinality published(image, image_position)
              join public.place_images source_image
                on source_image.owner_id = m.owner_id
                and source_image.place_id = coalesce(feature->>'id', feature #>> '{properties,id}')
                and source_image.id::text = image->>'id'
              join storage.objects stored
                on stored.bucket_id = 'published-place-images'
                and stored.name = image->>'public_path'
                and stored.name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
                and split_part(stored.name, '/', 1) = m.owner_id::text
                and split_part(stored.name, '/', 3) = coalesce(feature->>'id', feature #>> '{properties,id}')
                and split_part(stored.name, '/', 4) = (image->>'id') || '.webp'
                and coalesce(stored.metadata->>'mimetype', '') = 'image/webp'
              where jsonb_typeof(image->'id') = 'string'
                and jsonb_typeof(image->'public_path') = 'string'
            ), '[]'::jsonb))
            else '{}'::jsonb end
        )
      ) order by position)
      from jsonb_array_elements(m.snapshot->'features') with ordinality as source(feature, position)
      left join lateral (select public.snapshot_public_coordinates(feature) as coordinate) calculated on true
    ), '[]'::jsonb))
  from public.map_snapshots m
  where m.share_token = p_share_token and m.is_public = true
  limit 1;
$$;

revoke all on function public.get_public_map_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_public_map_snapshot(text) to anon, authenticated;

commit;

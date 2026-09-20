-- Enforces the three publication levels after 007 without widening legacy snapshots.
begin;

alter table public.map_snapshots
  add column if not exists publication_level text;

-- ai coding：只把字段数组已精确匹配新级别的历史行归类；其他行维持 NULL legacy 和原公开范围。
update public.map_snapshots
set publication_level = case
  when public_fields = array['name', 'type', 'coordinates']::text[] then 'basic'
  when public_fields = array['name', 'type', 'coordinates', 'notes']::text[] then 'details'
  when public_fields = array['name', 'type', 'coordinates', 'notes', 'images']::text[] then 'images'
end
where publication_level is null
  and public_fields in (
    array['name', 'type', 'coordinates']::text[],
    array['name', 'type', 'coordinates', 'notes']::text[],
    array['name', 'type', 'coordinates', 'notes', 'images']::text[]
  );

alter table public.map_snapshots drop constraint if exists map_snapshots_public_fields_check;
alter table public.map_snapshots drop constraint if exists map_snapshots_publication_level_check;
alter table public.map_snapshots add constraint map_snapshots_publication_level_check check (
  publication_level is null
  or (publication_level = 'basic' and public_fields = array['name', 'type', 'coordinates']::text[])
  or (publication_level = 'details' and public_fields = array['name', 'type', 'coordinates', 'notes']::text[])
  or (publication_level = 'images' and public_fields = array['name', 'type', 'coordinates', 'notes', 'images']::text[])
);

create or replace function public.enforce_map_snapshot_level()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- ai coding：INSERT 和从 legacy 重新发布都必须一次写入完整、精确匹配的新版级别。
  if new.publication_level in ('basic', 'details', 'images') then
    if not (
      (new.publication_level = 'basic' and new.public_fields = array['name', 'type', 'coordinates']::text[])
      or (new.publication_level = 'details' and new.public_fields = array['name', 'type', 'coordinates', 'notes']::text[])
      or (new.publication_level = 'images' and new.public_fields = array['name', 'type', 'coordinates', 'notes', 'images']::text[])
    ) then
      raise exception 'public_fields does not match publication_level' using errcode = '23514';
    end if;
    return new;
  end if;

  -- legacy 只能由迁移产生，合法行也不能把 level 清空后伪装成 legacy。
  if tg_op = 'INSERT' then
    raise exception 'new snapshots require a valid publication_level' using errcode = '23514';
  end if;
  if old.publication_level is not null
     or new.publication_level is not null
     or new.owner_id is distinct from old.owner_id
     or new.share_token is distinct from old.share_token
     or new.snapshot is distinct from old.snapshot
     or new.public_fields is distinct from old.public_fields
     or new.image_manifest_version is distinct from old.image_manifest_version
     or new.created_at is distinct from old.created_at
     or (old.is_public = false and new.is_public = true) then
    raise exception 'legacy snapshot and public_fields are immutable; republish with a valid level' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_map_snapshot_level() from public, anon, authenticated;
drop trigger if exists enforce_map_snapshot_level on public.map_snapshots;
create trigger enforce_map_snapshot_level
before insert or update on public.map_snapshots
for each row execute function public.enforce_map_snapshot_level();

create or replace function public.snapshot_allowed_public_fields(p_level text, p_fields text[])
returns text[] language sql immutable set search_path = '' as $$
  select case
    when p_level = 'basic' and p_fields = array['name', 'type', 'coordinates']::text[] then p_fields
    when p_level = 'details' and p_fields = array['name', 'type', 'coordinates', 'notes']::text[] then p_fields
    when p_level = 'images' and p_fields = array['name', 'type', 'coordinates', 'notes', 'images']::text[] then p_fields
    -- ai coding：未升级 legacy 无论旧数组为何值都只走 RPC 固有的 name + geometry 安全基线。
    when p_level is null then array[]::text[]
    else array[]::text[]
  end;
$$;
revoke all on function public.snapshot_allowed_public_fields(text, text[]) from public, anon, authenticated;

-- ai coding：保留 007 的图片对象验证；legacy 仅输出安全基线，非法旧字段不再驱动 RPC。
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
          || case when 'type' = any (allowed.fields) then jsonb_build_object('type', feature #> '{properties,type}') else '{}'::jsonb end
          || case when 'coordinates' = any (allowed.fields) and coordinate is not null then jsonb_build_object('longitude', coordinate->0, 'latitude', coordinate->1) else '{}'::jsonb end
          || case when 'notes' = any (allowed.fields) then jsonb_build_object(
            'notes', feature #> '{properties,notes}',
            'description', feature #> '{properties,description}',
            'address', feature #> '{properties,address}',
            'phone', feature #> '{properties,phone}',
            'website', feature #> '{properties,website}',
            'opening_hours', feature #> '{properties,opening_hours}'
          ) else '{}'::jsonb end
          || case when 'images' = any (allowed.fields) and m.image_manifest_version = 1
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
  cross join lateral (select public.snapshot_allowed_public_fields(m.publication_level, m.public_fields) as fields) allowed
  where m.share_token = p_share_token and m.is_public = true
  limit 1;
$$;

revoke all on function public.get_public_map_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_public_map_snapshot(text) to anon, authenticated;

commit;

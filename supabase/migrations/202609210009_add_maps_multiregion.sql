-- Adds global map configuration and owner + map isolation. Run only after 001-008 and after a full database/storage backup.
begin;

-- ai coding：任何 DDL 前验证 001-008 的关键结构；未知或不完整 schema 直接中止，不猜测、删除或重建远程数据。
do $$
declare
  missing text;
begin
  if to_regclass('public.places') is null or to_regclass('public.map_snapshots') is null or to_regclass('public.place_images') is null then
    raise exception 'migration 009 已停止：places、map_snapshots 或 place_images 不存在。请先依次执行 001-008。';
  end if;
  select string_agg(required.column_name, ', ') into missing
  from (values
    ('public.places'::regclass, 'owner_id'), ('public.places'::regclass, 'id'),
    ('public.map_snapshots'::regclass, 'owner_id'), ('public.map_snapshots'::regclass, 'publication_level'),
    ('public.place_images'::regclass, 'owner_id'), ('public.place_images'::regclass, 'place_id')
  ) required(table_oid, column_name)
  where not exists (select 1 from pg_attribute where attrelid = required.table_oid and attname = required.column_name and not attisdropped);
  if missing is not null then raise exception 'migration 009 已停止：001-008 必要列缺失：%。请恢复兼容 schema 后重试。', missing; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.places'::regclass and contype = 'p' and conkey = array[
    (select attnum from pg_attribute where attrelid='public.places'::regclass and attname='owner_id'),
    (select attnum from pg_attribute where attrelid='public.places'::regclass and attname='id')
  ]::smallint[]) then
    raise exception 'migration 009 已停止：places 主键不是预期的 (owner_id,id)。';
  end if;
  if exists (select 1 from public.places where owner_id is null)
     or exists (select 1 from public.map_snapshots where owner_id is null)
     or exists (select 1 from public.place_images where owner_id is null or place_id is null) then
    raise exception 'migration 009 已停止：现有数据缺少 owner/place 归属，不能安全回填 map_id。';
  end if;
end $$;

create table public.maps (
  id text primary key,
  slug text not null unique,
  name text not null,
  bounds jsonb not null,
  center jsonb not null,
  base_roads_path text not null,
  seed_places_path text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maps_id_slug_check check (id = slug and slug ~ '^[a-z0-9-]+$'),
  constraint maps_bounds_check check (jsonb_typeof(bounds) = 'object' and jsonb_typeof(bounds->'south') = 'number' and jsonb_typeof(bounds->'west') = 'number' and jsonb_typeof(bounds->'north') = 'number' and jsonb_typeof(bounds->'east') = 'number'),
  constraint maps_center_check check (jsonb_typeof(center) = 'object' and jsonb_typeof(center->'lat') = 'number' and jsonb_typeof(center->'lon') = 'number'),
  constraint maps_paths_check check (base_roads_path like '/data/regions/' || slug || '/%' and seed_places_path like '/data/regions/' || slug || '/%')
);

insert into public.maps (id, slug, name, bounds, center, base_roads_path, seed_places_path)
values
  ('suining', 'suining', '睢宁县', '{"south":33.665,"west":117.45,"north":34.22,"east":118.24}', '{"lat":33.9425,"lon":117.845}', '/data/regions/suining/base-roads.geojson', '/data/regions/suining/places.geojson'),
  ('xuhui', 'xuhui', '上海市徐汇区', '{"south":31.08,"west":121.335,"north":31.28,"east":121.545}', '{"lat":31.18,"lon":121.44}', '/data/regions/xuhui/base-roads.geojson', '/data/regions/xuhui/places.geojson')
on conflict (id) do update set slug=excluded.slug, name=excluded.name, bounds=excluded.bounds, center=excluded.center,
  base_roads_path=excluded.base_roads_path, seed_places_path=excluded.seed_places_path, is_active=true, updated_at=now();

alter table public.maps enable row level security;
revoke all on public.maps from public, anon, authenticated;
grant select on public.maps to anon, authenticated;
create policy "maps_read_active" on public.maps for select to anon, authenticated using (is_active = true);

alter table public.place_images drop constraint place_images_place_fkey;
alter table public.places add column map_id text references public.maps(id);
alter table public.map_snapshots add column map_id text references public.maps(id);
alter table public.place_images add column map_id text references public.maps(id);
update public.places set map_id = 'suining' where map_id is null;
update public.map_snapshots set map_id = 'suining' where map_id is null;
update public.place_images set map_id = 'suining' where map_id is null;
alter table public.places alter column map_id set not null;
alter table public.map_snapshots alter column map_id set not null;
alter table public.place_images alter column map_id set not null;

alter table public.places drop constraint places_pkey;
alter table public.places add constraint places_pkey primary key (owner_id, map_id, id);
alter table public.map_snapshots drop constraint map_snapshots_pkey;
alter table public.map_snapshots add constraint map_snapshots_pkey primary key (owner_id, map_id);
alter table public.place_images add constraint place_images_place_fkey foreign key (owner_id, map_id, place_id)
  references public.places(owner_id, map_id, id) on delete cascade;
create index places_owner_map_updated_at_idx on public.places(owner_id, map_id, updated_at desc);
create index place_images_owner_map_place_idx on public.place_images(owner_id, map_id, place_id, sort_order, created_at);

-- Existing suining object names remain valid and are never moved implicitly; all new clients write owner/map/place/file.
alter table public.place_images drop constraint place_images_storage_place_check;
alter table public.place_images drop constraint place_images_storage_depth_check;
alter table public.place_images add constraint place_images_storage_scope_check check (
  (map_id = 'suining' and storage_path ~ ('^' || owner_id::text || '/' || place_id || '/[^/]+$'))
  or storage_path ~ ('^' || owner_id::text || '/' || map_id || '/' || place_id || '/[^/]+$')
);

create or replace function public.enforce_map_snapshot_level()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.publication_level in ('basic', 'details', 'images') then
    if not ((new.publication_level='basic' and new.public_fields=array['name','type','coordinates']::text[])
      or (new.publication_level='details' and new.public_fields=array['name','type','coordinates','notes']::text[])
      or (new.publication_level='images' and new.public_fields=array['name','type','coordinates','notes','images']::text[])) then
      raise exception 'public_fields does not match publication_level' using errcode='23514';
    end if;
    return new;
  end if;
  if tg_op='INSERT' or old.publication_level is not null or new.publication_level is not null
    or new.owner_id is distinct from old.owner_id or new.map_id is distinct from old.map_id
    or new.share_token is distinct from old.share_token or new.snapshot is distinct from old.snapshot
    or new.public_fields is distinct from old.public_fields or new.image_manifest_version is distinct from old.image_manifest_version
    or new.created_at is distinct from old.created_at or (old.is_public=false and new.is_public=true) then
    raise exception 'legacy snapshot and public_fields are immutable; republish with a valid level' using errcode='23514';
  end if;
  return new;
end $$;

-- ai coding：RPC 只返回快照与对应全局地图的公开显示配置；不返回 owner、私有路径、manifest 或原始内部字段。
drop function public.get_public_map_snapshot(text);
create function public.get_public_map_snapshot(p_share_token text)
returns table(title text, published_at timestamptz, map_config jsonb, snapshot jsonb)
language sql stable security definer set search_path = '' as $$
  select m.title, m.updated_at,
    jsonb_build_object('id', cfg.id, 'slug', cfg.slug, 'name', cfg.name, 'bounds', cfg.bounds, 'center', cfg.center,
      'base_roads_path', cfg.base_roads_path, 'seed_places_path', cfg.seed_places_path, 'is_active', cfg.is_active),
    jsonb_build_object('type','FeatureCollection','name','public-places','features',coalesce((
      select jsonb_agg(jsonb_build_object('type','Feature','id',coalesce(feature->'id',feature#>'{properties,id}'),
        'geometry',jsonb_build_object('type',feature#>>'{geometry,type}','coordinates',feature#>'{geometry,coordinates}'),
        'properties',jsonb_strip_nulls(
          jsonb_build_object('id',coalesce(feature->'id',feature#>'{properties,id}'),'name',feature#>'{properties,name}')
          || case when 'type'=any(allowed.fields) then jsonb_build_object('type',feature#>'{properties,type}') else '{}'::jsonb end
          || case when 'coordinates'=any(allowed.fields) and coordinate is not null then jsonb_build_object('longitude',coordinate->0,'latitude',coordinate->1) else '{}'::jsonb end
          || case when 'notes'=any(allowed.fields) then jsonb_build_object('notes',feature#>'{properties,notes}','description',feature#>'{properties,description}','address',feature#>'{properties,address}','phone',feature#>'{properties,phone}','website',feature#>'{properties,website}','opening_hours',feature#>'{properties,opening_hours}') else '{}'::jsonb end
          || case when 'images'=any(allowed.fields) and m.image_manifest_version=1 and jsonb_typeof(feature#>'{properties,images}')='array'
            then jsonb_build_object('images',coalesce((select jsonb_agg(jsonb_build_object('id',image->'id','url','/storage/v1/object/public/published-place-images/'||stored.name,'alt_text',left(case when jsonb_typeof(image->'alt_text')='string' then image->>'alt_text' else '' end,160)) order by image_position)
              from jsonb_array_elements(feature#>'{properties,images}') with ordinality published(image,image_position)
              join public.place_images source_image on source_image.owner_id=m.owner_id and source_image.map_id=m.map_id and source_image.place_id=coalesce(feature->>'id',feature#>>'{properties,id}') and source_image.id::text=image->>'id'
              join storage.objects stored on stored.bucket_id='published-place-images' and stored.name=image->>'public_path'
                and split_part(stored.name,'/',1)=m.owner_id::text
                and ((split_part(stored.name,'/',2)=m.map_id and split_part(stored.name,'/',4)=coalesce(feature->>'id',feature#>>'{properties,id}') and split_part(stored.name,'/',5)=(image->>'id')||'.webp')
                  or (m.map_id='suining' and split_part(stored.name,'/',3)=coalesce(feature->>'id',feature#>>'{properties,id}') and split_part(stored.name,'/',4)=(image->>'id')||'.webp'))
                and coalesce(stored.metadata->>'mimetype','')='image/webp'
              where jsonb_typeof(image->'id')='string' and jsonb_typeof(image->'public_path')='string'),'[]'::jsonb)) else '{}'::jsonb end)) order by position)
      from jsonb_array_elements(m.snapshot->'features') with ordinality source(feature,position)
      left join lateral (select public.snapshot_public_coordinates(feature) coordinate) calculated on true
    ),'[]'::jsonb))
  from public.map_snapshots m
  join public.maps cfg on cfg.id=m.map_id and cfg.is_active=true
  cross join lateral (select public.snapshot_allowed_public_fields(m.publication_level,m.public_fields) fields) allowed
  where m.share_token=p_share_token and m.is_public=true limit 1;
$$;
revoke all on function public.get_public_map_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_public_map_snapshot(text) to anon, authenticated;

-- ai coding：新私有路径固定为 owner/map/place/file；仅为睢宁历史对象保留 owner/place/file，且两种格式都校验真实地点归属。
drop policy if exists "private_place_images_insert_own" on storage.objects;
create policy "private_place_images_insert_own" on storage.objects for insert to authenticated with check (
  bucket_id='place-images'
  and split_part(name,'/',1)=(select auth.uid())::text
  and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
      and exists (select 1 from public.places p where p.owner_id=(select auth.uid())
        and p.map_id=split_part(name,'/',2) and p.id=split_part(name,'/',3)))
    or
    (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.](jpg|png|webp)$'
      and exists (select 1 from public.places p where p.owner_id=(select auth.uid())
        and p.map_id='suining' and p.id=split_part(name,'/',2)))
  )
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and (select public.is_approved()));

-- 新公开副本固定为 owner/map/release/place/image.webp；兼容的四段睢宁路径仍保持 owner、地点和图片元数据约束。
drop policy if exists "published_place_images_insert_own" on storage.objects;
create policy "published_place_images_insert_own" on storage.objects for insert to authenticated with check (
  bucket_id='published-place-images'
  and split_part(name,'/',1)=(select auth.uid())::text
  and (
    (name ~ '^[A-Za-z0-9_-]+/[a-z0-9-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and exists (select 1 from public.place_images source_image where source_image.owner_id=(select auth.uid())
        and source_image.map_id=split_part(name,'/',2) and source_image.place_id=split_part(name,'/',4)
        and source_image.id::text=split_part(split_part(name,'/',5),'.',1)))
    or
    (name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]webp$'
      and exists (select 1 from public.place_images source_image where source_image.owner_id=(select auth.uid())
        and source_image.map_id='suining' and source_image.place_id=split_part(name,'/',3)
        and source_image.id::text=split_part(split_part(name,'/',4),'.',1)))
  )
  and coalesce(metadata->>'mimetype','')='image/webp'
  and coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false and (select public.is_approved()));

commit;

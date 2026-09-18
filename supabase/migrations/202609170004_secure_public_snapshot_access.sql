-- Secures public snapshot reads behind a server-side whitelist RPC.
-- Run after 003. Existing rows intentionally default to map/name + geometry only.

begin;

alter table public.map_snapshots
  add column if not exists public_fields text[] not null default array['name']::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.map_snapshots'::regclass
      and conname = 'map_snapshots_public_fields_check'
  ) then
    alter table public.map_snapshots
      add constraint map_snapshots_public_fields_check check (
        public_fields @> array['name']::text[]
        and public_fields <@ array['name', 'type', 'coordinates', 'notes']::text[]
      );
  end if;
end
$$;

-- ai coding：访客不再拥有表级 SELECT，也不再有可枚举公开行的 RLS policy；authenticated 仅保留 owner policy。
drop policy if exists "map_snapshots_select_public" on public.map_snapshots;
revoke all on table public.map_snapshots from public;
revoke all on table public.map_snapshots from anon;
revoke all on table public.map_snapshots from authenticated;
grant select, insert, update, delete on table public.map_snapshots to authenticated;

-- Returns [longitude, latitude]. Polygon metadata is preferred; malformed/missing metadata
-- falls back to an approximate vertex center without exposing any other property.
create or replace function public.snapshot_public_coordinates(p_feature jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  geometry_type text := p_feature #>> '{geometry,type}';
  geometry_coordinates jsonb := p_feature #> '{geometry,coordinates}';
  property_longitude jsonb := p_feature #> '{properties,longitude}';
  property_latitude jsonb := p_feature #> '{properties,latitude}';
  longitude_value double precision;
  latitude_value double precision;
begin
  if geometry_type = 'Point'
     and jsonb_typeof(geometry_coordinates) = 'array'
     and jsonb_array_length(geometry_coordinates) >= 2
     and jsonb_typeof(geometry_coordinates->0) = 'number'
     and jsonb_typeof(geometry_coordinates->1) = 'number' then
    longitude_value := (geometry_coordinates->>0)::double precision;
    latitude_value := (geometry_coordinates->>1)::double precision;
  elsif geometry_type = 'Polygon'
     and jsonb_typeof(property_longitude) = 'number'
     and jsonb_typeof(property_latitude) = 'number' then
    longitude_value := property_longitude::text::double precision;
    latitude_value := property_latitude::text::double precision;
  elsif geometry_type = 'Polygon'
     and jsonb_typeof(geometry_coordinates) = 'array'
     and jsonb_array_length(geometry_coordinates) = 1
     and jsonb_typeof(geometry_coordinates->0) = 'array' then
    select avg((vertex->>0)::double precision), avg((vertex->>1)::double precision)
      into longitude_value, latitude_value
    from jsonb_array_elements(geometry_coordinates->0) with ordinality as ring(vertex, position)
    where jsonb_typeof(vertex) = 'array'
      and jsonb_array_length(vertex) >= 2
      and jsonb_typeof(vertex->0) = 'number'
      and jsonb_typeof(vertex->1) = 'number'
      and not (
        position = jsonb_array_length(geometry_coordinates->0)
        and vertex = geometry_coordinates->0->0
      );
  end if;

  if longitude_value is null or latitude_value is null
     or longitude_value < -180 or longitude_value > 180
     or latitude_value < -90 or latitude_value > 90 then
    return null;
  end if;
  return jsonb_build_array(longitude_value, latitude_value);
exception when others then
  return null;
end;
$$;

revoke all on function public.snapshot_public_coordinates(jsonb) from public, anon, authenticated;

-- ai coding：SECURITY DEFINER 只按精确 token 读取一行，并从 geometry 与允许字段重新构造 JSON；原始 snapshot 永不作为返回值。
create or replace function public.get_public_map_snapshot(p_share_token text)
returns table(title text, published_at timestamptz, snapshot jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.title,
    m.updated_at as published_at,
    jsonb_build_object(
      'type', 'FeatureCollection',
      'name', 'public-places',
      'features', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'id', coalesce(feature->'id', feature #> '{properties,id}'),
            'geometry', jsonb_build_object(
              'type', feature #>> '{geometry,type}',
              'coordinates', feature #> '{geometry,coordinates}'
            ),
            'properties', jsonb_strip_nulls(
              jsonb_build_object(
                'id', coalesce(feature->'id', feature #> '{properties,id}'),
                'name', feature #> '{properties,name}'
              )
              || case when 'type' = any (m.public_fields)
                then jsonb_build_object('type', feature #> '{properties,type}') else '{}'::jsonb end
              || case when 'coordinates' = any (m.public_fields) and coordinate is not null
                then jsonb_build_object('longitude', coordinate->0, 'latitude', coordinate->1) else '{}'::jsonb end
              || case when 'notes' = any (m.public_fields)
                then jsonb_build_object('description', feature #> '{properties,description}') else '{}'::jsonb end
            )
          ) order by position
        )
        from jsonb_array_elements(m.snapshot->'features') with ordinality as source(feature, position)
        left join lateral (
          select public.snapshot_public_coordinates(feature) as coordinate
        ) calculated on true
      ), '[]'::jsonb)
    ) as snapshot
  from public.map_snapshots as m
  where m.share_token = p_share_token
    and m.is_public = true
  limit 1;
$$;

revoke all on function public.get_public_map_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_public_map_snapshot(text) to anon, authenticated;

commit;

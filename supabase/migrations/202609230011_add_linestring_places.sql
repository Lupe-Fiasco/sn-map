-- Adds validated open LineString places after 001-010. Safe to rerun; does not replace RLS or Storage policies.
begin;

do $$ begin
  if to_regclass('public.places') is null or to_regclass('public.map_snapshots') is null or to_regclass('public.maps') is null then
    raise exception 'migration 011 已停止：请先按顺序执行 migration 001-010。';
  end if;
end $$;

-- ai coding：同一不可变函数集中校验 Point/开放 LineString/单外环 Polygon 的坐标、范围、闭合与不同顶点数。
create or replace function public.is_valid_place_geometry(p_geometry jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare coordinates jsonb; ring jsonb; position jsonb; first_position jsonb; last_position jsonb; distinct_count integer;
begin
  if jsonb_typeof(p_geometry) <> 'object' then return false; end if;
  coordinates := p_geometry->'coordinates';
  if p_geometry->>'type' = 'Point' then
    if jsonb_typeof(coordinates) <> 'array' or jsonb_array_length(coordinates) <> 2 then return false; end if;
    position := coordinates;
  elsif p_geometry->>'type' = 'LineString' then
    if jsonb_typeof(coordinates) <> 'array' or jsonb_array_length(coordinates) < 2 then return false; end if;
    for position in select value from jsonb_array_elements(coordinates) loop
      if jsonb_typeof(position) <> 'array' or jsonb_array_length(position) <> 2
        or jsonb_typeof(position->0) <> 'number' or jsonb_typeof(position->1) <> 'number'
        or (position->>0)::double precision not between -180 and 180
        or (position->>1)::double precision not between -90 and 90 then return false; end if;
    end loop;
    first_position := coordinates->0; last_position := coordinates->(jsonb_array_length(coordinates)-1);
    if first_position = last_position then return false; end if;
    select count(distinct ((value->>0)::double precision,(value->>1)::double precision)) into distinct_count from jsonb_array_elements(coordinates);
    if distinct_count < 2 then return false; end if;
    return true;
  elsif p_geometry->>'type' = 'Polygon' then
    if jsonb_typeof(coordinates) <> 'array' or jsonb_array_length(coordinates) <> 1 then return false; end if;
    ring := coordinates->0;
    if jsonb_typeof(ring) <> 'array' or jsonb_array_length(ring) < 4 then return false; end if;
    first_position := ring->0; last_position := ring->(jsonb_array_length(ring)-1);
    if first_position <> last_position then return false; end if;
    for position in select value from jsonb_array_elements(ring) loop
      if jsonb_typeof(position) <> 'array' or jsonb_array_length(position) <> 2
        or jsonb_typeof(position->0) <> 'number' or jsonb_typeof(position->1) <> 'number'
        or (position->>0)::double precision not between -180 and 180
        or (position->>1)::double precision not between -90 and 90 then return false; end if;
    end loop;
    select count(distinct ((value->>0)::double precision,(value->>1)::double precision)) into distinct_count
      from jsonb_array_elements(ring) with ordinality item(value,n) where n<jsonb_array_length(ring);
    if distinct_count < 3 then return false; end if;
    return true;
  else return false;
  end if;
  return jsonb_typeof(position->0) = 'number' and jsonb_typeof(position->1) = 'number'
    and (position->>0)::double precision between -180 and 180 and (position->>1)::double precision between -90 and 90;
exception when others then return false;
end $$;

alter table public.places drop constraint if exists places_geometry_type_check;
alter table public.places drop constraint if exists places_geometry_coordinates_check;
alter table public.places drop constraint if exists places_geometry_valid_check;
alter table public.places add constraint places_geometry_valid_check check (public.is_valid_place_geometry(geometry)) not valid;
alter table public.places validate constraint places_geometry_valid_check;

create or replace function public.validate_linestring_contained_places()
returns trigger language plpgsql set search_path = '' as $$
declare contained jsonb; contained_id text;
begin
  contained := new.properties->'contained_place_ids';
  if tg_op='UPDATE' and old.geometry->>'type'='Point' and new.geometry->>'type'<>'Point'
    and exists (select 1 from public.places p where p.owner_id=old.owner_id and p.map_id=old.map_id
      and p.geometry->>'type'='LineString' and p.properties->'contained_place_ids' ? old.id) then
    raise exception 'a referenced Point place cannot change to another geometry type' using errcode='23514';
  end if;
  if contained is null then return new; end if;
  if new.geometry->>'type' <> 'LineString' or jsonb_typeof(contained) <> 'array' then
    raise exception 'contained_place_ids is allowed only as an array on LineString places' using errcode='23514';
  end if;
  if exists (select 1 from jsonb_array_elements(contained) item(value) where jsonb_typeof(value) <> 'string' or btrim(value#>>'{}') = '')
    or (select count(*) from jsonb_array_elements(contained)) <> (select count(distinct value#>>'{}') from jsonb_array_elements(contained)) then
    raise exception 'contained_place_ids must contain unique non-empty strings' using errcode='23514';
  end if;
  for contained_id in select value#>>'{}' from jsonb_array_elements(contained) loop
    if not exists (select 1 from public.places p where p.owner_id=new.owner_id and p.map_id=new.map_id and p.id=contained_id and p.geometry->>'type'='Point') then
      raise exception 'contained_place_ids may reference only existing Point places in the same owner and map' using errcode='23514';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists validate_linestring_contained_places on public.places;
create trigger validate_linestring_contained_places before insert or update of owner_id,map_id,geometry,properties on public.places
for each row execute function public.validate_linestring_contained_places();

create or replace function public.cleanup_contained_place_reference()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.geometry->>'type'='Point' then
    update public.places set properties=jsonb_set(properties,'{contained_place_ids}',
      coalesce((select jsonb_agg(value) from jsonb_array_elements(properties->'contained_place_ids') item(value) where value#>>'{}'<>old.id),'[]'::jsonb),false)
    where owner_id=old.owner_id and map_id=old.map_id and geometry->>'type'='LineString'
      and properties->'contained_place_ids' ? old.id;
  end if;
  return old;
end $$;
drop trigger if exists cleanup_contained_place_reference on public.places;
create trigger cleanup_contained_place_reference before delete on public.places for each row execute function public.cleanup_contained_place_reference();

-- Existing snapshots are checked before the constraint becomes active; malformed historical rows abort the transaction unchanged.
create or replace function public.is_valid_snapshot_geometries(p_snapshot jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare feature jsonb;
begin
  if jsonb_typeof(p_snapshot->'features') <> 'array' then return false; end if;
  for feature in select value from jsonb_array_elements(p_snapshot->'features') loop
    if not public.is_valid_place_geometry(feature->'geometry') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
alter table public.map_snapshots drop constraint if exists map_snapshots_geometry_valid_check;
alter table public.map_snapshots add constraint map_snapshots_geometry_valid_check check (public.is_valid_snapshot_geometries(snapshot)) not valid;
alter table public.map_snapshots validate constraint map_snapshots_geometry_valid_check;

create or replace function public.snapshot_public_coordinates(p_feature jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare geometry_type text := p_feature#>>'{geometry,type}'; coordinates jsonb := p_feature#>'{geometry,coordinates}'; longitude_value double precision; latitude_value double precision;
begin
  if geometry_type='Point' then longitude_value := (coordinates->>0)::double precision; latitude_value := (coordinates->>1)::double precision;
  elsif geometry_type in ('LineString','Polygon') and jsonb_typeof(p_feature#>'{properties,longitude}')='number' and jsonb_typeof(p_feature#>'{properties,latitude}')='number' then
    longitude_value := (p_feature#>>'{properties,longitude}')::double precision; latitude_value := (p_feature#>>'{properties,latitude}')::double precision;
  elsif geometry_type='LineString' then
    select avg((vertex->>0)::double precision),avg((vertex->>1)::double precision) into longitude_value,latitude_value from jsonb_array_elements(coordinates) item(vertex);
  elsif geometry_type='Polygon' then
    select avg((vertex->>0)::double precision),avg((vertex->>1)::double precision) into longitude_value,latitude_value
    from jsonb_array_elements(coordinates->0) with ordinality ring(vertex,position) where position<jsonb_array_length(coordinates->0);
  end if;
  if longitude_value not between -180 and 180 or latitude_value not between -90 and 90 then return null; end if;
  return jsonb_build_array(longitude_value,latitude_value);
exception when others then return null;
end $$;
revoke all on function public.snapshot_public_coordinates(jsonb) from public, anon, authenticated;

-- ai coding：保留 007/008/009 的字段、图片和 map 白名单，只增加三种合法 geometry 的服务端门禁。
drop function public.get_public_map_snapshot(text);
create function public.get_public_map_snapshot(p_share_token text)
returns table(title text, published_at timestamptz, map_config jsonb, snapshot jsonb)
language sql stable security definer set search_path = '' as $$
  select m.title,m.updated_at,
    jsonb_build_object('id',cfg.id,'slug',cfg.slug,'name',cfg.name,'bounds',cfg.bounds,'center',cfg.center,'base_roads_path',cfg.base_roads_path,'seed_places_path',cfg.seed_places_path,'is_active',cfg.is_active),
    jsonb_build_object('type','FeatureCollection','name','public-places','features',coalesce((
      select jsonb_agg(jsonb_build_object('type','Feature','id',coalesce(feature->'id',feature#>'{properties,id}'),
        'geometry',jsonb_build_object('type',feature#>>'{geometry,type}','coordinates',feature#>'{geometry,coordinates}'),
        'properties',jsonb_strip_nulls(jsonb_build_object('id',coalesce(feature->'id',feature#>'{properties,id}'),'name',feature#>'{properties,name}')
          || case when 'type'=any(allowed.fields) then jsonb_build_object('type',feature#>'{properties,type}') else '{}'::jsonb end
          || case when 'coordinates'=any(allowed.fields) and coordinate is not null then jsonb_build_object('longitude',coordinate->0,'latitude',coordinate->1) else '{}'::jsonb end
          || case when 'notes'=any(allowed.fields) then jsonb_build_object('notes',feature#>'{properties,notes}','description',feature#>'{properties,description}','address',feature#>'{properties,address}','phone',feature#>'{properties,phone}','website',feature#>'{properties,website}','opening_hours',feature#>'{properties,opening_hours}') else '{}'::jsonb end
          || case when 'images'=any(allowed.fields) and m.image_manifest_version=1 and jsonb_typeof(feature#>'{properties,images}')='array' then jsonb_build_object('images',coalesce((
            select jsonb_agg(jsonb_build_object('id',image->'id','url','/storage/v1/object/public/published-place-images/'||stored.name,'alt_text',left(case when jsonb_typeof(image->'alt_text')='string' then image->>'alt_text' else '' end,160)) order by image_position)
            from jsonb_array_elements(feature#>'{properties,images}') with ordinality published(image,image_position)
            join public.place_images source_image on source_image.owner_id=m.owner_id and source_image.map_id=m.map_id and source_image.place_id=coalesce(feature->>'id',feature#>>'{properties,id}') and source_image.id::text=image->>'id'
            join storage.objects stored on stored.bucket_id='published-place-images' and stored.name=image->>'public_path' and split_part(stored.name,'/',1)=m.owner_id::text
              and ((split_part(stored.name,'/',2)=m.map_id and split_part(stored.name,'/',4)=coalesce(feature->>'id',feature#>>'{properties,id}') and split_part(stored.name,'/',5)=(image->>'id')||'.webp')
                or (m.map_id='suining' and split_part(stored.name,'/',3)=coalesce(feature->>'id',feature#>>'{properties,id}') and split_part(stored.name,'/',4)=(image->>'id')||'.webp'))
              and coalesce(stored.metadata->>'mimetype','')='image/webp'
            where jsonb_typeof(image->'id')='string' and jsonb_typeof(image->'public_path')='string'),'[]'::jsonb)) else '{}'::jsonb end)) order by position)
      from jsonb_array_elements(m.snapshot->'features') with ordinality source(feature,position)
      left join lateral (select public.snapshot_public_coordinates(feature) coordinate) calculated on true
      where public.is_valid_place_geometry(feature->'geometry')
    ),'[]'::jsonb))
  from public.map_snapshots m join public.maps cfg on cfg.id=m.map_id and cfg.is_active=true
  cross join lateral (select public.snapshot_allowed_public_fields(m.publication_level,m.public_fields) fields) allowed
  where m.share_token=p_share_token and m.is_public=true limit 1;
$$;
revoke all on function public.get_public_map_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_public_map_snapshot(text) to anon, authenticated;

commit;

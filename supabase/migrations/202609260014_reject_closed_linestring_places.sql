-- Reinstalls strict open-LineString geometry gates for databases that ran an earlier 011.
begin;

do $$
declare
  closed_place_count bigint;
  closed_snapshot_feature_count bigint;
begin
  if to_regclass('public.places') is null or to_regclass('public.map_snapshots') is null then
    raise exception 'migration 014 已停止：请先按顺序执行 migration 001-013。';
  end if;

  -- ai coding：必须在替换函数或约束前阻断历史闭合线，避免安装到一半才由约束给出模糊失败。
  select count(*) into closed_place_count
  from public.places
  where geometry->>'type' = 'LineString'
    and case when jsonb_typeof(geometry->'coordinates') = 'array' then
      case when jsonb_array_length(geometry->'coordinates') >= 2 then
        geometry#>'{coordinates,0}' = geometry->'coordinates'->(jsonb_array_length(geometry->'coordinates') - 1)
      else false end
    else false end;

  select count(*) into closed_snapshot_feature_count
  from public.map_snapshots snapshot_row
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(snapshot_row.snapshot->'features') = 'array'
      then snapshot_row.snapshot->'features' else '[]'::jsonb end
  ) feature(value)
  where feature.value#>>'{geometry,type}' = 'LineString'
    and case when jsonb_typeof(feature.value#>'{geometry,coordinates}') = 'array' then
      case when jsonb_array_length(feature.value#>'{geometry,coordinates}') >= 2 then
        feature.value#>'{geometry,coordinates,0}' = (feature.value#>'{geometry,coordinates}')->(jsonb_array_length(feature.value#>'{geometry,coordinates}') - 1)
      else false end
    else false end;

  if closed_place_count > 0 or closed_snapshot_feature_count > 0 then
    raise exception 'migration 014 已停止：发现历史闭合 LineString（places % 条，map_snapshots % 个 feature）。尚未安装或替换任何安全函数/约束。', closed_place_count, closed_snapshot_feature_count
      using hint = '请先完整备份，再查询 places(owner_id,map_id,id,geometry) 及 map_snapshots(owner_id,map_id,snapshot.features[*].id/geometry)，逐条人工核实并修复：LineString 至少保留 2 个不同顶点且首尾不得相同；若业务上实际为区域，只能经人工确认后改为合法单外环 Polygon。不得猜测形状或删除快照；修复 places 与快照中的对应记录后重新执行 014。';
  end if;
end $$;

-- ai coding：014 重建 011 的统一几何门禁，使 places 写入、公开快照约束和公开 RPC 同时拒绝闭合线。
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

alter table public.places drop constraint if exists places_geometry_valid_check;
alter table public.places add constraint places_geometry_valid_check check (public.is_valid_place_geometry(geometry)) not valid;
alter table public.places validate constraint places_geometry_valid_check;

alter table public.map_snapshots drop constraint if exists map_snapshots_geometry_valid_check;
alter table public.map_snapshots add constraint map_snapshots_geometry_valid_check check (public.is_valid_snapshot_geometries(snapshot)) not valid;
alter table public.map_snapshots validate constraint map_snapshots_geometry_valid_check;

commit;

-- Prevents referenced Point rows from leaving their owner/map scope after 011. Safe to rerun.
begin;

do $$ begin
  if to_regclass('public.places') is null
    or to_regprocedure('public.validate_linestring_contained_places()') is null
    or to_regprocedure('public.cleanup_contained_place_reference()') is null then
    raise exception 'migration 012 已停止：请先执行 migration 011。';
  end if;
end $$;

-- ai coding：所有引用检查共用事务锁，阻止 API 更新与并发新增 LineString 造成跨 owner/map 的悬空引用。
create or replace function public.validate_linestring_contained_places()
returns trigger language plpgsql security definer set search_path = '' as $$
declare contained jsonb; contained_id text;
begin
  if tg_op = 'UPDATE' and old.geometry->>'type' = 'Point' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.owner_id::text || E'\x1f' || old.map_id || E'\x1f' || old.id, 0));
    if exists (
      select 1 from public.places p
      where p.owner_id = old.owner_id and p.map_id = old.map_id
        and p.geometry->>'type' = 'LineString'
        and p.properties->'contained_place_ids' ? old.id
    ) then
      if new.owner_id is distinct from old.owner_id or new.map_id is distinct from old.map_id then
        raise exception 'a referenced Point place cannot change owner_id or map_id; remove it from LineString contained_place_ids first' using errcode = '23514';
      end if;
      if new.geometry->>'type' <> 'Point' then
        raise exception 'a referenced Point place cannot change to another geometry type' using errcode = '23514';
      end if;
    end if;
  end if;

  contained := new.properties->'contained_place_ids';
  if contained is null then return new; end if;
  if new.geometry->>'type' <> 'LineString' or jsonb_typeof(contained) <> 'array' then
    raise exception 'contained_place_ids is allowed only as an array on LineString places' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(contained) item(value) where jsonb_typeof(value) <> 'string' or btrim(value#>>'{}') = '')
    or (select count(*) from jsonb_array_elements(contained)) <> (select count(distinct value#>>'{}') from jsonb_array_elements(contained)) then
    raise exception 'contained_place_ids must contain unique non-empty strings' using errcode = '23514';
  end if;
  for contained_id in select value#>>'{}' from jsonb_array_elements(contained) loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text || E'\x1f' || new.map_id || E'\x1f' || contained_id, 0));
    if not exists (
      select 1 from public.places p
      where p.owner_id = new.owner_id and p.map_id = new.map_id and p.id = contained_id
        and p.geometry->>'type' = 'Point'
    ) then
      raise exception 'contained_place_ids may reference only existing Point places in the same owner and map' using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.validate_linestring_contained_places() from public, anon, authenticated;

drop trigger if exists validate_linestring_contained_places on public.places;
create trigger validate_linestring_contained_places
before insert or update of owner_id, map_id, geometry, properties on public.places
for each row execute function public.validate_linestring_contained_places();

create or replace function public.cleanup_contained_place_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.geometry->>'type' = 'Point' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.owner_id::text || E'\x1f' || old.map_id || E'\x1f' || old.id, 0));
    update public.places set properties = jsonb_set(properties, '{contained_place_ids}',
      coalesce((select jsonb_agg(value) from jsonb_array_elements(properties->'contained_place_ids') item(value) where value#>>'{}' <> old.id), '[]'::jsonb), false)
    where owner_id = old.owner_id and map_id = old.map_id and geometry->>'type' = 'LineString'
      and properties->'contained_place_ids' ? old.id;
  end if;
  return old;
end $$;
revoke all on function public.cleanup_contained_place_reference() from public, anon, authenticated;

drop trigger if exists cleanup_contained_place_reference on public.places;
create trigger cleanup_contained_place_reference before delete on public.places
for each row execute function public.cleanup_contained_place_reference();

commit;

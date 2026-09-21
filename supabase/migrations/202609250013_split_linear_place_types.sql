-- Splits the legacy generic LineString type after migrations 001-012. Safe to rerun.
begin;

do $$ begin
  if to_regclass('public.places') is null then
    raise exception 'migration 013 已停止：请先按顺序执行 migration 001-012。';
  end if;
end $$;

-- ai coding：只迁移明确的旧 LineString，保持 id、geometry、关联、owner/map 与快照原样不动。
update public.places
set type = 'road',
    properties = jsonb_set(properties, '{type}', '"road"'::jsonb, true)
where geometry->>'type' = 'LineString'
  and type = 'linear-feature';

commit;

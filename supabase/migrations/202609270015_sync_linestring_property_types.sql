-- Repairs LineString properties.type values missed by the earlier 013. Safe to rerun after 014.
begin;

do $$ begin
  if to_regclass('public.places') is null then
    raise exception 'migration 015 已停止：请先按顺序执行 migration 001-014。';
  end if;
end $$;

-- ai coding：表列 type 是既有权威值；仅同步 LineString 的双层字段，不改其他几何、快照或数据归属。
update public.places
set properties = jsonb_set(properties, '{type}', to_jsonb(type), true)
where geometry->>'type' = 'LineString'
  and properties->>'type' is distinct from type;

commit;

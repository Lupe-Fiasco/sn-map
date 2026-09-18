-- Prerequisites:
--   1. Run this migration in the target Supabase project's SQL Editor or CLI.
--   2. Enable Anonymous Sign-Ins in Authentication > Providers before using the app.
-- The public client only receives the publishable key. Row ownership is enforced by RLS.

begin;

-- ai coding：旧表必须在任何 DDL 前完整通过预检，避免策略/触发器先落地后才因类型或主键失败。
do $$
declare
  places_oid regclass := to_regclass('public.places');
  users_oid regclass := to_regclass('auth.users');
  invalid_columns text;
  nullable_columns text;
  primary_key_columns text[];
  referencing_foreign_keys text;
  incompatible_unique_indexes text;
begin
  if places_oid is null then
    return;
  end if;

  with expected(column_name, type_oid, type_name) as (
    values
      ('owner_id', 'uuid'::regtype::oid, 'uuid'),
      ('id', 'text'::regtype::oid, 'text'),
      ('name', 'text'::regtype::oid, 'text'),
      ('type', 'text'::regtype::oid, 'text'),
      ('geometry', 'jsonb'::regtype::oid, 'jsonb'),
      ('properties', 'jsonb'::regtype::oid, 'jsonb'),
      ('longitude', 'double precision'::regtype::oid, 'double precision'),
      ('latitude', 'double precision'::regtype::oid, 'double precision'),
      ('updated_at', 'timestamptz'::regtype::oid, 'timestamptz'),
      ('created_at', 'timestamptz'::regtype::oid, 'timestamptz')
  )
  select string_agg(
    case when a.attname is null
      then format('%I（缺失，应为 %s）', expected.column_name, expected.type_name)
      else format('%I（当前 %s，应为 %s）', expected.column_name, format_type(a.atttypid, a.atttypmod), expected.type_name)
    end,
    '、' order by expected.column_name
  )
  into invalid_columns
  from expected
  left join pg_attribute a
    on a.attrelid = places_oid and a.attname = expected.column_name and not a.attisdropped
  where a.attname is null or a.atttypid <> expected.type_oid;

  if invalid_columns is not null then
    raise exception using
      message = format('places 升级已停止：旧表必要列缺失或类型不符：%s。', invalid_columns),
      hint = '请先备份，并按 README“旧版 places 手动升级”人工补齐列及准确类型后再重新执行；migration 不会改写数据。';
  end if;

  if exists (select 1 from public.places where owner_id is null) then
    raise exception using
      message = 'places 升级已停止：存在 owner_id 为空的旧数据，无法安全判断其归属。',
      hint = '请依据可信业务记录逐行核实 owner；migration 不会猜测 owner、删除或覆盖数据。';
  end if;

  select string_agg(format('%I', a.attname), '、' order by a.attname)
  into nullable_columns
  from pg_attribute a
  where a.attrelid = places_oid
    and a.attname = any (array['owner_id', 'id', 'name', 'type', 'geometry', 'properties', 'longitude', 'latitude', 'updated_at', 'created_at'])
    and not a.attisdropped
    and not a.attnotnull;

  if nullable_columns is not null then
    raise exception using
      message = format('places 升级已停止：必要列仍允许 NULL：%s。', nullable_columns),
      hint = '请先备份、人工核实并补齐空值，再添加 NOT NULL；migration 不会猜测或覆盖数据。';
  end if;

  if users_oid is null or exists (
    select 1 from public.places p
    where not exists (select 1 from auth.users u where u.id = p.owner_id)
  ) then
    raise exception using
      message = 'places 升级已停止：存在无法对应 auth.users.id 的 owner_id，或 auth.users 不可用。',
      hint = '请依据可信业务记录逐行核实 owner；migration 不会猜测 owner、删除或覆盖数据。';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute source_column on source_column.attrelid = c.conrelid and source_column.attnum = c.conkey[1]
    join pg_attribute target_column on target_column.attrelid = c.confrelid and target_column.attnum = c.confkey[1]
    where c.conrelid = places_oid and c.contype = 'f' and c.confrelid = users_oid
      and array_length(c.conkey, 1) = 1 and array_length(c.confkey, 1) = 1
      and source_column.attname = 'owner_id' and target_column.attname = 'id' and c.confdeltype = 'c'
  ) then
    raise exception using
      message = 'places 升级已停止：owner_id 缺少指向 auth.users(id) 且 ON DELETE CASCADE 的外键。',
      hint = '请先备份并人工确认现有 owner_id，再添加正确外键；migration 不会自动改变归属约束。';
  end if;

  if exists (select 1 from public.places group by owner_id, id having count(*) > 1) then
    raise exception 'places 升级已停止：存在重复的 (owner_id, id)，请人工核实并消除冲突；migration 不会删除数据。';
  end if;

  select array_agg(a.attname order by key_column.ordinality)
  into primary_key_columns
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
  where c.conrelid = places_oid and c.contype = 'p'
  group by c.conname;

  if primary_key_columns is not null
    and primary_key_columns <> array['id']::text[]
    and primary_key_columns <> array['owner_id', 'id']::text[] then
    raise exception 'places 升级已停止：发现非预期主键列（%），请人工审核。', primary_key_columns;
  end if;

  if primary_key_columns is distinct from array['owner_id', 'id']::text[] then
    select string_agg(format('%I.%I', n.nspname, c.conname), ', ')
    into referencing_foreign_keys
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and c.confrelid = places_oid;

    if referencing_foreign_keys is not null then
      raise exception using
        message = format('places 升级已停止：旧表仍被外键引用（%s）。', referencing_foreign_keys),
        hint = '请先人工迁移引用关系；migration 不会级联修改或删除数据。';
    end if;
  end if;

  select string_agg(index_class.relname, ', ' order by index_class.relname)
  into incompatible_unique_indexes
  from pg_index i
  join pg_class index_class on index_class.oid = i.indexrelid
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
  where i.indrelid = places_oid and i.indisunique and not i.indisprimary
    and i.indnkeyatts = 1 and a.attname = 'id';

  if incompatible_unique_indexes is not null then
    raise exception using
      message = format('places 升级已停止：存在与 owner 范围主键冲突的 id 唯一索引（%s）。', incompatible_unique_indexes),
      hint = '请先备份并人工审核约束用途；migration 不会自动删除唯一约束或索引。';
  end if;
end
$$;

create table if not exists public.places (
  id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  type text not null check (length(btrim(type)) > 0),
  geometry jsonb not null,
  longitude double precision not null,
  latitude double precision not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_pkey primary key (owner_id, id),
  constraint places_geometry_object_check check (jsonb_typeof(geometry) = 'object'),
  constraint places_geometry_type_check check (geometry->>'type' in ('Point', 'Polygon')),
  constraint places_geometry_coordinates_check check (
    case geometry->>'type'
      when 'Point' then
        case when jsonb_typeof(geometry->'coordinates') = 'array'
          then jsonb_array_length(geometry->'coordinates') >= 2
            and jsonb_typeof(geometry->'coordinates'->0) = 'number'
            and jsonb_typeof(geometry->'coordinates'->1) = 'number'
          else false
        end
      when 'Polygon' then
        case when jsonb_typeof(geometry->'coordinates') = 'array'
          then case when jsonb_array_length(geometry->'coordinates') = 1
            and jsonb_typeof(geometry->'coordinates'->0) = 'array'
            then jsonb_array_length(geometry->'coordinates'->0) >= 4
            else false
          end
          else false
        end
      else false
    end
  ),
  constraint places_properties_object_check check (jsonb_typeof(properties) = 'object'),
  constraint places_longitude_check check (longitude between -180 and 180),
  constraint places_latitude_check check (latitude between -90 and 90)
);

-- ai coding：Polygon 的逐点范围、闭环和至少三个不同顶点由应用层 GeoJSON 校验负责；
-- 读取也会逐行隔离非法数据，避免用复杂且脆弱的 SQL CHECK 影响迁移可执行性。

create index if not exists places_owner_id_idx on public.places(owner_id);
create index if not exists places_owner_updated_at_idx on public.places(owner_id, updated_at desc);

create or replace function public.set_places_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_places_updated_at on public.places;
create trigger set_places_updated_at
before update on public.places
for each row execute function public.set_places_updated_at();

alter table public.places enable row level security;

revoke all on table public.places from anon;
grant select, insert, update, delete on table public.places to authenticated;

drop policy if exists "places_select_own" on public.places;
create policy "places_select_own" on public.places
for select to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "places_insert_own" on public.places;
create policy "places_insert_own" on public.places
for insert to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "places_update_own" on public.places;
create policy "places_update_own" on public.places
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "places_delete_own" on public.places;
create policy "places_delete_own" on public.places
for delete to authenticated
using ((select auth.uid()) = owner_id);

commit;

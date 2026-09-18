-- Safely upgrades the legacy places(id primary key) layout.
-- Run after 202609170001_create_places.sql. This migration is transactional and idempotent.

begin;

do $$
declare
  places_oid regclass := to_regclass('public.places');
  users_oid regclass := to_regclass('auth.users');
  invalid_columns text;
  nullable_columns text;
  primary_key_name text;
  primary_key_columns text[];
  referencing_foreign_keys text;
  incompatible_unique_indexes text;
begin
  if places_oid is null then
    raise exception 'places 升级失败：public.places 不存在，请先执行 202609170001_create_places.sql。';
  end if;

  -- ai coding：与首个 migration 使用相同的先决条件；本块结束前不执行任何 DDL。
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

  if exists (
    select 1 from public.places group by owner_id, id having count(*) > 1
  ) then
    raise exception 'places 升级已停止：存在重复的 (owner_id, id)，请人工核实并消除冲突；migration 不会删除数据。';
  end if;

  select constraint_name, columns
  into primary_key_name, primary_key_columns
  from (
    select c.conname as constraint_name,
      array_agg(a.attname order by key_column.ordinality) as columns
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
    where c.conrelid = places_oid and c.contype = 'p'
    group by c.conname
  ) primary_key;

  if primary_key_columns is not null and primary_key_columns <> array['id']::text[] then
    if primary_key_columns <> array['owner_id', 'id']::text[] then
      raise exception 'places 升级已停止：发现非预期主键 % (%)，请人工审核。', primary_key_name, primary_key_columns;
    end if;
  end if;

  if primary_key_columns is distinct from array['owner_id', 'id']::text[] then
    select string_agg(format('%I.%I', n.nspname, c.conname), ', ')
    into referencing_foreign_keys
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and c.confrelid = places_oid;

    if referencing_foreign_keys is not null then
      raise exception using
        message = format('places 升级已停止：旧 id 主键仍被外键引用（%s）。', referencing_foreign_keys),
        hint = '联合主键会改变引用键，请先人工迁移这些外键，migration 不会级联修改或删除数据。';
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

  if primary_key_columns = array['owner_id', 'id']::text[] then
    return;
  end if;

  if primary_key_columns = array['id']::text[] then
    execute format('alter table public.places drop constraint %I', primary_key_name);
  end if;

  -- ai coding：无主键或安全移除旧 id 主键后，建立 PostgREST onConflict=owner_id,id 所需的唯一键。
  alter table public.places add constraint places_pkey primary key (owner_id, id);
end
$$;

commit;

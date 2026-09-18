-- Creates one immutable-at-publish-time public map snapshot per owner.
-- Run this file once after the already-applied 001/002 migrations. It is transactional and idempotent.

begin;

create table if not exists public.map_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  share_token text not null unique,
  title text not null default '睢宁地点地图',
  snapshot jsonb not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_snapshots_share_token_check check (share_token ~ '^[A-Za-z0-9_-]{32,128}$'),
  constraint map_snapshots_title_check check (length(btrim(title)) between 1 and 120),
  constraint map_snapshots_snapshot_check check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot->>'type' = 'FeatureCollection'
    and jsonb_typeof(snapshot->'features') = 'array'
  )
);

-- ai coding：若同名旧表不是本 migration 的安全结构，事务立即回滚，不猜测、不改写现有快照数据。
do $$
declare
  snapshots_oid regclass := to_regclass('public.map_snapshots');
  invalid_columns text;
begin
  with expected(column_name, type_oid, nullable) as (
    values
      ('owner_id', 'uuid'::regtype::oid, false),
      ('share_token', 'text'::regtype::oid, false),
      ('title', 'text'::regtype::oid, false),
      ('snapshot', 'jsonb'::regtype::oid, false),
      ('is_public', 'boolean'::regtype::oid, false),
      ('created_at', 'timestamptz'::regtype::oid, false),
      ('updated_at', 'timestamptz'::regtype::oid, false)
  )
  select string_agg(expected.column_name, ', ' order by expected.column_name)
  into invalid_columns
  from expected
  left join pg_attribute a on a.attrelid = snapshots_oid and a.attname = expected.column_name and not a.attisdropped
  where a.attname is null or a.atttypid <> expected.type_oid or a.attnotnull = expected.nullable;

  if invalid_columns is not null then
    raise exception 'map_snapshots 初始化已停止：必要列缺失、类型或可空性不符：%。', invalid_columns;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = snapshots_oid and c.contype = 'p'
      and array_length(c.conkey, 1) = 1 and a.attname = 'owner_id'
  ) then raise exception 'map_snapshots 初始化已停止：owner_id 必须是主键。'; end if;

  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = snapshots_oid and i.indisunique and i.indnkeyatts = 1 and a.attname = 'share_token'
  ) then raise exception 'map_snapshots 初始化已停止：share_token 必须具有单列唯一约束。'; end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_attribute source_column on source_column.attrelid = c.conrelid and source_column.attnum = c.conkey[1]
    join pg_attribute target_column on target_column.attrelid = c.confrelid and target_column.attnum = c.confkey[1]
    where c.conrelid = snapshots_oid and c.contype = 'f' and c.confrelid = 'auth.users'::regclass
      and array_length(c.conkey, 1) = 1 and source_column.attname = 'owner_id'
      and target_column.attname = 'id' and c.confdeltype = 'c'
  ) then raise exception 'map_snapshots 初始化已停止：owner_id 缺少 auth.users(id) ON DELETE CASCADE 外键。'; end if;

  if exists (
    select 1 from (values
      ('map_snapshots_share_token_check'),
      ('map_snapshots_title_check'),
      ('map_snapshots_snapshot_check')
    ) required(name)
    where not exists (
      select 1 from pg_constraint c
      where c.conrelid = snapshots_oid and c.contype = 'c' and c.conname = required.name
    )
  ) then raise exception 'map_snapshots 初始化已停止：缺少必要的数据格式 CHECK 约束。'; end if;
end
$$;

create index if not exists map_snapshots_public_token_idx
  on public.map_snapshots(share_token) where is_public = true;

create or replace function public.set_map_snapshots_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_map_snapshots_updated_at on public.map_snapshots;
create trigger set_map_snapshots_updated_at before update on public.map_snapshots
for each row execute function public.set_map_snapshots_updated_at();

alter table public.map_snapshots enable row level security;
revoke all on table public.map_snapshots from anon, authenticated;
grant select on table public.map_snapshots to anon, authenticated;
grant insert, update, delete on table public.map_snapshots to authenticated;

drop policy if exists "map_snapshots_select_public" on public.map_snapshots;
create policy "map_snapshots_select_public" on public.map_snapshots
for select to anon, authenticated using (is_public = true);

drop policy if exists "map_snapshots_select_own" on public.map_snapshots;
create policy "map_snapshots_select_own" on public.map_snapshots
for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "map_snapshots_insert_own" on public.map_snapshots;
create policy "map_snapshots_insert_own" on public.map_snapshots
for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists "map_snapshots_update_own" on public.map_snapshots;
create policy "map_snapshots_update_own" on public.map_snapshots
for update to authenticated using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "map_snapshots_delete_own" on public.map_snapshots;
create policy "map_snapshots_delete_own" on public.map_snapshots
for delete to authenticated using ((select auth.uid()) = owner_id);

commit;
